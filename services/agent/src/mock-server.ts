/**
 * A tiny mock model endpoint, speaking **both** shapes.
 *
 *   POST /v1/interactions      Gemini Interactions API — the primary path
 *   POST /v1/chat/completions  OpenAI-compatible — the secondary path
 *
 * Exists so the entire agent path — the SpacetimeDB bus, claim/progress/
 * complete, the context allowlist, all four validation gates, retry, failover
 * and the deterministic fallbacks — is runnable and verifiable with no API key
 * for anyone.
 *
 * It matters that it speaks *Gemini's* shape rather than only a generic one:
 * the keyless verification then exercises the real `@google/genai` adapter —
 * request body, `status` handling, `steps` parsing — instead of a code path the
 * demo never takes. The SDK POSTs its body verbatim to
 * `{baseUrl}/v1/interactions`, so pointing `GEMINI_BASE_URL` here is enough.
 *
 *   npm run -w @branches/agent mock
 *   GEMINI_BASE_URL=http://127.0.0.1:8099 npm run agent
 *
 * Behaviour knobs, for exercising the unhappy paths:
 *   MOCK_FAIL_STATUS=429    always answer with that HTTP status (tests failover)
 *   MOCK_INVENT_NUMBER=1    put a number in the text that no engine data has
 *   MOCK_ADVICE=1           use advice language, so the filter rejects it
 *   MOCK_STATUS=incomplete  end the interaction with that status (Gemini)
 *   MOCK_TRUNCATE=1         status `incomplete` *with* a plausible tool call,
 *                           as hitting the output budget mid-arguments looks
 *   MOCK_THINKING=1         include reasoning_content (OpenAI shape only)
 *   MOCK_DELAY_MS=30000     answer slowly, for timeout and budget tests
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 8099);

/** What both request shapes boil down to. */
type Ask = {
  userText: string;
  forcedTool: string | null;
  hasTools: boolean;
  model: string;
};

/** Build a plausible tool-call answer for whichever tool was forced. */
function answerFor(ask: Ask): { name: string; args: unknown } | null {
  const { forcedTool, userText } = ask;
  const data = extractEngineData(userText);

  switch (forcedTool) {
    case 'classify_life_event': {
      const lower = userText.toLowerCase();
      const templateId = /pregnan|baby|expecting/.test(lower)
        ? 'baby'
        : /laid off|lost (my|his|her) job|redundan/.test(lower)
          ? 'job_loss'
          : /raise|promotion/.test(lower)
            ? 'raise'
            : /medical|hospital|surgery/.test(lower)
              ? 'medical_bill'
              : /car/.test(lower)
                ? 'car_replacement'
                : /bonus|inherit|windfall/.test(lower)
                  ? 'windfall'
                  : 'medical_bill';

      const followUps =
        templateId === 'baby'
          ? [
              {
                param: 'leaveMonths',
                prompt: 'Congratulations! Is either of you taking unpaid leave?',
                chips: ['No leave', '4 weeks unpaid', '8 weeks unpaid', '12 weeks unpaid'],
              },
              {
                param: 'care',
                prompt: 'Daycare, or one of you staying home?',
                chips: ['Daycare', 'Staying home'],
              },
            ]
          : [];
      return { name: forcedTool, args: { templateId, params: {}, followUps } };
    }

    case 'select_branches': {
      // Candidates arrive nested under `engineData`, which is how the context
      // builder shapes it; looking only at the top level silently found nothing
      // and returned no tool call, which made rejection tests pass for the
      // wrong reason.
      const candidateList = candidatesFrom(data);
      const ids = candidateList.map(c => c.candidateId).slice(0, 3);
      if (ids.length < 3) return null;
      const invented = process.env.MOCK_INVENT_NUMBER === '1' ? ' Costs $999 more.' : '';
      const advice = process.env.MOCK_ADVICE === '1' ? ' You should pick this one.' : '';
      return {
        name: forcedTool,
        args: {
          picks: ids.map((candidateId, index) => ({
            candidateId,
            name: ['Protect the House', 'Balanced', 'Japan First'][index] ?? `Path ${index + 1}`,
            summary: `If you take this path, the projection funds your goals.${invented}${advice}`,
          })),
        },
      };
    }

    case 'set_constraints': {
      const lower = userText.toLowerCase();
      const locks: unknown[] = [];
      const goals = goalsFrom(data);
      for (const goal of goals) {
        if (new RegExp(`don'?t (delay|move) (the )?${goal.title}`, 'i').test(lower)) {
          locks.push({ kind: 'goalOnTime', goalId: goal.id });
        }
      }
      if (/cut (back on |out )?(eating out|takeaway|restaurants)/i.test(lower)) {
        locks.push({ kind: 'saveMoreAtMost', amount: 200 });
      }
      return { name: forcedTool, args: { locks, excludeCandidateIds: [] } };
    }

    case 'check_affordability': {
      const match = userText.match(/\$?([\d,]+(?:\.\d+)?)/);
      const amount = match ? Number(match[1]!.replace(/,/g, '')) : 100;
      const label = userText.match(/afford (?:a |an |the )?([a-z ]{2,30})/i)?.[1]?.trim() ?? 'it';
      return { name: forcedTool, args: { amount, label } };
    }

    default:
      return null;
  }
}

