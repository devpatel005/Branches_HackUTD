/**
 * Provider smoke check — "is my model and key actually working?"
 *
 * Deliberately independent of SpacetimeDB: it calls tier 1 with one forced tool
 * call and reports what came back. This is where **A8** gets settled, because
 * these are the things no mock can prove (07 Agent Spec):
 *   - the model name is real;
 *   - `thinking_level` and `tool_choice.allowed_tools` are accepted as sent;
 *   - the interaction ends `requires_action` with a parsed function call, not
 *     `incomplete` with a truncated one.
 *
 *   npm run -w @branches/agent mock                       # keyless: shape only
 *   GEMINI_BASE_URL=http://127.0.0.1:8099 npm run -w @branches/agent smoke
 *
 *   GEMINI_API_KEY=... npm run -w @branches/agent smoke    # live: settles A8
 */
import { callTier, tiersFromEnv, timeoutMs, type Tier } from './providers.ts';
import { classifyLifeEventTool, SYSTEM_PROMPT } from './tools.ts';
import { classifyLifeEventSchema } from './validate.ts';

const USER_MESSAGE = 'We just found out we are pregnant!';

const tiers = tiersFromEnv();
if (tiers.length === 0) {
  console.error(
    'No tier configured. Either set GEMINI_API_KEY, or run the mock:\n' +
      '  npm run -w @branches/agent mock\n' +
      '  GEMINI_BASE_URL=http://127.0.0.1:8099 npm run -w @branches/agent smoke'
  );
  process.exit(1);
}

/** A mock proves the request shape; only the real endpoint settles A8. */
function isLive(tier: Tier): boolean {
  return tier.apiKey !== '' && !tier.baseUrl.includes('127.0.0.1') && !tier.baseUrl.includes('localhost');
}

const rows: [string, string, boolean][] = [];
let anyLive = false;

for (const tier of tiers) {
  anyLive ||= isLive(tier);
  console.log(
    `\nSmoke check — tier ${tier.tier}\n` +
      `  provider : ${tier.provider}\n` +
      `  model    : ${tier.model}\n` +
      `  thinking : ${tier.thinkingLevel}\n` +
      `  endpoint : ${tier.baseUrl || '(provider default)'}\n` +
      `  mode     : ${isLive(tier) ? 'LIVE' : 'mock / keyless'}\n`
  );

  const label = `t${tier.tier} ${tier.model}`;
  const result = await callTier(tier, {
    system: SYSTEM_PROMPT,
    input: USER_MESSAGE,
    tools: [classifyLifeEventTool],
    forceTool: classifyLifeEventTool.name,
  });

  if (!result.ok) {
    // The model name being wrong shows up here, as a 404 or NOT_FOUND.
    rows.push([`${label}: the call succeeded`, `${result.status ?? ''} ${result.error}`.trim(), false]);
    continue;
  }

  const { status, rawStatus, toolCall, text, reasoning } = result.result;

  rows.push([
    `${label}: a forced tool call came back`,
    toolCall ? toolCall.name : `(none) — status ${rawStatus}`,
    toolCall !== null,
  ]);
  rows.push([
    `${label}: not truncated (status is not incomplete)`,
    rawStatus,
    status !== 'incomplete' && status !== 'failed' && status !== 'unknown',
  ]);
  if (tier.provider === 'openai') {
    rows.push([
      `${label}: thinking is off (no reasoning content)`,
      reasoning ? `present (${reasoning.length} chars)` : 'absent',
      !reasoning,
    ]);
  }

  if (toolCall) {
    // Gemini hands back parsed arguments; the OpenAI adapter has already
    // parsed them. Either way the validator sees an object.
    const parsed = classifyLifeEventSchema.safeParse(toolCall.arguments);
    rows.push([
      `${label}: arguments match the schema`,
      parsed.success ? parsed.data.templateId : parsed.error.issues[0]?.message ?? 'invalid',
      parsed.success,
    ]);
    if (parsed.success) {
      console.log('Tool arguments:');
      console.log(JSON.stringify(parsed.data, null, 2).split('\n').map(l => `  ${l}`).join('\n'));
      console.log();
    }
  } else if (text) {
    console.log(`Text instead of a tool call:\n  ${text.slice(0, 300)}\n`);
  }
}

let failed = 0;
for (const [description, actual, pass] of rows) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${description.padEnd(52)} ${actual}`);
}
console.log(`\n${rows.length - failed}/${rows.length} passed   (timeout ${timeoutMs()}ms)\n`);

if (!anyLive) {
  console.log('Mock / keyless run: proves the request and response shape, not the real model.');
  console.log('A8 stays PENDING until this runs with GEMINI_API_KEY set.\n');
} else if (failed === 0) {
  console.log('A8 SETTLED — the live model accepts the forced tool call and answers in schema.\n');
}

process.exit(failed === 0 ? 0 : 1);
