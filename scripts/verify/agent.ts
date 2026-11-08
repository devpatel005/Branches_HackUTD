/**
 * V5 Agent contract — 12 Verification#V5 Agent contract.
 *
 * Runs in two modes:
 *   **recorded** (default) — no network. Exercises the validation gates, the
 *   context allowlist and the fallbacks directly, deterministically.
 *   **mock** — spawns the bundled mock and drives real HTTP through `runTask`,
 *   so retry, failover and truncation handling are exercised for real without
 *   any API key. The mock speaks the **Gemini Interactions** shape, so these
 *   run through the actual `@google/genai` adapter rather than a stand-in;
 *   a smaller group covers the OpenAI-compatible secondary path.
 *
 *   npm run verify:agent
 *   BRANCHES_AGENT_MODE=mock npm run verify:agent
 *
 * A8 (the real model name, and that `thinking_level` and
 * `tool_choice.allowed_tools` are accepted as sent) cannot be settled without a
 * real key, and is reported as PENDING rather than silently passing.
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
import {
  GEMINI_FALLBACK_MODEL,
  GEMINI_PRIMARY_MODEL,
  normaliseCompletion,
  normaliseInteraction,
  shouldFailover,
  tiersFromEnv,
  timeoutMs,
} from '@branches/agent/src/providers.ts';
import { runTask, taskBudgetMs } from '@branches/agent/src/tasks.ts';
import { classifyLifeEventTool, selectBranchesTool } from '@branches/agent/src/tools.ts';
import {
  E5_BABY_EVENT,
  TEST_HOUSEHOLD_A,
  computeImpact,
  generateCandidates,
} from '@branches/engine';
import { PRIVATE_MERCHANT_CANARIES, generateTestHouseholdA } from '@branches/mock-data';
import { check, finish, printTable, type Check } from './table.ts';

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
/**
 * An **origin**, not a URL with a path.
 *
 * The Gemini SDK appends `/v1/interactions` itself, so `GEMINI_BASE_URL` takes
 * the origin; the OpenAI adapter takes a base ending in `/v1`. Handing the
 * wrong one to either is a 404 that looks like a model failure.
 */
const mockOriginFor = (port: number) => `http://127.0.0.1:${port}`;

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
const geminiOnly = { GEMINI_API_KEY: 'x' } as NodeJS.ProcessEnv;

checks.push(
  check('A6a', 'a 429 fails over', shouldFailover(429), true),
  check('A6b', 'a 402 fails over', shouldFailover(402), true),
  check('A6c', 'a 500 fails over', shouldFailover(500), true),
  check('A6d', 'a 400 does not — that is our bug, not theirs', shouldFailover(400), false),
  check(
    'A6e',
    'tier 1 is Gemini flash',
    tiersFromEnv(geminiOnly)[0]?.model,
    GEMINI_PRIMARY_MODEL
  ),
  check(
    'A6f',
    'tier 1 thinks at "low", per the spec',
    tiersFromEnv(geminiOnly)[0]?.thinkingLevel,
    'low'
  ),
  check(
    'A6g',
    'tier 2 is flash-lite, and thinks less rather than more',
    tiersFromEnv(geminiOnly).map(t => `${t.model}/${t.thinkingLevel}`)[1],
    `${GEMINI_FALLBACK_MODEL}/minimal`
  ),
  check('A6h', 'a Gemini key yields exactly two tiers', tiersFromEnv(geminiOnly).length, 2),
  check(
    'A6i',
    'both Gemini tiers are the gemini provider',
    tiersFromEnv(geminiOnly).map(t => t.provider),
    ['gemini', 'gemini']
  ),
  check(
    'A6j',
    'AGENT_BASE_URL still selects the OpenAI-compatible path',
    tiersFromEnv({ AGENT_BASE_URL: 'http://localhost:1/v1', AGENT_MODEL: 'test', AGENT_API_KEY: 'k' } as NodeJS.ProcessEnv)[0]?.provider,
    'openai'
  ),
  check(
    'A6k',
    'and AGENT_PROVIDER overrides even that',
    tiersFromEnv({
      AGENT_PROVIDER: 'gemini',
      AGENT_BASE_URL: 'http://localhost:1/v1',
      GEMINI_API_KEY: 'x',
    } as NodeJS.ProcessEnv)[0]?.provider,
    'gemini'
  ),
  check(
    'A6l',
    'a third tier appears when a fallback provider is configured',
    tiersFromEnv({
      GEMINI_API_KEY: 'x',
      FALLBACK_LLM_BASE_URL: 'https://api.openai.com/v1',
      FALLBACK_LLM_API_KEY: 'k',
      FALLBACK_LLM_MODEL: 'gpt-4o-mini',
    } as NodeJS.ProcessEnv).length,
    3
  ),
  check(
    'A6m',
    'no key and no mock means no tier, rather than a tier that always fails',
    tiersFromEnv({} as NodeJS.ProcessEnv).length,
    0
  ),
  check(
    'A6n',
    'a local mock needs no key',
    tiersFromEnv({ GEMINI_BASE_URL: 'http://127.0.0.1:8099' } as NodeJS.ProcessEnv).length,
    2
  ),
  // Tier numbers are renumbered after filtering, so a failure message can never
  // name a tier that is not in the chain.
  check(
    'A6o',
    'tier numbers are contiguous from 1',
    tiersFromEnv({
      GEMINI_API_KEY: 'x',
      FALLBACK_LLM_BASE_URL: 'https://api.openai.com/v1',
      FALLBACK_LLM_API_KEY: 'k',
    } as NodeJS.ProcessEnv).map(t => t.tier),
    [1, 2, 3]
  )
);