/** A plain-text answer for text-only tasks like `explain`. */
function textAnswerFor(ask: Ask): string {
  const data = extractEngineData(ask.userText);
  const engineData = (data?.engineData ?? {}) as Record<string, unknown>;
  const branchName = typeof engineData.branchName === 'string' ? engineData.branchName : 'that path';
  if (process.env.MOCK_ADVICE === '1') return `You should stick with ${branchName}.`;
  if (process.env.MOCK_INVENT_NUMBER === '1') return `${branchName} saves you $999 a month.`;
  return `With ${branchName}, the projection funds your goals.`;
}

/** Candidates, wherever the context put them. */
function candidatesFrom(data: Record<string, unknown> | null): { candidateId: string }[] {
  const engineData = data?.engineData as Record<string, unknown> | undefined;
  const list = (engineData?.candidates ?? data?.candidates) as unknown;
  return Array.isArray(list) ? (list as { candidateId: string }[]) : [];
}

/** Goals, wherever the context put them. */
function goalsFrom(data: Record<string, unknown> | null): { id: string; title: string }[] {
  const list = (data?.goals ?? (data?.engineData as Record<string, unknown> | undefined)?.goals) as unknown;
  return Array.isArray(list) ? (list as { id: string; title: string }[]) : [];
}

/**
 * Pull the engine-data block back out of the prompt the service built.
 *
 * `runTask` appends a correction **after** the JSON on a retry, so slicing from
 * the first brace to the end stops parsing on the second attempt — which made a
 * retried rejection look like "no tool call" instead of the real gate. Cut at
 * the known markers, then balance braces as a fallback.
 */
