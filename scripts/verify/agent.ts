/**
 * V5 Agent contract — 12 Verification#V5 Agent contract.
 *
 * Runs in two modes:
 *   **recorded** (default) — no network. Exercises the validation gates, the
 *   context allowlist and the fallbacks directly, deterministically.
 *   **mock** — spawns the bundled OpenAI-compatible mock and drives real HTTP
 *   through `runTask`, so retry, failover and thinking-detection are exercised
 *   for real without any API key.
 *
 *   npm run verify:agent
 *   BRANCHES_AGENT_MODE=mock npm run verify:agent
 *
 * A8 (thinking off, live) cannot be settled without a real key and is reported
 * as PENDING rather than silently passing.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildContext,
  numbersInContext,
  type AgentContextInput,
} from '@branches/agent/src/context.ts';
import {
  checkLanguage,
  checkNumbers,
  classifyLifeEventSchema,
  selectBranchesSchema,
  setConstraintsSchema,
  validatePicks,
  validateText,
  MAX_BRANCH_NAME,
} from '@branches/agent/src/validate.ts';
import { fallbackFor } from '@branches/agent/src/fallbacks.ts';
import { tiersFromEnv, shouldFailover } from '@branches/agent/src/providers.ts';
import { runTask } from '@branches/agent/src/tasks.ts';
import { classifyLifeEventTool, selectBranchesTool } from '@branches/agent/src/tools.ts';
import {
  E5_BABY_EVENT,
  TEST_HOUSEHOLD_A,
  computeImpact,
  generateCandidates,
} from '@branches/engine';
import { PRIVATE_MERCHANT_CANARIES, generateTestHouseholdA } from '@branches/mock-data';
import { check, printTable, type Check } from './table.ts';

const MODE = process.env.BRANCHES_AGENT_MODE === 'mock' ? 'mock' : 'recorded';
/**
 * Each mock gets its own port.
 *
 * Killing and respawning on one port is a race: the dying server can still
 * answer while its replacement fails to bind, and with stdio ignored that is
 * invisible. The symptom was a rejection for the *wrong* reason, which looked
 * like a pass until the check asserted the gate instead of a boolean.
 */
let nextMockPort = 8111;
const mockUrlFor = (port: number) => `http://127.0.0.1:${port}/v1`;

const checks: Check[] = [];

// ======================================================================
// Shared fixtures: real engine output, so the whitelist has real numbers
// ======================================================================
const rawImpact = computeImpact(TEST_HOUSEHOLD_A, E5_BABY_EVENT, { A: 'Maya', B: 'Jordan' });

/**
 * The impact **as the module stores it** — deltas, effects and provenance, with
 * the two full projections stripped.
 *
 * This matters more than it looks. The numbers whitelist is only as tight as the
 * data handed to the model: a 120-month series contains every month index from 0
 * to 119, so including it would quietly whitelist almost any small integer and
 * the gate would stop catching invented durations. The module already strips it
 * (Stage 4), and `contextFor` in the service sends this shape — so the fixture
 * must too, or the test would be easier than reality.
 */
const impact = {
  newlyAtRiskGoalIds: rawImpact.newlyAtRiskGoalIds,
  shortfallsByGoalId: rawImpact.shortfallsByGoalId,
  tightYearsBefore: rawImpact.tightYearsBefore,
  tightYearsAfter: rawImpact.tightYearsAfter,
  emergencyMonthsMinBefore: rawImpact.emergencyMonthsMinBefore,
  emergencyMonthsMinAfter: rawImpact.emergencyMonthsMinAfter,
  freeToPlanBefore: rawImpact.freeToPlanBefore,
  freeToPlanAfter: rawImpact.freeToPlanAfter,
  effects: rawImpact.effects,
};
const candidates = generateCandidates({ ...TEST_HOUSEHOLD_A, events: [E5_BABY_EVENT] });
const candidateData = candidates.map((candidate, index) => ({
  candidateId: String(index + 1),
  signature: candidate.signature,
  stats: candidate.stats,
}));

