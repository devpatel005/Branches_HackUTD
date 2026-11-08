/**
 * Stage 0 Nemotron smoke check.
 *
 * Proves the agent path end to end: one forced tool call, thinking off, valid
 * arguments, and NO reasoning content. Two modes (12 Verification#V5):
 *
 *   recorded (default) — no network, deterministic, uses src/recorded/*.json
 *   live               — real NVIDIA call; needs NVIDIA_API_KEY
 *
 *   npm run agent:smoke        # recorded
 *   npm run -w @branches/agent smoke:live
 *
 * Recorded mode proves the request shape, parsing, and validation. It CANNOT
 * prove the two things Stage 0 most wants to know: that the model name is real
 * and that chat_template_kwargs at the top level actually disables thinking.
 * Those need live mode.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BASE_REQUEST, MODEL_TIERS, NVIDIA_BASE_URL, PRIMARY_MODEL, shouldFailover } from './model-config.ts';
import { SYSTEM_PROMPT, classifyLifeEventTool, forceTool } from './tools.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MODE = process.env.BRANCHES_AGENT_MODE === 'live' ? 'live' : 'recorded';
const USER_MESSAGE = 'We just found out we are pregnant!';

type ToolCall = { id: string; function: { name: string; arguments: string } };
type Choice = {
  finish_reason?: string;
  message?: { content?: string | null; tool_calls?: ToolCall[]; reasoning_content?: string | null };
};
type Completion = { model?: string; choices?: Choice[] };

function buildRequest(model: string) {
  return {
    model,
    messages: [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: USER_MESSAGE },
    ],
    tools: [classifyLifeEventTool],
    tool_choice: forceTool('classify_life_event'),
    ...BASE_REQUEST,
  };
}

async function callLive(): Promise<{ completion: Completion; modelUsed: string }> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not set. Put it in services/agent/.env');

  let lastError: unknown;
  for (const { tier, model } of MODEL_TIERS) {
    const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildRequest(model)),
    });
    if (res.ok) return { completion: (await res.json()) as Completion, modelUsed: model };
    const body = await res.text();
    lastError = new Error(`tier ${tier} (${model}) HTTP ${res.status}: ${body.slice(0, 300)}`);
    if (!shouldFailover(res.status)) break;
    console.warn(`  tier ${tier} failed with HTTP ${res.status}; trying next tier`);
  }
  throw lastError;
}

function callRecorded(): { completion: Completion; modelUsed: string } {
  const file = join(here, 'recorded', 'classify_life_event.pregnancy.json');
  const completion = JSON.parse(readFileSync(file, 'utf8')) as Completion;
  return { completion, modelUsed: completion.model ?? PRIMARY_MODEL };
}

type Check = { id: string; description: string; expected: string; actual: string; pass: boolean };

function main(completion: Completion, modelUsed: string): Check[] {
  const choice = completion.choices?.[0];
  const message = choice?.message;
  const toolCalls = message?.tool_calls ?? [];
  const call = toolCalls[0];

  let parsed: Record<string, unknown> | null = null;
  let parseError = '';
  if (call) {
    try {
      parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }

  const followUps = Array.isArray(parsed?.followUps) ? (parsed!.followUps as unknown[]) : [];
  const reasoning = message?.reasoning_content;

  const checks: Check[] = [
    {
      id: 'S1',
      description: 'exactly one tool call returned',
      expected: '1',
      actual: String(toolCalls.length),
      pass: toolCalls.length === 1,
    },
    {
      id: 'S2',
      description: 'the forced tool was called',
      expected: 'classify_life_event',
      actual: call?.function.name ?? '(none)',
      pass: call?.function.name === 'classify_life_event',
    },
    {
      id: 'S3',
      description: 'tool arguments parse as JSON',
      expected: 'parses',
      actual: parsed ? 'parses' : `failed: ${parseError}`,
      pass: parsed !== null,
    },
    {
      id: 'S4',
      description: 'pregnancy classified as the baby template',
      expected: 'baby',
      actual: String(parsed?.templateId ?? '(none)'),
      pass: parsed?.templateId === 'baby',
    },
    {
      id: 'S5',
      description: 'follow-ups asked for leave and care',
      expected: 'both present',
      actual: followUps
        .map(f => String((f as { param?: string }).param ?? '?'))
        .join(', ') || '(none)',
      pass:
        followUps.some(f => /leave/i.test(String((f as { param?: string }).param ?? ''))) &&
        followUps.some(f => /care/i.test(String((f as { param?: string }).param ?? ''))),
    },
    {
      id: 'S6',
      description: 'thinking off — no reasoning content',
      expected: 'absent',
      actual: reasoning ? `present (${String(reasoning).length} chars)` : 'absent',
      pass: !reasoning,
    },
    {
      id: 'S7',
      description: 'finish_reason is not "length" (thinking did not eat the budget)',
      expected: 'not length',
      actual: choice?.finish_reason ?? '(none)',
      pass: choice?.finish_reason !== 'length',
    },
  ];

  console.log(`\nNemotron smoke check — mode: ${MODE}, model: ${modelUsed}\n`);
  if (MODE === 'recorded') {
    console.log('  NOTE: recorded mode. S6/S7 pass against a fixture and do NOT prove');
    console.log('  thinking is off on the real endpoint. Set NVIDIA_API_KEY and run');
    console.log('  `npm run -w @branches/agent smoke:live` to confirm for real.\n');
  }
  console.log('  Tool arguments:');
  console.log(
    JSON.stringify(parsed, null, 2)
      .split('\n')
      .map(l => `    ${l}`)
      .join('\n')
  );
  return checks;
}

const { completion, modelUsed } = MODE === 'live' ? await callLive() : callRecorded();
const checks = main(completion, modelUsed);

const { printTable } = await import('../../../scripts/verify/table.ts');
const ok = printTable('Nemotron smoke', checks);
process.exit(ok ? 0 : 1);
