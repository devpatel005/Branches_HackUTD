/**
 * A tiny OpenAI-compatible mock endpoint.
 *
 * Exists so the entire agent path — the SpacetimeDB bus, claim/progress/
 * complete, the context allowlist, all four validation gates, retry, failover
 * and the deterministic fallbacks — is runnable and verifiable **today**, with
 * no API key for anyone.
 *
 * It answers the forced tool call deterministically from the request, so it is
 * also useful as a stable target while the real provider is being chosen.
 *
 *   npm run -w @branches/agent mock
 *   AGENT_BASE_URL=http://127.0.0.1:8099/v1 npm run agent
 *
 * Behaviour knobs, for exercising the unhappy paths:
 *   MOCK_FAIL_STATUS=429   always answer with that status (tests failover)
 *   MOCK_INVENT_NUMBER=1   put a number in the text that no engine data has
 *   MOCK_ADVICE=1          use advice language, so the filter rejects it
 *   MOCK_THINKING=1        include reasoning_content, as thinking-on would
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 8099);

type Body = {
  model?: string;
  messages?: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
  tool_choice?: { function?: { name?: string } };
  chat_template_kwargs?: { enable_thinking?: boolean };
};

/** Build a plausible tool-call answer for whichever tool was forced. */
function answerFor(body: Body): { name: string; args: unknown } | null {
  const forced = body.tool_choice?.function?.name ?? body.tools?.[0]?.function.name;
  const userText = body.messages?.filter(m => m.role === 'user').map(m => m.content).join('\n') ?? '';
  const data = extractEngineData(userText);

  switch (forced) {
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
      return { name: forced, args: { templateId, params: {}, followUps } };
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
        name: forced,
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
      return { name: forced, args: { locks, excludeCandidateIds: [] } };
    }

    case 'check_affordability': {
      const match = userText.match(/\$?([\d,]+(?:\.\d+)?)/);
      const amount = match ? Number(match[1]!.replace(/,/g, '')) : 100;
      const label = userText.match(/afford (?:a |an |the )?([a-z ]{2,30})/i)?.[1]?.trim() ?? 'it';
      return { name: forced, args: { amount, label } };
    }

    default:
      return null;
  }
}

/** A plain-text answer for text-only tasks like `explain`. */
function textAnswerFor(body: Body): string {
  const userText = body.messages?.filter(m => m.role === 'user').map(m => m.content).join('\n') ?? '';
  const data = extractEngineData(userText);
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

const server = createServer((request, response) => {
  if (!request.url?.endsWith('/chat/completions')) {
    response.writeHead(404).end('not found');
    return;
  }

  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(chunk as Buffer));
  request.on('end', () => {
    const failStatus = Number(process.env.MOCK_FAIL_STATUS ?? 0);
    if (failStatus > 0) {
      response.writeHead(failStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'mock failure' } }));
      return;
    }

    let body: Body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Body;
    } catch {
      response.writeHead(400).end('bad json');
      return;
    }

    const hasTools = (body.tools?.length ?? 0) > 0;
    const answer = hasTools ? answerFor(body) : null;
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
      : { role: 'assistant', content: hasTools ? 'The projection is unchanged.' : textAnswerFor(body) };

    // Thinking-on behaviour, for testing that the service notices.
    if (process.env.MOCK_THINKING === '1') message.reasoning_content = 'thinking...';

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 'chatcmpl-mock',
        model: body.model ?? 'mock',
        choices: [{ index: 0, finish_reason: answer ? 'tool_calls' : 'stop', message }],
      })
    );
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock LLM on http://127.0.0.1:${PORT}/v1`);
  console.log('point the agent at it:  AGENT_BASE_URL=http://127.0.0.1:' + PORT + '/v1');
});