const contextInput: AgentContextInput = {
  members: [
    { id: 'A', displayName: 'Maya', colorKey: 'a' },
    { id: 'B', displayName: 'Jordan', colorKey: 'b' },
  ],
  baseline: {
    incomeByMember: { A: 5000, B: 3800 },
    fixed: 3000,
    debt: 500,
    flexible: 1500,
    retirement: 400,
    liquidSavings: 15000,
  },
  funMoneyByMember: { A: 300, B: 300 },
  goals: [
    { id: 'japan', title: 'Japan', costToday: 5000, targetMonth: 24, targetLabel: 'Nov 2028', priority: 'flex' },
    { id: 'house', title: 'House', costToday: 40000, targetMonth: 60, targetLabel: 'Nov 2031', priority: 'must' },
  ],
  engineData: { candidates: candidateData, impact },
};
const context = buildContext(contextInput);

// ======================================================================
// A1 - classify_life_event on "we just found out we're pregnant"
// ======================================================================
// The schema and follow-up expectations, checked without a model: these are the
// contract a model must satisfy, so they are worth asserting independently.
const goodClassification = {
  templateId: 'baby',
  params: {},
  followUps: [
    { param: 'leaveMonths', prompt: 'Is either of you taking unpaid leave?', chips: ['No leave', '8 weeks unpaid'] },
    { param: 'care', prompt: 'Daycare, or one of you staying home?', chips: ['Daycare', 'Staying home'] },
  ],
};
const a1 = classifyLifeEventSchema.safeParse(goodClassification);

checks.push(
  check('A1a', 'a baby classification matches the schema', a1.success, true),
  check('A1b', 'its follow-ups cover leave and care', a1.success ? a1.data.followUps.map(f => f.param) : [], ['leaveMonths', 'care']),
  check('A1c', 'an unknown template is rejected', classifyLifeEventSchema.safeParse({ ...goodClassification, templateId: 'lottery' }).success, false),
  check('A1d', 'more than four follow-ups is rejected', classifyLifeEventSchema.safeParse({ ...goodClassification, followUps: Array(5).fill(goodClassification.followUps[0]) }).success, false)
);

// ======================================================================
// A2 - select_branches must pick three distinct, existing candidates
// ======================================================================
const validIds = candidateData.map(c => c.candidateId);
const goodPicks = {
  picks: [
    { candidateId: validIds[0]!, name: 'Save a bit more', summary: 'The projection funds both goals.' },
    { candidateId: validIds[1]!, name: 'Balanced', summary: 'A smaller move plus a little more saving.' },
    { candidateId: validIds[2]!, name: 'Move the house', summary: 'The projection funds both goals.' },
  ],
};
const a2 = selectBranchesSchema.safeParse(goodPicks);

checks.push(
  check('A2a', 'three valid picks pass the schema', a2.success, true),
  check('A2b', 'and pass the full pick validation', validatePicks(goodPicks.picks, validIds, context.engineData), null),
  check('A2c', 'two picks are rejected', selectBranchesSchema.safeParse({ picks: goodPicks.picks.slice(0, 2) }).success, false),
  check(
    'A2d',
    'a duplicate candidate is rejected',
    validatePicks([goodPicks.picks[0]!, goodPicks.picks[0]!, goodPicks.picks[1]!], validIds, context.engineData)?.gate,
    'schema'
  ),
  check(
    'A2e',
    'an invented candidate id is rejected',
    validatePicks(
      [{ candidateId: '999', name: 'Nope', summary: 'Nope.' }, goodPicks.picks[1]!, goodPicks.picks[2]!],
      validIds,
      context.engineData
    )?.gate,
    'schema'
  ),
  check(
    'A2f',
    `a name over ${MAX_BRANCH_NAME} characters is rejected`,
    validatePicks(
      [{ candidateId: validIds[0]!, name: 'A name far too long to fit on a branch card', summary: 'Fine.' }, goodPicks.picks[1]!, goodPicks.picks[2]!],
      validIds,
      context.engineData
    )?.gate,
    'length'
  ),
  check('A2g', 'names are all within the limit', goodPicks.picks.every(p => p.name.length <= MAX_BRANCH_NAME), true)
);

// ======================================================================
// A3 - numbers whitelist
// ======================================================================
const engineNumbers = numbersInContext(context.engineData);