function extractEngineData(userText: string): Record<string, unknown> | null {
  const marker = 'Data you may use:';
  let block = userText.includes(marker)
    ? userText.slice(userText.indexOf(marker) + marker.length)
    : userText;

  const correction = block.indexOf('\nIMPORTANT:');
  if (correction !== -1) block = block.slice(0, correction);

  const start = block.indexOf('{');
  if (start === -1) return null;

  // Walk to the matching close brace, ignoring braces inside strings.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < block.length; i++) {
    const ch = block[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(block.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ======================================================================
// The two request shapes
// ======================================================================

type GeminiBody = {
  model?: string;
  input?: string;
  system_instruction?: string;
  tools?: { type?: string; name?: string }[];
  generation_config?: {
    thinking_level?: string;
    tool_choice?: { allowed_tools?: { mode?: string; tools?: string[] } };
  };
};

type OpenAIBody = {
  model?: string;
  messages?: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
  tool_choice?: { function?: { name?: string } };
};

function askFromGemini(body: GeminiBody): Ask {
  const allowed = body.generation_config?.tool_choice?.allowed_tools?.tools ?? [];
  return {
    // Gemini takes one `input` block rather than a message list.
    userText: body.input ?? '',
    forcedTool: allowed[0] ?? body.tools?.[0]?.name ?? null,
    hasTools: (body.tools?.length ?? 0) > 0,
    model: body.model ?? 'mock',
  };
}

function askFromOpenAI(body: OpenAIBody): Ask {
  return {
    userText: body.messages?.filter(m => m.role === 'user').map(m => m.content).join('\n') ?? '',
    forcedTool: body.tool_choice?.function?.name ?? body.tools?.[0]?.function.name ?? null,
    hasTools: (body.tools?.length ?? 0) > 0,
    model: body.model ?? 'mock',
  };
}

/** The Interactions API response, as `normaliseInteraction` reads it. */
function geminiResponse(ask: Ask): Record<string, unknown> {
  const answer = ask.hasTools ? answerFor(ask) : null;

  // Truncation is the interesting failure: a plausible tool call *and* an
  // `incomplete` status, because the output budget includes thinking tokens and
  // runs out mid-arguments. The status must win over the usable-looking call.
  if (process.env.MOCK_TRUNCATE === '1') {
    return {
      id: 'int_mock_truncated',
      model: ask.model,
      status: 'incomplete',
      output_text: 'If you take this path, the projection fun',
      steps: answer
        ? [{ type: 'function_call', id: 'call_mock_1', name: answer.name, arguments: {} }]
        : [],
    };
  }

  const forcedStatus = process.env.MOCK_STATUS;
  if (forcedStatus) {
    return {
      id: 'int_mock_status',
      model: ask.model,
      status: forcedStatus,
      output_text: '',
      steps: [],
      errors: [{ message: `mock forced status ${forcedStatus}` }],
    };
  }

  return {
    id: 'int_mock',
    model: ask.model,
    status: answer ? 'requires_action' : 'completed',
    output_text: answer ? '' : ask.hasTools ? 'The projection is unchanged.' : textAnswerFor(ask),
    steps: answer
      ? [{ type: 'function_call', id: 'call_mock_1', name: answer.name, arguments: answer.args }]
      : [],
  };
}

/** The OpenAI-compatible response, as `normaliseCompletion` reads it. */
function openaiResponse(ask: Ask): Record<string, unknown> {
  const answer = ask.hasTools ? answerFor(ask) : null;
  const message: Record<string, unknown> = answer
    ? {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_mock_1',
            type: 'function',
            function: { name: answer.name, arguments: JSON.stringify(answer.args) },
          },
        ],
      }
    : { role: 'assistant', content: ask.hasTools ? 'The projection is unchanged.' : textAnswerFor(ask) };

  // Thinking-on behaviour, for testing that the service notices.
  if (process.env.MOCK_THINKING === '1') message.reasoning_content = 'thinking...';

  const finish = process.env.MOCK_TRUNCATE === '1' ? 'length' : answer ? 'tool_calls' : 'stop';

  return {
    id: 'chatcmpl-mock',
    model: ask.model,
    choices: [{ index: 0, finish_reason: finish, message }],
  };
}

// ======================================================================
// Server
// ======================================================================

const server = createServer((request, response) => {
  const url = request.url ?? '';
  const isGemini = url.endsWith('/interactions');
  const isOpenAI = url.endsWith('/chat/completions');

  if (!isGemini && !isOpenAI) {
    response.writeHead(404).end('not found');
    return;
  }

  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(chunk as Buffer));
  request.on('end', () => {
    const delay = Number(process.env.MOCK_DELAY_MS ?? 0);
    const send = () => {
      const failStatus = Number(process.env.MOCK_FAIL_STATUS ?? 0);
      if (failStatus > 0) {
        response.writeHead(failStatus, { 'content-type': 'application/json' });
        // Google's error envelope differs from OpenAI's, and the SDK parses it
        // to build the thrown error — so each route must use its own.
        response.end(
          JSON.stringify(
            isGemini
              ? { error: { code: failStatus, message: 'mock failure', status: 'RESOURCE_EXHAUSTED' } }
              : { error: { message: 'mock failure' } }
          )
        );
        return;
      }

      let parsed: unknown = {};
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        response.writeHead(400).end('bad json');
        return;
      }

      const ask = isGemini
        ? askFromGemini(parsed as GeminiBody)
        : askFromOpenAI(parsed as OpenAIBody);

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(isGemini ? geminiResponse(ask) : openaiResponse(ask)));
    };

    if (delay > 0) setTimeout(send, delay);
    else send();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock model on http://127.0.0.1:${PORT}`);
  console.log(`  Gemini : POST /v1/interactions      → GEMINI_BASE_URL=http://127.0.0.1:${PORT}`);
  console.log(`  OpenAI : POST /v1/chat/completions  → AGENT_BASE_URL=http://127.0.0.1:${PORT}/v1`);
});
