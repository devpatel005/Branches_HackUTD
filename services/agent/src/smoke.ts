/**
 * Provider smoke check — "is my endpoint and key actually working?"
 *
 * Deliberately independent of SpacetimeDB: it calls one tier with one forced
 * tool call and reports what came back. Two things only a live call can settle
 * (07 Agent Spec):
 *   - the model name is real;
 *   - **thinking is off** — no `reasoning_content`, and `finish_reason` is not
 *     `length`.
 *
 *   npm run -w @branches/agent mock                                  # no key
 *   AGENT_BASE_URL=http://127.0.0.1:8099/v1 npm run agent:smoke
 *   NVIDIA_API_KEY=... npm run agent:smoke                           # live
 */
import { callTier, finishReasonOf, reasoningOf, tiersFromEnv, toolCallOf } from './providers.ts';
import { classifyLifeEventTool, SYSTEM_PROMPT } from './tools.ts';
import { classifyLifeEventSchema } from './validate.ts';

const USER_MESSAGE = 'We just found out we are pregnant!';

const tiers = tiersFromEnv();
if (tiers.length === 0) {
  console.error(
    'No tier configured. Either set NVIDIA_API_KEY / AGENT_API_KEY, or run the mock:\n' +
      '  npm run -w @branches/agent mock\n' +
      '  AGENT_BASE_URL=http://127.0.0.1:8099/v1 npm run agent:smoke'
  );
  process.exit(1);
}

const tier = tiers[0]!;
console.log(`\nProvider smoke check\n  tier  : ${tier.label}\n  model : ${tier.model}\n  url   : ${tier.baseUrl}\n`);

const result = await callTier(tier, {
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_MESSAGE },
  ],
  tools: [classifyLifeEventTool],
  forceTool: 'classify_life_event',
});

if (!result.ok) {
  console.error(`FAIL  ${result.status ?? ''} ${result.error}`.trim());
  process.exit(1);
}

const call = toolCallOf(result.completion);
const reasoning = reasoningOf(result.completion);
const finish = finishReasonOf(result.completion);

const rows: [string, string, boolean][] = [];
rows.push(['a tool call came back', call ? call.function.name : '(none)', call !== null]);
rows.push([
  'thinking is off (no reasoning content)',
  reasoning ? `present (${reasoning.length} chars)` : 'absent',
  !reasoning,
]);
rows.push(['finish_reason is not "length"', finish || '(none)', finish !== 'length']);

let parsedOk = false;
if (call) {
  try {
    const parsed = classifyLifeEventSchema.safeParse(JSON.parse(call.function.arguments));
    parsedOk = parsed.success;
    rows.push([
      'arguments match the schema',
      parsed.success ? parsed.data.templateId : parsed.error.issues[0]?.message ?? 'invalid',
      parsed.success,
    ]);
    if (parsed.success) {
      console.log('Tool arguments:');
      console.log(JSON.stringify(parsed.data, null, 2).split('\n').map(l => `  ${l}`).join('\n'));
      console.log();
    }
  } catch (error) {
    rows.push(['arguments parse as JSON', error instanceof Error ? error.message : 'failed', false]);
  }
}

let failed = 0;
for (const [description, actual, pass] of rows) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${description.padEnd(40)} ${actual}`);
}
console.log(`\n${rows.length - failed}/${rows.length} passed\n`);
if (!parsedOk) console.log('Note: a mock endpoint proves the request shape, not the real model.\n');
process.exit(failed === 0 ? 0 : 1);