checks.push(
  check('A3a', 'an invented $999 is rejected', checkNumbers('It costs $999 more.', context.engineData).ok, false),
  check('A3b', 'and the offending number is named', checkNumbers('It costs $999 more.', context.engineData).invented, [999]),
  check('A3c', 'a real engine number passes', checkNumbers('Japan is short $2,183.97.', context.engineData).ok, true),
  check('A3d', 'formatting differences are tolerated', checkNumbers('Japan is short 2183.97 dollars.', context.engineData).ok, true),
  check('A3e', 'small counts the engine emits pass', checkNumbers('Both of your 2 goals are funded.', context.engineData).ok, true),
  check('A3f', 'an invented month count is rejected', checkNumbers('It pushes Japan back 47 months.', context.engineData).ok, false),
  check('A3g', 'a real delay passes', checkNumbers('Moving the house 18 months works.', context.engineData).ok, true),
  check('A3h', 'the engine shortfall really is in the data', engineNumbers.has(2183.97), true),
  check('A3i', 'text with no numbers passes', checkNumbers('That all still fits.', context.engineData).ok, true),
  // The gate is only as tight as the data behind it, so assert that the
  // month-by-month series is *not* in the context: including it would whitelist
  // every integer from 0 to 119 and quietly defeat A3f.
  check('A3j', 'the 120-month series is not in the context', /seriesAfter|"monthly"/.test(JSON.stringify(context.engineData)), false),
  check('A3k', 'so an arbitrary month index is not whitelisted', engineNumbers.has(47), false)
);

// ======================================================================
// A4 - language filter
// ======================================================================
checks.push(
  check('A4a', '"you should" is rejected', checkLanguage('You should push Japan back.').ok, false),
  check('A4b', '"we recommend" is rejected', checkLanguage('We recommend the balanced path.').ok, false),
  check('A4c', '"best option" is rejected', checkLanguage('This is the best option for you.').ok, false),
  check('A4d', '"advice" is rejected', checkLanguage('Here is my advice.').ok, false),
  check('A4e', 'projection language passes', checkLanguage('If you push Japan to 2029, the projection shows both goals funded.').ok, true),
  check('A4f', '"shoulder" does not trip the filter', checkLanguage('The shoulder season is cheaper.').ok, true),
  check('A4g', 'the gate is reported as language', validateText('You should do this.', context.engineData)?.gate, 'language'),
  check('A4h', 'rejection explains how to rephrase', (validateText('You should do this.', context.engineData)?.detail ?? '').includes('projection'), true)
);

// ======================================================================
// A5 - fallbacks: every task has a path that needs no model
// ======================================================================
checks.push(
  check('A5a', 'interpret_event falls back to the form', fallbackFor('interpret_event').showForm, true),
  check('A5b', 'select_branches needs no repair, since templates already named them', fallbackFor('select_branches').showForm, undefined),
  check('A5c', 'translate_feedback points at the lock and pin chips', fallbackFor('translate_feedback').showForm, true),
  check('A5d', 'affordability points at the form', fallbackFor('affordability').showForm, true),
  check('A5e', 'no fallback message uses advice language', ['interpret_event', 'select_branches', 'translate_feedback', 'affordability', 'general_chat'].every(kind => checkLanguage(fallbackFor(kind).message).ok), true),
  check('A5f', 'no fallback message invents a number', ['interpret_event', 'select_branches', 'translate_feedback', 'affordability', 'general_chat'].every(kind => checkNumbers(fallbackFor(kind).message, context.engineData).ok), true)
);

// ======================================================================
// A6 - failover
// ======================================================================
checks.push(
  check('A6a', 'a 429 fails over', shouldFailover(429), true),
  check('A6b', 'a 402 fails over', shouldFailover(402), true),
  check('A6c', 'a 500 fails over', shouldFailover(500), true),
  check('A6d', 'a 400 does not — that is our bug, not theirs', shouldFailover(400), false),
  check(
    'A6e',
    'tier 1 defaults to Nemotron',
    tiersFromEnv({ NVIDIA_API_KEY: 'x' } as NodeJS.ProcessEnv)[0]?.model,
    'nvidia/nemotron-3.5-bolt-e4b'
  ),
  check(
    'A6f',
    'a Nemotron key yields two Nemotron tiers',
    tiersFromEnv({ NVIDIA_API_KEY: 'x' } as NodeJS.ProcessEnv).length,
    2
  ),
  check(
    'A6g',
    'AGENT_BASE_URL overrides tier 1 for testing another provider',
    tiersFromEnv({ AGENT_BASE_URL: 'http://localhost:1/v1', AGENT_MODEL: 'test', AGENT_API_KEY: 'k' } as NodeJS.ProcessEnv)[0]?.model,
    'test'
  ),
  check(
    'A6h',
    'thinking-off is only sent to Nemotron endpoints',
    tiersFromEnv({ AGENT_BASE_URL: 'https://api.openai.com/v1', AGENT_API_KEY: 'k' } as NodeJS.ProcessEnv)[0]?.nemotron,
    false
  ),
  check(
    'A6i',
    'a third tier appears when a fallback provider is configured',
    tiersFromEnv({
      NVIDIA_API_KEY: 'x',
      FALLBACK_LLM_BASE_URL: 'https://api.openai.com/v1',
      FALLBACK_LLM_API_KEY: 'k',
      FALLBACK_LLM_MODEL: 'gpt-4o-mini',
    } as NodeJS.ProcessEnv).length,
    3
  )
);