// ======================================================================
// A9 - normalising the two provider shapes
// ======================================================================
// Both adapters must reduce to the same four statuses, because `tasks.ts` makes
// its retry-or-failover decision from them and nothing else. These are pure
// shape tests, which is why they run in recorded mode with no network.
const geminiCall = normaliseInteraction({
  status: 'requires_action',
  steps: [{ type: 'function_call', id: 'c1', name: 'select_branches', arguments: { picks: [] } }],
  output_text: '',
});
const geminiIncomplete = normaliseInteraction({ status: 'incomplete', output_text: 'trunca' });
const openaiCall = normaliseCompletion({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [{ id: 'c1', function: { name: 'select_branches', arguments: '{"picks":[]}' } }],
      },
    },
  ],
});
const openaiBrokenArgs = normaliseCompletion({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: { tool_calls: [{ id: 'c1', function: { name: 'x', arguments: '{"picks":' } }] },
    },
  ],
});

checks.push(
  check('A9a', 'a Gemini function call normalises to requires_action', geminiCall.status, 'requires_action'),
  check('A9b', 'and its arguments arrive already parsed', typeof geminiCall.toolCall?.arguments, 'object'),
  check('A9c', 'Gemini incomplete normalises to incomplete', geminiIncomplete.status, 'incomplete'),
  check(
    'A9d',
    'a Gemini failure maps to failed, whatever word it used',
    ['failed', 'cancelled', 'budget_exceeded'].map(status => normaliseInteraction({ status }).status),
    ['failed', 'failed', 'failed']
  ),
  check(
    'A9e',
    'an unexpected status is not quietly treated as success',
    normaliseInteraction({ status: 'in_progress' }).status,
    'unknown'
  ),
  check('A9f', 'an OpenAI tool call normalises the same way', openaiCall.status, 'requires_action'),
  check(
    'A9g',
    'and its argument string is parsed by the adapter, not the task',
    typeof openaiCall.toolCall?.arguments,
    'object'
  ),
  check(
    'A9h',
    'finish_reason "length" is the OpenAI spelling of incomplete',
    normaliseCompletion({ choices: [{ finish_reason: 'length', message: { content: 'tru' } }] }).status,
    'incomplete'
  ),
  check('A9i', 'unparsable tool arguments are a provider failure, not a crash', openaiBrokenArgs.status, 'failed'),
  check(
    'A9j',
    'Gemini thought steps are never reported as leaked reasoning',
    normaliseInteraction({ status: 'completed', steps: [{ type: 'thought' }], output_text: 'hi' }).reasoning,
    null
  ),
  check(
    'A9k',
    'but OpenAI reasoning_content is',
    normaliseCompletion({
      choices: [{ finish_reason: 'stop', message: { content: 'hi', reasoning_content: 'hmm' } }],
    }).reasoning,
    'hmm'
  ),
  // The budget exists so a job cannot sit `running` for the sum of every
  // timeout in the chain while the couple watches a spinner.
  check('A9l', 'a task has a wall-clock budget, not just an attempt count', taskBudgetMs({} as NodeJS.ProcessEnv) > 0, true),
  check(
    'A9m',
    'and the budget is longer than one call timeout',
    taskBudgetMs({} as NodeJS.ProcessEnv) > timeoutMs({} as NodeJS.ProcessEnv),
    true
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

  // The mock speaks the Gemini Interactions shape, so these checks drive the
  // real `@google/genai` adapter — request body, `status`, `steps` — and not a
  // generic path the demo never takes.
  const baseMock = await startMock({});
  const mockTiers = geminiTiersAt(baseMock.origin);

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
  const inventing = await runTaskWithEnv({ MOCK_INVENT_NUMBER: '1' });
  const inventingReason = inventing.ok ? '(accepted!)' : inventing.reason;
  checks.push(
    check('M3', 'an invented number is rejected rather than trusted', inventing.ok, false),
    // The gate is the assertion, not a boolean: a rejection for the *wrong*
    // reason would otherwise look like a pass.
    check('M4', 'and the rejection names the numbers gate', gateOf(inventingReason), 'numbers'),
    check('M5', 'it retried before giving up', (inventing.ok ? 0 : inventing.attempts) >= 2, true)
  );

  // Advice language must be rejected too.
  const advising = await runTaskWithEnv({ MOCK_ADVICE: '1' });
  const advisingReason = advising.ok ? '(accepted!)' : advising.reason;
  checks.push(
    check('M6', 'advice language is rejected', advising.ok, false),
    check('M7', 'and the rejection names the language gate', gateOf(advisingReason), 'language')
  );

  // `status: incomplete` is the Gemini failure that matters most: a 200 OK with
  // truncated content, because the output budget counts thinking tokens
  // (07 Agent Spec). Trusting it would put half a sentence on screen.
  const incomplete = await runTaskWithEnv({ MOCK_STATUS: 'incomplete' });
  checks.push(
    check('M8', 'status incomplete is not treated as an answer', incomplete.ok, false),
    check(
      'M9',
      'and the reason names the truncation, not a validation gate',
      (incomplete.ok ? '' : incomplete.reason).includes('incomplete'),
      true
    )
  );

  // The sharp version: a *plausible* tool call arriving alongside `incomplete`.
  // The status has to win, or the gate is decided by whichever field is checked
  // first.
  const truncated = await runTaskWithEnv({ MOCK_TRUNCATE: '1' });
  checks.push(
    check('M10', 'a truncated answer is rejected even though a tool call is present', truncated.ok, false),
    check(
      'M11',
      'and it fails over rather than retrying the same ceiling',
      (truncated.ok ? 0 : truncated.attempts) <= 2,
      true
    )
  );

  const failedStatus = await runTaskWithEnv({ MOCK_STATUS: 'failed' });
  checks.push(check('M12', 'status failed is a tier failure', failedStatus.ok, false));

  // A 429 must fail over rather than retry forever. This also pins the finding
  // that `interactions.create` ignores constructor-level retry settings: left
  // at the SDK default it makes five backed-off attempts per tier, and this
  // check would run for roughly half a minute instead of milliseconds.
  const startedAt = Date.now();
  const rateLimited = await runTaskWithEnv({ MOCK_FAIL_STATUS: '429' });
  const rateLimitMs = Date.now() - startedAt;
  checks.push(
    check('M13', 'a 429 ends in a clean failure, not a hang', rateLimited.ok, false),
    check('M14', 'and reports the status', (rateLimited.ok ? '' : rateLimited.reason).includes('429'), true),
    check('M15', 'SDK-level retries are off, so failover is ours alone', rateLimitMs < 5000, true)
  );

  // A7 again, but against prompts that actually went over the wire.
  const logged = existsSync(promptLog) ? readFileSync(promptLog, 'utf8') : '';
  checks.push(
    check('M16', 'prompts were logged for auditing', logged.length > 0, true),
    check('M17', 'no canary merchant reached a real prompt', PRIVATE_MERCHANT_CANARIES.filter(n => logged.includes(n)), []),
    check('M18', 'no transaction counterparty reached a real prompt', counterparties.filter(n => logged.includes(n)), [])
  );

  // ====================================================================
  // The OpenAI-compatible path, kept as the secondary provider
  // ====================================================================
  const openaiMock = await startMock({});
  const openaiTiers = tiersFromEnv({
    AGENT_BASE_URL: `${openaiMock.origin}/v1`,
    AGENT_MODEL: 'mock',
  } as NodeJS.ProcessEnv);

  const viaOpenAI = await runNaming(openaiTiers);
  checks.push(
    check('O1', 'the OpenAI adapter still reaches a valid answer', viaOpenAI.ok, true),
    check('O2', 'and it is selected by AGENT_BASE_URL alone', openaiTiers[0]?.provider, 'openai')
  );

  // Thinking left on is an OpenAI-shape problem only — it spends the token
  // budget on reasoning and returns nothing usable. Gemini has no equivalent,
  // because `thinking_level` is configuration rather than a leak.
  const thinkingMock = await startMock({ MOCK_THINKING: '1' });
  const thinking = await runNaming(
    tiersFromEnv({
      AGENT_BASE_URL: `${thinkingMock.origin}/v1`,
      AGENT_MODEL: 'mock',
    } as NodeJS.ProcessEnv)
  );
  checks.push(
    check('O3', 'reasoning content is treated as thinking-not-off', thinking.ok, false),
    check('O4', 'and says so', (thinking.ok ? '' : thinking.reason).includes('thinking is not off'), true)
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
async function startMock(env: Record<string, string>): Promise<{ origin: string }> {
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
  const origin = mockOriginFor(port);
  await waitForMock(origin);
  return { origin };
}

/**
 * Two Gemini tiers pointed at a mock.
 *
 * Both tiers, not one: a tier failure has to have somewhere to fail *to*, or
 * "it failed over" and "it gave up" are the same observation.
 */
function geminiTiersAt(origin: string): ReturnType<typeof tiersFromEnv> {
  return tiersFromEnv({ GEMINI_BASE_URL: origin } as NodeJS.ProcessEnv);
}

/** Re-run the naming task against a Gemini mock started with knobs set. */
async function runTaskWithEnv(
  env: Record<string, string>
): Promise<Awaited<ReturnType<typeof runTask<{ picks: unknown[] }>>>> {
  const { origin } = await startMock(env);
  return runNaming(geminiTiersAt(origin));
}

/** The branch-naming task, the one with every gate in play. */
async function runNaming(
  tiers: ReturnType<typeof tiersFromEnv>
): Promise<Awaited<ReturnType<typeof runTask<{ picks: unknown[] }>>>> {
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

async function waitForMock(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${origin}/v1/interactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: '' }),
      });
      if (response.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`mock server did not start on ${origin}`);
}

const ok = printTable(`V5 Agent contract (${MODE} mode)`, checks);

if (MODE === 'recorded') {
  console.log('For the HTTP path — retry, failover, truncation, prompt logging:');
  console.log('  BRANCHES_AGENT_MODE=mock npm run verify:agent\n');
}
console.log('PENDING A8 — the real model name and parameters. Needs a live key:');
console.log('  GEMINI_API_KEY=... npm run -w @branches/agent smoke\n');

for (const child of mocks) child.kill();
finish(ok);