// ======================================================================
// A7 - privacy canaries: the context allowlist
// ======================================================================
// Build a context the way the service does, from a household that *has*
// transactions and private purchases, and prove neither reaches the model.
const household = generateTestHouseholdA();
const contextBlob = JSON.stringify(context);
const leakedCanaries = PRIVATE_MERCHANT_CANARIES.filter(name => contextBlob.includes(name));
const counterparties = [...new Set(household.transactions.map(t => t.counterparty))];
const leakedCounterparties = counterparties.filter(name => contextBlob.includes(name));

checks.push(
  check('A7a', 'no private-purchase merchant appears in the context', leakedCanaries, []),
  check('A7b', 'no transaction counterparty appears in the context', leakedCounterparties, []),
  check('A7c', 'no raw transaction appears in the context', /counterpartyType|amountCents/.test(contextBlob), false),
  check('A7d', 'fun money is present as an amount', context.money?.funMoneyPerMonth?.Maya, 300),
  check('A7e', 'but no fun-money status is present', /"within"|"over"|carryover/i.test(contextBlob), false),
  check('A7f', 'no inferred-item detail appears', /inferred|Everyday spending|sortIndex/.test(contextBlob), false),
  check('A7g', 'member names are present, as the allowlist permits', context.household.members.map(m => m.name), ['Maya', 'Jordan']),
  check(
    'A7h',
    'the context is built field by field, never spread from a row',
    readFileSync(join(process.cwd(), '..', '..', 'services', 'agent', 'src', 'context.ts'), 'utf8').includes('there is no spread of'),
    true
  )
);

// ======================================================================
// Mock mode: real HTTP through runTask
// ======================================================================
const mocks: ChildProcess[] = [];

if (MODE === 'mock') {
  const promptLog = join(process.cwd(), '.agent-prompts.test.log');
  if (existsSync(promptLog)) rmSync(promptLog);

  process.env.AGENT_PROMPT_LOG = promptLog;

  const baseMock = await startMock({});
  const mockTiers = tiersFromEnv({
    AGENT_BASE_URL: baseMock.url,
    AGENT_MODEL: 'mock',
  } as NodeJS.ProcessEnv);

  // A real classification over HTTP.
  const classified = await runTask(mockTiers, {
    kind: 'interpret_event',
    context: contextInput,
    instruction: 'The couple said: "We just found out we are pregnant!". Classify it.',
    tool: classifyLifeEventTool,
    parse: args => {
      const parsed = classifyLifeEventSchema.safeParse(args);
      return parsed.success
        ? { ok: true as const, value: parsed.data }
        : { ok: false as const, failure: { gate: 'schema', detail: parsed.error.message } };
    },
  });

  checks.push(
    check('M1', 'a real HTTP round trip classifies the pregnancy', classified.ok && classified.value.templateId, 'baby'),
    check('M2', 'and asks for leave and care', classified.ok ? classified.value.followUps.map(f => f.param) : [], ['leaveMonths', 'care'])
  );

  // An invented number must be rejected, retried, and ultimately fail.
  const inventing = await runTaskWithEnv({ MOCK_INVENT_NUMBER: '1' }, mockTiers);
  const inventingReason = inventing.ok ? '(accepted!)' : inventing.reason;
  checks.push(
    check('M3', 'an invented number is rejected rather than trusted', inventing.ok, false),
    // The gate is the assertion, not a boolean: a rejection for the *wrong*
    // reason would otherwise look like a pass.
    check('M4', 'and the rejection names the numbers gate', gateOf(inventingReason), 'numbers'),
    check('M5', 'it retried before giving up', (inventing.ok ? 0 : inventing.attempts) >= 2, true)
  );

  // Advice language must be rejected too.
  const advising = await runTaskWithEnv({ MOCK_ADVICE: '1' }, mockTiers);
  const advisingReason = advising.ok ? '(accepted!)' : advising.reason;
  checks.push(
    check('M6', 'advice language is rejected', advising.ok, false),
    check('M7', 'and the rejection names the language gate', gateOf(advisingReason), 'language')
  );

  // Thinking on must be treated as a tier failure, not a usable answer.
  const thinking = await runTaskWithEnv({ MOCK_THINKING: '1' }, mockTiers);
  checks.push(
    check('M8', 'reasoning content is treated as thinking-not-off', thinking.ok, false),
    check('M9', 'and says so', (thinking.ok ? '' : thinking.reason).includes('thinking is not off'), true)
  );

  // A 429 must fail over rather than retry forever.
  const rateLimited = await runTaskWithEnv({ MOCK_FAIL_STATUS: '429' }, mockTiers);
  checks.push(
    check('M10', 'a 429 ends in a clean failure, not a hang', rateLimited.ok, false),
    check('M11', 'and reports the status', (rateLimited.ok ? '' : rateLimited.reason).includes('429'), true)
  );

  // A7 again, but against prompts that actually went over the wire.
  const logged = existsSync(promptLog) ? readFileSync(promptLog, 'utf8') : '';
  checks.push(
    check('M12', 'prompts were logged for auditing', logged.length > 0, true),
    check('M13', 'no canary merchant reached a real prompt', PRIVATE_MERCHANT_CANARIES.filter(n => logged.includes(n)), []),
    check('M14', 'no transaction counterparty reached a real prompt', counterparties.filter(n => logged.includes(n)), [])
  );

}

/**
 * The gate named in a rejection reason, so a test can assert *why* something
 * was rejected rather than merely that it was.
 */
function gateOf(reason: string): string {
  const match = reason.match(/\b(schema|numbers|language|length)\b/);
  return match ? match[1]! : reason.slice(0, 70);
}

/** Start a mock on a fresh port and wait until it answers. */
async function startMock(env: Record<string, string>): Promise<{ url: string }> {
  const port = nextMockPort++;
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      join(process.cwd(), '..', '..', 'services', 'agent', 'src', 'mock-server.ts'),
    ],
    { env: { ...process.env, MOCK_PORT: String(port), ...env }, stdio: 'ignore' }
  );
  mocks.push(child);
  const url = mockUrlFor(port);
  await waitForMock(url);
  return { url };
}

/** Re-run the naming task against a mock started with behaviour knobs set. */
async function runTaskWithEnv(
  env: Record<string, string>,
  _tiers: ReturnType<typeof tiersFromEnv>
): Promise<Awaited<ReturnType<typeof runTask<{ picks: unknown[] }>>>> {
  const { url } = await startMock(env);
  const tiers = tiersFromEnv({ AGENT_BASE_URL: url, AGENT_MODEL: 'mock' } as NodeJS.ProcessEnv);

  return runTask(tiers, {
    kind: 'select_branches',
    context: contextInput,
    instruction: 'Choose three candidates and name them.',
    tool: selectBranchesTool,
    parse: args => {
      const parsed = selectBranchesSchema.safeParse(args);
      if (!parsed.success) {
        return { ok: false as const, failure: { gate: 'schema', detail: parsed.error.message } };
      }
      const failure = validatePicks(parsed.data.picks, validIds, context.engineData);
      return failure
        ? { ok: false as const, failure }
        : { ok: true as const, value: parsed.data as { picks: unknown[] } };
    },
  });
}

async function waitForMock(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      });
      if (response.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`mock server did not start on ${url}`);
}

const ok = printTable(`V5 Agent contract (${MODE} mode)`, checks);

if (MODE === 'recorded') {
  console.log('For the HTTP path — retry, failover, thinking detection, prompt logging:');
  console.log('  BRANCHES_AGENT_MODE=mock npm run verify:agent\n');
}
console.log('PENDING A8 — thinking off against the real endpoint. Needs a live key:');
console.log('  NVIDIA_API_KEY=... npm run -w @branches/agent smoke\n');

for (const child of mocks) child.kill();
process.exit(ok ? 0 : 1);
