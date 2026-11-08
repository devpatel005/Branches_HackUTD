import { SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import {
  DEFAULT_ASSUMPTIONS,
  ENGINE_VERSION,
  baselineFromItems,
  f1SavingsNoInterest,
  followUpForGapAnswer,
  computeImpact as computeImpactWithEngine,
  checkAffordability as checkAffordabilityWithEngine,
  closestOption as closestOptionWithEngine,
  generateBridges as generateBridgesWithEngine,
  generateCandidates as generateCandidatesWithEngine,
  leverSetSignature,
  statsFor,
  templateName,
  templateSummary,
  delayDomain,
  shrinkDomain,
  saveMoreCap,
  SAVE_MORE_STEP,
  simulate as simulateWithEngine,
  EVENT_TEMPLATES,
  askedParams,
  inferBaseline,
  isLiquidSavingsQuestion,
  liquidSavingsFromRange,
  liquidSavingsGapQuestion,
  toIntegerCents,
  type Assumptions,
  type Baseline,
  type CounterpartyType,
  type GapQuestion,
  type Goal,
  type InferredItem,
  type Candidate,
  type Constraint,
  type Levers,
  type LifeEvent,
  type LifeEventTemplateId,
  type SimulationInput,
  type Transaction,
} from '@branches/engine';
import {
  DEMO_NAMES,
  TEST_HOUSEHOLD_A_FUN_MONEY,
  TEST_HOUSEHOLD_A_LIQUID_SAVINGS,
  generateTestHouseholdA,
} from '@branches/mock-data';
import spacetimedb from './schema.ts';
import { AGENT_SHARED_SECRET } from './agent-secret.ts';

/**
 * Branches reducers.
 *
 * Core logic lives here (02 Ground Rules #7): inference and, from Stage 3, the
 * plan math all run inside reducers by calling `packages/engine`. Reducers never
 * recompute anything themselves — they marshal rows in and out of the engine.
 */
export { default } from './schema.ts';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const COUNTER_ID = 0;
const ONBOARDING_DEMO_PROFILE = 'test-household-a';

// ---------------------------------------------------------------------------
// Client visibility (05 Data Model#Visibility)
// ---------------------------------------------------------------------------

/**
 * Per-owner row filtering, confirmed available in Stage 0.
 *
 * A member subscribing to these tables receives **only their own rows**. This
 * is why "each partner sees only their own items to confirm" is enforced by the
 * database rather than by the UI — and why the agent, which connects as an
 * ordinary client, can never subscribe to a transaction at all.
 *
 * Partner *progress* still has to be visible, so it comes from the
 * `onboardingProgress` view below, which exposes counts and nothing else.
 */
export const transactionVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM transaction WHERE owner_identity = :sender'
);

export const inferredItemVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM inferred_item WHERE owner_identity = :sender'
);

export const gapQuestionVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM gap_question WHERE owner_identity = :sender'
);

// ---------------------------------------------------------------------------
// Onboarding progress view
// ---------------------------------------------------------------------------

// NOT named `OnboardingProgress`: the `onboarding_progress` view accessor
// already generates that PascalCase name, and reusing it fails schema
// inspection with "name is used for multiple types".
const MemberProgress = t.row('MemberProgress', {
  memberId: t.u64().primaryKey(),
  householdId: t.u64(),
  displayName: t.string(),
  colorKey: t.string(),
  itemsConfirmed: t.u32(),
  itemsTotal: t.u32(),
  gapsAnswered: t.u32(),
  gapsTotal: t.u32(),
  funMoneySet: t.bool(),
  online: t.bool(),
});

/**
 * Counts only — never labels, amounts or counterparties.
 *
 * This is the one thing a partner may know about the other's side of
 * onboarding: "Jordan: 4 of 5" (03 User Journey#2. Onboarding). Deliberately a
 * separate surface from the filtered tables, so widening what the UI shows
 * cannot accidentally widen what it can read.
 */
export const onboardingProgress = spacetimedb.anonymousView(
  { name: 'onboarding_progress', public: true },
  t.array(MemberProgress),
  ctx =>
    [...ctx.db.member.iter()]
      .filter(m => m.role === 'member')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(m => {
        const items = [...ctx.db.inferredItem.householdId.filter(m.householdId)].filter(
          i => i.ownerMemberId === m.id
        );
        const gaps = [...ctx.db.gapQuestion.householdId.filter(m.householdId)].filter(
          g => g.ownerMemberId === m.id
        );
        const fun = ctx.db.funMoney.memberId.find(m.id);
        return {
          memberId: m.id,
          householdId: m.householdId,
          displayName: m.displayName,
          colorKey: m.colorKey,
          itemsConfirmed: items.filter(i => i.status !== 'pending').length,
          itemsTotal: items.length,
          gapsAnswered: gaps.filter(g => g.answer !== undefined).length,
          gapsTotal: gaps.length,
          funMoneySet: fun !== null && fun !== undefined,
          online: m.online,
        };
      })
);

// ---------------------------------------------------------------------------
// Input limits (Stage 8 hardening)
// ---------------------------------------------------------------------------

/**
 * Every string and number a client can send has a bound.
 *
 * The reason is not malice. A reducer argument goes straight into a row, and
 * `household`, `member`, `goal` and `chat_message` are all public tables — so an
 * unbounded string is not one client's problem, it is a row every subscriber in
 * the household downloads, forever. Nothing above validated length before this
 * pass; ownership and enums were checked, size was not.
 *
 * Two different policies, deliberately:
 *   - **Free text is truncated.** A clipped name is recoverable and never
 *     interrupts what someone was doing.
 *   - **Numbers are rejected.** Silently clamping somebody's money to a
 *     different number is worse than refusing it, because the plan would then
 *     be built on a figure they never typed.
 */
const MAX_DISPLAY_NAME = 40;
const MAX_GOAL_TITLE = 60;
const MAX_ICON = 8;
const MAX_LABEL = 80;
const MAX_GAP_ANSWER = 200;
const MAX_PARAM_VALUE = 120;
/** Every template's parameter count is in single figures; this is slack. */
const MAX_PARAM_ENTRIES = 24;
/** A constraint is a small JSON object; anything larger is not one. */
const MAX_CONSTRAINT_JSON = 2000;
/** A join code is 6 characters. */
const MAX_JOIN_CODE = 16;

/**
 * $1,000,000 in cents.
 *
 * Below `i32` max ($21,474,836) with room to spare, so no amount that passes
 * this can overflow the column it is stored in — and 120 months of compounding
 * on it stays finite, which keeps `toCents` from throwing deep inside the
 * engine where the only remaining signal is a reducer-wide failure.
 */
const MAX_MONEY_CENTS = 100_000_000;

/** Truncate free text to a storable length. */
function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** A trimmed, length-capped string. */
function capTrim(value: string, max: number): string {
  return cap(value.trim(), max);
}

/**
 * Reject a money amount outside the plausible range.
 *
 * `Number.isFinite` is not redundant: `t.i32()` constrains the wire format, but
 * these helpers are also reachable from values the engine or a JSON payload
 * produced, where `NaN` is possible and would otherwise pass every `<`
 * comparison silently.
 */
function requireMoneyCents(cents: number, field: string, min: number): number {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new SenderError(`${field} must be a whole number of cents`);
  }
  if (cents < min) throw new SenderError(`${field} cannot be below ${min / 100}`);
  if (cents > MAX_MONEY_CENTS) {
    throw new SenderError(`${field} must be at most $${MAX_MONEY_CENTS / 100}`);
  }
  return cents;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The caller's member row, or a rejection. */
function requireMember(ctx: Ctx) {
  const m = ctx.db.member.identity.find(ctx.sender);
  if (!m) throw new SenderError('you are not a member of a household');
  return m;
}

/**
 * Plan-changing reducers reject the agent: the agent proposes, humans decide
 * (02 Ground Rules #4).
 */
function requireHuman(ctx: Ctx) {
  const m = requireMember(ctx);
  if (m.role === 'agent') throw new SenderError('the agent cannot change the plan');
  return m;
}

/**
 * `YYYY-MM` from the server timestamp — the only clock in the system, and
 * deterministic per reducer call.
 *
 * Done with integer arithmetic rather than `new Date(ms)` on purpose: the
 * SpacetimeDB module runtime does not guarantee stdlib clock types, and this
 * cannot be caught at build time. The algorithm is the standard
 * days-to-civil-date conversion, shifting the epoch to 0000-03-01 so leap days
 * land at the end of the cycle.
 */
function currentMonthFrom(ctx: Ctx): string {
  const days = Number(ctx.timestamp.microsSinceUnixEpoch / 86_400_000_000n);
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** Unambiguous alphabet: no I, O, 0 or 1 for a code people read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeJoinCode(ctx: Ctx): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[ctx.random.integerInRange(0, CODE_ALPHABET.length - 1)];
    }
    if (!ctx.db.household.joinCode.find(code)) return code;
  }
  throw new SenderError('could not allocate a join code; try again');
}

function recomputeBaseline(ctx: Ctx, householdId: bigint, changedBy?: bigint): void {
  const members = [...ctx.db.member.householdId.filter(householdId)].filter(
    m => m.role === 'member'
  );

  // Only confirmed or edited items count. Rejected and pending ones do not.
  const items: InferredItem[] = [...ctx.db.inferredItem.householdId.filter(householdId)]
    .filter(i => i.status === 'confirmed' || i.status === 'edited')
    .map(i => ({
      ownerMemberId: String(i.ownerMemberId),
      kind: i.kind as InferredItem['kind'],
      label: i.label,
      monthly: i.monthlyCents / 100,
      occurrences: 0,
      recurring: true,
    }));

  const funMoneyByMember: Record<string, number> = {};
  for (const m of members) {
    const fun = ctx.db.funMoney.memberId.find(m.id);
    funMoneyByMember[String(m.id)] = fun ? fun.monthlyCents / 100 : 0;
  }

  const existing = ctx.db.baseline.householdId.find(householdId);
  // An answered range wins; otherwise keep whatever is stored (seeded for the
  // demo household), falling back to the fixture only on a fresh row.
  const answeredLiquid = liquidSavingsFromAnswers(ctx, householdId);
  const liquidSavings =
    answeredLiquid ??
    (existing ? existing.liquidSavingsCents / 100 : TEST_HOUSEHOLD_A_LIQUID_SAVINGS);

  const next = baselineFromItems(items, funMoneyByMember, liquidSavings);

  const incomeByMember = members
    .map(m => ({ memberId: m.id, cents: toIntegerCents(next.incomeByMember[String(m.id)] ?? 0) }))
    .sort((a, b) => (a.memberId < b.memberId ? -1 : 1));

  const row = {
    householdId,
    incomeByMember,
    fixedCents: toIntegerCents(next.fixed),
    debtCents: toIntegerCents(next.debt),
    flexibleCents: toIntegerCents(next.flexible),
    retirementCents: toIntegerCents(next.retirement),
    liquidSavingsCents: toIntegerCents(liquidSavings),
  };

  if (existing) ctx.db.baseline.householdId.update(row);
  else ctx.db.baseline.insert(row);

  // 05 Data Model#Rules: anything that moves the baseline must recompute the
  // projection, so a client can never read one that disagrees with the other.
  recomputeProjection(ctx, householdId, changedBy);
}

/** Sum of the answered liquid-savings ranges, or null when none are answered. */
function liquidSavingsFromAnswers(ctx: Ctx, householdId: bigint): number | null {
  let total = 0;
  let answered = false;
  for (const q of [...ctx.db.gapQuestion.householdId.filter(householdId)]) {
    if (!isLiquidSavingsQuestion(q.subject)) continue;
    if (q.answer === undefined || q.answer === null) continue;
    const dollars = liquidSavingsFromRange(q.answer);
    if (dollars === null) continue;
    total += dollars;
    answered = true;
  }
  return answered ? total : null;
}

function assumptionsFor(ctx: Ctx, householdId: bigint): Assumptions {
  const row = ctx.db.assumption.householdId.find(householdId);
  if (!row) return DEFAULT_ASSUMPTIONS;
  return {
    savingsRateAnnual: row.savingsRateBps / 10000,
    inflationAnnual: row.inflationBps / 10000,
    mortgageRateAnnual: row.mortgageRateBps / 10000,
    carRateAnnual: row.carRateBps / 10000,
  };
}

/**
 * Run the engine and store the projection (05 Data Model#Rules: any reducer that
 * changes goals, assumptions, baseline or the committed plan calls this).
 *
 * The engine runs **here**, inside the reducer, which is what keeps every number
 * a user sees traceable to `packages/engine` (02 Ground Rules #1 and #7). The
 * reducer's only job is converting integer cents and basis points into the
 * engine's dollars and rates, and storing what comes back.
 */
function recomputeProjection(ctx: Ctx, householdId: bigint, changedBy?: bigint): void {
  // Built by the single `simulationInputFor`, so the committed plan, an impact
  // and a branch candidate can never disagree about the household they
  // describe. Duplicating this was a real risk: Stage 5's committed saveMore
  // would have applied to candidates but not to the plan they were measured
  // against.
  const input = simulationInputFor(ctx, householdId);
  if (!input) return;

  const output = simulateWithEngine(input);

  const existing = ctx.db.planProjection.householdId.find(householdId);
  const row = {
    householdId,
    version: (existing?.version ?? 0) + 1,
    json: JSON.stringify(output),
    updatedAt: ctx.timestamp,
    lastChangedBy: changedBy,
  };
  if (existing) ctx.db.planProjection.householdId.update(row);
  else ctx.db.planProjection.insert(row);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  ctx.db.counter.insert({
    id: COUNTER_ID,
    value: 0,
    engineCheck: f1SavingsNoInterest(12000, 24),
    engineVersion: ENGINE_VERSION,
    lastBumpedBy: undefined,
  });
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const m = ctx.db.member.identity.find(ctx.sender);
  if (m) ctx.db.member.id.update({ ...m, online: true, lastSeenAt: ctx.timestamp });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const m = ctx.db.member.identity.find(ctx.sender);
  if (!m) return;
  ctx.db.member.id.update({ ...m, online: false, lastSeenAt: ctx.timestamp });

  // Session presence has to go too, or a closed laptop would still count as
  // "present" and the ready check could commit without them
  // (08 Live Session Spec#Presence: absent within ~5 seconds).
  const inSession = ctx.db.sessionMember.memberId.find(m.id);
  if (inSession?.present) {
    ctx.db.sessionMember.memberId.update({
      ...inSession,
      present: false,
      ready: false,
      readyAt: undefined,
    });
  }
});

// ---------------------------------------------------------------------------
// Household
// ---------------------------------------------------------------------------

export const createHousehold = spacetimedb.reducer(
  { displayName: t.string() },
  (ctx, { displayName }) => {
    if (ctx.db.member.identity.find(ctx.sender)) {
      throw new SenderError('you are already in a household');
    }
    const h = ctx.db.household.insert({
      id: 0n,
      joinCode: makeJoinCode(ctx),
      name: 'Our plan',
      currentMonth: currentMonthFrom(ctx),
      createdAt: ctx.timestamp,
      onboarded: false,
    });
    ctx.db.member.insert({
      id: 0n,
      householdId: h.id,
      identity: ctx.sender,
      displayName: capTrim(displayName, MAX_DISPLAY_NAME) || 'Partner A',
      colorKey: 'a',
      role: 'member',
      online: true,
      lastSeenAt: ctx.timestamp,
    });
    const a = DEFAULT_ASSUMPTIONS;
    ctx.db.assumption.insert({
      householdId: h.id,
      savingsRateBps: Math.round(a.savingsRateAnnual * 10000),
      inflationBps: Math.round(a.inflationAnnual * 10000),
      mortgageRateBps: Math.round(a.mortgageRateAnnual * 10000),
      carRateBps: Math.round(a.carRateAnnual * 10000),
    });
  }
);

export const joinHousehold = spacetimedb.reducer(
  { joinCode: t.string(), displayName: t.string() },
  (ctx, { joinCode, displayName }) => {
    if (ctx.db.member.identity.find(ctx.sender)) {
      throw new SenderError('you are already in a household');
    }
    const h = ctx.db.household.joinCode.find(capTrim(joinCode, MAX_JOIN_CODE).toUpperCase());
    if (!h) throw new SenderError('no household with that code');

    const existing = [...ctx.db.member.householdId.filter(h.id)].filter(
      m => m.role === 'member'
    );
    // The data model supports more than two members; the demo uses two
    // (OPEN(OD-12)), and colour keys run a, b, c... in join order.
    const colorKey = String.fromCharCode('a'.charCodeAt(0) + existing.length);

    ctx.db.member.insert({
      id: 0n,
      householdId: h.id,
      identity: ctx.sender,
      displayName: capTrim(displayName, MAX_DISPLAY_NAME) || `Partner ${colorKey.toUpperCase()}`,
      colorKey,
      role: 'member',
      online: true,
      lastSeenAt: ctx.timestamp,
    });
  }
);

export const setDisplayName = spacetimedb.reducer(
  { displayName: t.string() },
  (ctx, { displayName }) => {
    const m = requireMember(ctx);
    const name = capTrim(displayName, MAX_DISPLAY_NAME);
    if (!name) throw new SenderError('a name cannot be empty');
    ctx.db.member.id.update({ ...m, displayName: name });
  }
);

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

/**
 * Seed mock transactions for the whole household (dev and demo only).
 *
 * The generator is deterministic (11 Mock Data), so reseeding restores the exact
 * same starting state — which is what makes the demo repeatable.
 */
export const seedMockData = spacetimedb.reducer(
  { profileId: t.string() },
  (ctx, { profileId }) => {
    const caller = requireHuman(ctx);
    const h = ctx.db.household.id.find(caller.householdId);
    if (!h) throw new SenderError('household not found');
    if (profileId !== ONBOARDING_DEMO_PROFILE) {
      throw new SenderError(`unknown profile: ${profileId}`);
    }

    const members = [...ctx.db.member.householdId.filter(h.id)]
      .filter(m => m.role === 'member')
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (members.length < 2) {
      throw new SenderError('both partners must join before seeding');
    }

    // Clear anything already seeded, so this is idempotent.
    for (const row of [...ctx.db.transaction.householdId.filter(h.id)]) {
      ctx.db.transaction.id.delete(row.id);
    }

    const [a, b] = members;
    const generated = generateTestHouseholdA({
      currentMonth: h.currentMonth,
      memberIds: { a: String(a!.id), b: String(b!.id) },
    });

    const identityByMemberId = new Map(members.map(m => [String(m.id), m.identity]));

    for (const txn of generated.transactions) {
      const ownerIdentity = identityByMemberId.get(txn.ownerMemberId);
      if (!ownerIdentity) continue;
      ctx.db.transaction.insert({
        id: 0n,
        householdId: h.id,
        ownerMemberId: BigInt(txn.ownerMemberId),
        ownerIdentity,
        date: txn.date,
        amountCents: toIntegerCents(txn.amount),
        counterparty: txn.counterparty,
        counterpartyType: txn.counterpartyType,
      });
    }

    // Demo display names, OPEN(OD-1).
    ctx.db.member.id.update({ ...a!, displayName: DEMO_NAMES.a });
    ctx.db.member.id.update({ ...b!, displayName: DEMO_NAMES.b });

    const baselineRow = ctx.db.baseline.householdId.find(h.id);
    const seededSavings = toIntegerCents(TEST_HOUSEHOLD_A_LIQUID_SAVINGS);
    if (baselineRow) {
      ctx.db.baseline.householdId.update({ ...baselineRow, liquidSavingsCents: seededSavings });
    }
  }
);

/**
 * Run deterministic inference over the household's transactions and write the
 * inferred items and gap questions (06 Engine Spec#Baseline inference).
 *
 * Idempotent: existing items and questions are replaced, and a previously
 * answered gap question keeps its answer, keyed by the engine's stable key.
 */
export const runInference = spacetimedb.reducer(ctx => {
  const caller = requireHuman(ctx);
  const householdId = caller.householdId;

  const transactions: Transaction[] = [...ctx.db.transaction.householdId.filter(householdId)].map(
    row => ({
      id: String(row.id),
      ownerMemberId: String(row.ownerMemberId),
      date: row.date,
      amount: row.amountCents / 100,
      counterparty: row.counterparty,
      counterpartyType: row.counterpartyType as CounterpartyType,
    })
  );
  if (transactions.length === 0) throw new SenderError('no transactions to infer from');

  const previousAnswers = new Map<string, string>();
  for (const q of [...ctx.db.gapQuestion.householdId.filter(householdId)]) {
    if (q.answer !== undefined && q.answer !== null) previousAnswers.set(q.engineKey, q.answer);
    ctx.db.gapQuestion.id.delete(q.id);
  }
  for (const item of [...ctx.db.inferredItem.householdId.filter(householdId)]) {
    ctx.db.inferredItem.id.delete(item.id);
  }

  const identityByMemberId = new Map(
    [...ctx.db.member.householdId.filter(householdId)].map(m => [String(m.id), m.identity])
  );

  const result = inferBaseline(transactions);

  result.items.forEach((item, index) => {
    const ownerIdentity = identityByMemberId.get(item.ownerMemberId);
    if (!ownerIdentity) return;
    ctx.db.inferredItem.insert({
      id: 0n,
      householdId,
      ownerMemberId: BigInt(item.ownerMemberId),
      ownerIdentity,
      kind: item.kind,
      label: item.label,
      monthlyCents: toIntegerCents(item.monthly),
      status: 'pending',
      sortIndex: index,
    });
  });

  // Inference reports gaps it *found* in the transactions. A liquid-savings
  // balance is never visible in a transaction stream, so it is asked of every
  // member regardless — which is also why it is not part of inferBaseline's
  // output, and why 11 Mock Data can keep expecting exactly 2 inferred gaps.
  const allQuestions: GapQuestion[] = [
    ...result.gapQuestions,
    ...[...identityByMemberId.keys()].sort().map(memberId => liquidSavingsGapQuestion(memberId)),
  ];

  for (const q of allQuestions) {
    const ownerIdentity = identityByMemberId.get(q.ownerMemberId);
    if (!ownerIdentity) continue;
    ctx.db.gapQuestion.insert({
      id: 0n,
      householdId,
      ownerMemberId: BigInt(q.ownerMemberId),
      ownerIdentity,
      engineKey: q.id,
      prompt: q.prompt,
      answerType: q.answerType,
      options: q.options,
      answer: previousAnswers.get(q.id),
      subject: q.subject,
    });
  }

  recomputeBaseline(ctx, householdId, caller.id);
});

/** Only the owner may touch their own inferred item. */
function requireOwnItem(ctx: Ctx, itemId: bigint) {
  const caller = requireHuman(ctx);
  const item = ctx.db.inferredItem.id.find(itemId);
  if (!item) throw new SenderError('item not found');
  if (item.ownerMemberId !== caller.id) throw new SenderError('that is not your item');
  return { caller, item };
}

export const confirmItem = spacetimedb.reducer({ itemId: t.u64() }, (ctx, { itemId }) => {
  const { caller, item } = requireOwnItem(ctx, itemId);
  ctx.db.inferredItem.id.update({ ...item, status: 'confirmed' });
  recomputeBaseline(ctx, caller.householdId, caller.id);
});

export const editItem = spacetimedb.reducer(
  { itemId: t.u64(), monthlyCents: t.i32() },
  (ctx, { itemId, monthlyCents }) => {
    const { caller, item } = requireOwnItem(ctx, itemId);
    requireMoneyCents(monthlyCents, 'an amount', 0);
    ctx.db.inferredItem.id.update({ ...item, monthlyCents, status: 'edited' });
    recomputeBaseline(ctx, caller.householdId, caller.id);
  }
);

export const rejectItem = spacetimedb.reducer({ itemId: t.u64() }, (ctx, { itemId }) => {
  const { caller, item } = requireOwnItem(ctx, itemId);
  ctx.db.inferredItem.id.update({ ...item, status: 'rejected' });
  recomputeBaseline(ctx, caller.householdId, caller.id);
});

/** Confirm every still-pending item of the caller's, for the "looks right" tap. */
export const confirmAllMyItems = spacetimedb.reducer(ctx => {
  const caller = requireHuman(ctx);
  for (const item of [...ctx.db.inferredItem.householdId.filter(caller.householdId)]) {
    if (item.ownerMemberId === caller.id && item.status === 'pending') {
      ctx.db.inferredItem.id.update({ ...item, status: 'confirmed' });
    }
  }
  recomputeBaseline(ctx, caller.householdId, caller.id);
});

/**
 * Answer a gap question.
 *
 * Answering "Investing" reclassifies the brokerage item as an
 * `external_account` and asks for a balance range, because that money might be
 * reachable for goals. "Retirement" settles it — set aside, no balance needed in
 * v1 (03 User Journey#2. Onboarding).
 */
export const answerGap = spacetimedb.reducer(
  { questionId: t.u64(), answer: t.string() },
  (ctx, { questionId, answer }) => {
    const caller = requireHuman(ctx);
    const q = ctx.db.gapQuestion.id.find(questionId);
    if (!q) throw new SenderError('question not found');
    if (q.ownerMemberId !== caller.id) throw new SenderError('that is not your question');
    if (q.options.length > 0 && !q.options.includes(answer)) {
      throw new SenderError(`answer must be one of: ${q.options.join(', ')}`);
    }

    ctx.db.gapQuestion.id.update({ ...q, answer: capTrim(answer, MAX_GAP_ANSWER) });

    const engineQuestion: GapQuestion = {
      id: q.engineKey,
      ownerMemberId: String(q.ownerMemberId),
      prompt: q.prompt,
      answerType: q.answerType as GapQuestion['answerType'],
      options: q.options,
      subject: q.subject,
    };
    const followUp = followUpForGapAnswer(engineQuestion, answer);

    if (followUp) {
      for (const item of [...ctx.db.inferredItem.householdId.filter(caller.householdId)]) {
        if (item.ownerMemberId === caller.id && item.label === q.subject) {
          ctx.db.inferredItem.id.update({ ...item, kind: followUp.reclassifyTo });
        }
      }
      const alreadyAsked = [...ctx.db.gapQuestion.householdId.filter(caller.householdId)].some(
        existing => existing.engineKey === followUp.question.id
      );
      if (!alreadyAsked) {
        ctx.db.gapQuestion.insert({
          id: 0n,
          householdId: caller.householdId,
          ownerMemberId: caller.id,
          ownerIdentity: caller.identity,
          engineKey: followUp.question.id,
          prompt: followUp.question.prompt,
          answerType: followUp.question.answerType,
          options: followUp.question.options,
          answer: undefined,
          subject: followUp.question.subject,
        });
      }
    }

    recomputeBaseline(ctx, caller.householdId, caller.id);
  }
);

export const setFunMoney = spacetimedb.reducer(
  { monthlyCents: t.i32() },
  (ctx, { monthlyCents }) => {
    const caller = requireHuman(ctx);
    requireMoneyCents(monthlyCents, 'fun money', 0);
    const existing = ctx.db.funMoney.memberId.find(caller.id);
    if (existing) ctx.db.funMoney.memberId.update({ ...existing, monthlyCents });
    else
      ctx.db.funMoney.insert({
        memberId: caller.id,
        householdId: caller.householdId,
        monthlyCents,
        status: 'within',
        carryoverCents: 0,
      });
    recomputeBaseline(ctx, caller.householdId, caller.id);
  }
);

/**
 * The owner's device computes this from its local purchases and reports only
 * `within` or `over` — never an amount, never a merchant (02 Ground Rules #3).
 *
 * An overage is self-contained: it reduces that member's next month through
 * `carryoverCents`. The shared plan does not move, so the partner is never
 * notified and nothing here needs to recompute the baseline.
 */
export const setFunMoneyStatus = spacetimedb.reducer(
  { status: t.string(), carryoverCents: t.i32() },
  (ctx, { status, carryoverCents }) => {
    const caller = requireHuman(ctx);
    if (status !== 'within' && status !== 'over') {
      throw new SenderError('status must be "within" or "over"');
    }
    const existing = ctx.db.funMoney.memberId.find(caller.id);
    if (!existing) throw new SenderError('set your fun-money amount first');
    ctx.db.funMoney.memberId.update({
      ...existing,
      status,
      carryoverCents: requireMoneyCents(Math.max(0, carryoverCents), 'carryover', 0),
    });
  }
);

export const finishOnboarding = spacetimedb.reducer(ctx => {
  const caller = requireHuman(ctx);
  const h = ctx.db.household.id.find(caller.householdId);
  if (!h) throw new SenderError('household not found');
  ctx.db.household.id.update({ ...h, onboarded: true });
});

/**
 * Reset the household to its freshly-seeded state (dev and demo only).
 *
 * Deliberately keeps the household, its members and the join code, so the two
 * devices stay connected across a reset — which is what makes it usable between
 * demo runs. 11 Mock Data requires this to be fast.
 */
export const reseedHousehold = spacetimedb.reducer(ctx => {
  const caller = requireHuman(ctx);
  const householdId = caller.householdId;

  for (const row of [...ctx.db.inferredItem.householdId.filter(householdId)]) {
    ctx.db.inferredItem.id.delete(row.id);
  }
  for (const row of [...ctx.db.gapQuestion.householdId.filter(householdId)]) {
    ctx.db.gapQuestion.id.delete(row.id);
  }
  for (const row of [...ctx.db.funMoney.householdId.filter(householdId)]) {
    ctx.db.funMoney.memberId.delete(row.memberId);
  }
  for (const row of [...ctx.db.goal.householdId.filter(householdId)]) {
    ctx.db.goal.id.delete(row.id);
  }
  for (const row of [...ctx.db.lifeEvent.householdId.filter(householdId)]) {
    ctx.db.lifeEvent.id.delete(row.id);
  }
  for (const row of [...ctx.db.impact.householdId.filter(householdId)]) {
    ctx.db.impact.eventId.delete(row.eventId);
  }
  for (const row of [...ctx.db.chatMessage.householdId.filter(householdId)]) {
    ctx.db.chatMessage.id.delete(row.id);
  }
  for (const sessionRow of [...ctx.db.session.householdId.filter(householdId)]) {
    for (const row of [...ctx.db.branch.sessionId.filter(sessionRow.id)]) {
      ctx.db.branch.id.delete(row.id);
    }
    for (const row of [...ctx.db.branchCandidate.sessionId.filter(sessionRow.id)]) {
      ctx.db.branchCandidate.id.delete(row.id);
    }
    for (const row of [...ctx.db.constraint.sessionId.filter(sessionRow.id)]) {
      ctx.db.constraint.id.delete(row.id);
    }
    for (const row of [...ctx.db.reaction.sessionId.filter(sessionRow.id)]) {
      ctx.db.reaction.id.delete(row.id);
    }
    for (const row of [...ctx.db.sessionMember.sessionId.filter(sessionRow.id)]) {
      ctx.db.sessionMember.memberId.delete(row.memberId);
    }
    ctx.db.session.id.delete(sessionRow.id);
  }
  const commitment = ctx.db.planCommitment.householdId.find(householdId);
  if (commitment) ctx.db.planCommitment.householdId.delete(householdId);
  for (const row of [...ctx.db.agentJob.householdId.filter(householdId)]) {
    ctx.db.agentJob.id.delete(row.id);
  }
  const projection = ctx.db.planProjection.householdId.find(householdId);
  if (projection) ctx.db.planProjection.householdId.delete(householdId);

  const h = ctx.db.household.id.find(householdId);
  if (h) ctx.db.household.id.update({ ...h, onboarded: false });

  recomputeBaseline(ctx, householdId, caller.id);
});

// ---------------------------------------------------------------------------
// Life events, impact and chat (Stage 4)
// ---------------------------------------------------------------------------

/** One key/value pair of an event parameter, as sent from a form or a chip. */
const ParamEntry = t.object('ParamEntry', { key: t.string(), value: t.string() });

/**
 * Bound an incoming parameter list before the engine sees it.
 *
 * Both the human path (`createEvent`) and the agent path
 * (`applyEventInterpretation`) feed this straight into `parseParams`, whose job
 * is to validate *meaning* — it has no reason to also defend against a thousand
 * entries or a megabyte value. Unknown keys are left for `parseParams` to
 * reject, so the error a user sees still names the parameter.
 */
function safeParams(params: { key: string; value: string }[]): { key: string; value: string }[] {
  return params.slice(0, MAX_PARAM_ENTRIES).map(entry => ({
    key: capTrim(entry.key, MAX_PARAM_VALUE),
    value: capTrim(entry.value, MAX_PARAM_VALUE),
  }));
}

/**
 * Rebuild the engine's input for a household, so events and affordability go
 * through exactly the same simulation the committed plan does.
 */
function simulationInputFor(ctx: Ctx, householdId: bigint): SimulationInput | null {
  const baselineRow = ctx.db.baseline.householdId.find(householdId);
  if (!baselineRow) return null;
  // Committed decisions ride on every simulation, so a projection, an impact
  // and a candidate all measure against the same plan.
  const commitment = ctx.db.planCommitment.householdId.find(householdId);

  const members = [...ctx.db.member.householdId.filter(householdId)].filter(
    m => m.role === 'member'
  );

  const incomeByMember: Record<string, number> = {};
  for (const entry of baselineRow.incomeByMember) {
    incomeByMember[String(entry.memberId)] = entry.cents / 100;
  }
  const funMoneyByMember: Record<string, number> = {};
  for (const m of members) {
    if (incomeByMember[String(m.id)] === undefined) incomeByMember[String(m.id)] = 0;
    const fun = ctx.db.funMoney.memberId.find(m.id);
    funMoneyByMember[String(m.id)] = fun ? fun.monthlyCents / 100 : 0;
  }

  const goals: Goal[] = [...ctx.db.goal.householdId.filter(householdId)]
    .filter(g => g.status === 'active')
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(g => ({
      id: String(g.id),
      // A committed shrink is folded into the effective cost rather than passed
      // as a lever, so a *new* shrink lever applies on top of it instead of
      // replacing it. The stored cost stays the original, for the record.
      costToday: (g.costTodayCents / 100) * (1 - g.committedShrinkPct / 100),
      targetMonth: g.targetMonth,
      priority: g.priority === 'must' ? 'must' : 'flex',
    }));

  return {
    baseline: {
      incomeByMember,
      fixed: baselineRow.fixedCents / 100,
      debt: baselineRow.debtCents / 100,
      flexible: baselineRow.flexibleCents / 100,
      funMoneyByMember,
      retirement: baselineRow.retirementCents / 100,
      liquidSavings: baselineRow.liquidSavingsCents / 100,
    },
    goals,
    assumptions: assumptionsFor(ctx, householdId),
    levers: commitment ? { saveMore: commitment.saveMoreCents / 100 } : undefined,
  };
}

/** Member display names, so the engine's effect lines read naturally. */
function memberNamesFor(ctx: Ctx, householdId: bigint): Record<string, string> {
  const names: Record<string, string> = {};
  for (const m of [...ctx.db.member.householdId.filter(householdId)]) {
    names[String(m.id)] = m.displayName;
  }
  return names;
}

function postMessage(
  ctx: Ctx,
  householdId: bigint,
  message: {
    kind: string;
    text: string;
    authorMemberId?: bigint;
    refId?: bigint;
    payload?: unknown;
    chips?: string[];
  }
): void {
  ctx.db.chatMessage.insert({
    id: 0n,
    householdId,
    sessionId: undefined,
    authorMemberId: message.authorMemberId,
    kind: message.kind,
    text: message.text,
    chips: message.chips ?? [],
    refId: message.refId,
    payload: message.payload === undefined ? '' : JSON.stringify(message.payload),
    createdAt: ctx.timestamp,
  });
}

/**
 * Coerce form values using the **template's** parameter spec.
 *
 * Guessing from the string shape does not work: a member id is a numeric
 * string, so `"35"` would become the number `35` and fail the engine's member
 * check — with an error reading `got 35` against a list containing 35, which
 * hides that the problem was the type. The template already knows which
 * parameters are members, which are choices and which are numbers.
 */
function parseParams(
  templateId: LifeEventTemplateId,
  entries: readonly { key: string; value: string }[]
): Record<string, unknown> {
  const spec = EVENT_TEMPLATES[templateId]?.params ?? {};
  const params: Record<string, unknown> = {};

  for (const { key, value } of entries) {
    const paramSpec = spec[key];
    if (!paramSpec) throw new SenderError(`"${key}" is not a parameter of this event`);

    if (paramSpec.isMember || paramSpec.choices) {
      params[key] = value;
      continue;
    }
    const asNumber = Number(value);
    if (value.trim() === '' || !Number.isFinite(asNumber)) {
      throw new SenderError(`"${key}" needs a number, got "${value}"`);
    }
    params[key] = asNumber;
  }
  return params;
}

/**
 * Run an engine call, turning a thrown validation error into a rejection.
 *
 * The engine throws plain `Error`s — it cannot import `SenderError` without
 * taking a dependency, which `verify:purity` forbids. Unwrapped, those throws
 * **panic the WASM instance** and every connected client sees a fatal error
 * rather than a message. A user typing a bad value must never be able to take
 * the database down.
 */
function viaEngine<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SenderError(message);
  }
}

function activeEventFor(ctx: Ctx, householdId: bigint) {
  return [...ctx.db.lifeEvent.householdId.filter(householdId)]
    .filter(e => e.status === 'draft' || e.status === 'active')
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0];
}

/**
 * Record something that happened and work out what it does to the plan.
 *
 * In Stage 4 the parameters come from a form; from Stage 6 the agent fills what
 * it can and asks for the rest. The form stays as the permanent fallback for
 * when the agent is unavailable (07 Agent Spec#Deterministic fallbacks).
 */
export const createEvent = spacetimedb.reducer(
  { templateId: t.string(), params: t.array(ParamEntry) },
  (ctx, { templateId, params }) => {
    const caller = requireHuman(ctx);
    const template = EVENT_TEMPLATES[templateId as LifeEventTemplateId];
    if (!template) throw new SenderError(`unknown event: ${templateId}`);

    // One active event at a time: a new one supersedes the old draft.
    const existing = activeEventFor(ctx, caller.householdId);
    if (existing) {
      ctx.db.lifeEvent.id.update({ ...existing, status: 'dismissed' });
      const staleImpact = ctx.db.impact.eventId.find(existing.id);
      if (staleImpact) ctx.db.impact.eventId.delete(existing.id);
    }

    const event = ctx.db.lifeEvent.insert({
      id: 0n,
      householdId: caller.householdId,
      templateId,
      params: JSON.stringify(
        viaEngine(() => parseParams(templateId as LifeEventTemplateId, safeParams(params)))
      ),
      status: 'active',
      createdBy: caller.id,
      createdAt: ctx.timestamp,
    });

    postMessage(ctx, caller.householdId, {
      kind: 'event',
      text: template.label,
      authorMemberId: caller.id,
      refId: event.id,
    });
  }
);

/** Fill in one parameter — a form field, or a tap-able chip from Stage 6. */
export const answerEventParam = spacetimedb.reducer(
  { eventId: t.u64(), key: t.string(), value: t.string() },
  (ctx, { eventId, key, value }) => {
    const caller = requireHuman(ctx);
    const event = ctx.db.lifeEvent.id.find(eventId);
    if (!event) throw new SenderError('event not found');
    if (event.householdId !== caller.householdId) {
      throw new SenderError('that event is not in your household');
    }
    const template = EVENT_TEMPLATES[event.templateId as LifeEventTemplateId];
    if (!template || !(key in template.params)) {
      throw new SenderError(`"${key}" is not a parameter of this event`);
    }

    const current = JSON.parse(event.params) as Record<string, unknown>;
    const merged = {
      ...current,
      ...viaEngine(() =>
        parseParams(event.templateId as LifeEventTemplateId, safeParams([{ key, value }]))
      ),
    };

    // Promote the event once nothing is outstanding.
    //
    // The agent creates an event as a `draft` while it still has follow-ups, so
    // an impact is never computed from half-known parameters. Something has to
    // clear that, or the status is decorative — and the UI could not tell "still
    // asking" from "ready".
    const outstanding = askedParams(event.templateId as LifeEventTemplateId).filter(
      param => merged[param] === undefined
    );
    ctx.db.lifeEvent.id.update({
      ...event,
      params: JSON.stringify(merged),
      status: event.status === 'draft' && outstanding.length === 0 ? 'active' : event.status,
    });
  }
);

/**
 * Run the engine's impact for an event and store it.
 *
 * The engine runs here, in the reducer, like every other number
 * (02 Ground Rules #1 and #7). A template whose parameters are still incomplete
 * throws from the engine's own validation, which is the right place for it.
 */
export const computeImpact = spacetimedb.reducer({ eventId: t.u64() }, (ctx, { eventId }) => {
  const caller = requireHuman(ctx);
  const event = ctx.db.lifeEvent.id.find(eventId);
  if (!event) throw new SenderError('event not found');
  if (event.householdId !== caller.householdId) {
    throw new SenderError('that event is not in your household');
  }

  const input = simulationInputFor(ctx, caller.householdId);
  if (!input) throw new SenderError('finish onboarding before adding an event');
  if (input.goals.length === 0) throw new SenderError('add a goal before adding an event');

  const lifeEventInput: LifeEvent = {
    templateId: event.templateId as LifeEventTemplateId,
    params: JSON.parse(event.params) as Record<string, unknown>,
  };

  const output = viaEngine(() =>
    computeImpactWithEngine(input, lifeEventInput, memberNamesFor(ctx, caller.householdId))
  );

  // The before/after projections are each ~13 KB and the card needs neither in
  // full; the deltas, effects and provenance are what the UI renders. Dropping
  // them keeps the row small enough to broadcast on every recompute.
  const stored = {
    newlyAtRiskGoalIds: output.newlyAtRiskGoalIds,
    shortfallsByGoalId: output.shortfallsByGoalId,
    alreadyAtRiskGoalIds: output.alreadyAtRiskGoalIds,
    tightYearsBefore: output.tightYearsBefore,
    tightYearsAfter: output.tightYearsAfter,
    tightMonthsAfter: output.tightMonthsAfter,
    emergencyMonthsMinBefore: output.emergencyMonthsMinBefore,
    emergencyMonthsMinAfter: output.emergencyMonthsMinAfter,
    freeToPlanBefore: output.freeToPlanBefore,
    freeToPlanAfter: output.freeToPlanAfter,
    noImpact: output.noImpact,
    effects: output.effects,
    provenance: output.provenance,
    goalsAfter: output.after.goals,
    seriesAfter: output.after.series.monthly,
  };

  const existing = ctx.db.impact.eventId.find(eventId);
  const row = {
    eventId,
    householdId: caller.householdId,
    json: JSON.stringify(stored),
    computedAt: ctx.timestamp,
  };
  if (existing) ctx.db.impact.eventId.update(row);
  else ctx.db.impact.insert(row);

  postMessage(ctx, caller.householdId, {
    kind: 'impact',
    text: output.noImpact
      ? "This doesn't change your goals."
      : `${output.newlyAtRiskGoalIds.length} goal${output.newlyAtRiskGoalIds.length === 1 ? '' : 's'} no longer fit.`,
    refId: eventId,
  });
});

export const dismissEvent = spacetimedb.reducer({ eventId: t.u64() }, (ctx, { eventId }) => {
  const caller = requireHuman(ctx);
  const event = ctx.db.lifeEvent.id.find(eventId);
  if (!event) throw new SenderError('event not found');
  if (event.householdId !== caller.householdId) {
    throw new SenderError('that event is not in your household');
  }
  ctx.db.lifeEvent.id.update({ ...event, status: 'dismissed' });
  const existing = ctx.db.impact.eventId.find(eventId);
  if (existing) ctx.db.impact.eventId.delete(eventId);

  postMessage(ctx, caller.householdId, {
    kind: 'system',
    text: 'Keeping the plan as it is.',
    authorMemberId: caller.id,
    refId: eventId,
  });
});

/**
 * "Can we afford a $1,200 couch?" — 06 Engine Spec#Affordability check.
 *
 * Answered in **time** as well as dollars: which goals move and by how much, or
 * "no goal changes; emergency fund goes from 4.2 to 3.9 months". The result is
 * posted as a card in the thread rather than stored in its own table, since it
 * is a question that was asked once, not a part of the plan.
 */
export const checkAffordability = spacetimedb.reducer(
  { amountCents: t.i32(), label: t.string() },
  (ctx, { amountCents, label }) => {
    const caller = requireHuman(ctx);
    if (amountCents <= 0) throw new SenderError('enter an amount above zero');
    requireMoneyCents(amountCents, 'an amount', 1);
    const safeLabel = capTrim(label, MAX_LABEL);

    const input = simulationInputFor(ctx, caller.householdId);
    if (!input) throw new SenderError('finish onboarding first');

    const result = viaEngine(() =>
      checkAffordabilityWithEngine(input, amountCents / 100, safeLabel || 'it')
    );

    postMessage(ctx, caller.householdId, {
      kind: 'affordability',
      text: result.affordableWithoutChanges
        ? `No goal changes for ${safeLabel || 'that'}.`
        : `${result.newlyAtRiskGoalIds.length} goal${result.newlyAtRiskGoalIds.length === 1 ? '' : 's'} would stop fitting.`,
      authorMemberId: caller.id,
      payload: {
        amount: result.amount,
        label: result.label,
        affordableWithoutChanges: result.affordableWithoutChanges,
        newlyAtRiskGoalIds: result.newlyAtRiskGoalIds,
        emergencyMonthsNowBefore: result.emergencyMonthsNowBefore,
        emergencyMonthsNowAfter: result.emergencyMonthsNowAfter,
        emergencyMonthsMinBefore: result.emergencyMonthsMinBefore,
        emergencyMonthsMinAfter: result.emergencyMonthsMinAfter,
        minimalDelayByGoalId: result.minimalDelayByGoalId,
        minimalSaveMore: result.minimalSaveMore,
        // A one-time purchase is absorbed by the emergency fund, not taken out
        // of goal contributions, so the honest headline for a big spend is how
        // many months turn tight rather than which goals break.
        tightMonthsAfter: result.after.tightMonths.length,
        tightMonthsBefore: result.before.tightMonths.length,
      },
    });
  }
);

/**
 * A plain message in the thread.
 *
 * Stage 6 extends this to queue an `agent_job`; for now it only records what was
 * said, so the thread reads as a conversation even with no agent running.
 */
export const sendMessage = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  const caller = requireHuman(ctx);
  const trimmed = text.trim();
  if (!trimmed) throw new SenderError('a message cannot be empty');
  if (trimmed.length > 1000) throw new SenderError('that message is too long');

  const message = ctx.db.chatMessage.insert({
    id: 0n,
    householdId: caller.householdId,
    sessionId: undefined,
    authorMemberId: caller.id,
    kind: 'text',
    text: trimmed,
    chips: [],
    refId: undefined,
    payload: '',
    createdAt: ctx.timestamp,
  });

  // Queue work for the agent rather than calling it: reducers cannot make
  // outbound HTTP calls, and the bus is what lets both partners watch the
  // agent think (04 Architecture#Message bus pattern).
  //
  // If no agent is registered the job simply sits queued and the app stays
  // fully usable through the forms — the demo must work with the agent off
  // (07 Agent Spec#Deterministic fallbacks).
  const openSession = [...ctx.db.session.householdId.filter(caller.householdId)].find(
    x => x.status === 'open'
  );
  queueJob(ctx, caller.householdId, {
    kind: openSession ? 'translate_feedback' : 'interpret_event',
    input: { text: trimmed, memberId: String(caller.id) },
    sessionId: openSession?.id,
    promptMessageId: message.id,
  });
});

function queueJob(
  ctx: Ctx,
  householdId: bigint,
  job: {
    kind: string;
    input: unknown;
    sessionId?: bigint;
    promptMessageId?: bigint;
  }
): bigint {
  const row = ctx.db.agentJob.insert({
    id: 0n,
    householdId,
    sessionId: job.sessionId,
    kind: job.kind,
    input: JSON.stringify(job.input),
    status: 'queued',
    progressText: '',
    result: '',
    attempts: 0,
    modelUsed: '',
    promptMessageId: job.promptMessageId,
    createdAt: ctx.timestamp,
    claimedAt: undefined,
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Goals and assumptions (Stage 3)
// ---------------------------------------------------------------------------

const MAX_GOALS = 12;

function validateGoal(title: string, costTodayCents: number, targetMonth: number, priority: string) {
  if (!title.trim()) throw new SenderError('a goal needs a name');
  if (costTodayCents <= 0) throw new SenderError('a goal needs a cost above zero');
  requireMoneyCents(costTodayCents, 'a goal cost', 1);
  if (!Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 120) {
    throw new SenderError('a target month must be between 1 and 120');
  }
  if (priority !== 'must' && priority !== 'flex') {
    throw new SenderError('priority must be "must" or "flex"');
  }
}

/**
 * Either partner may add a goal, and both see it immediately.
 *
 * OPEN(OD-4): only committing a branch needs agreement from everyone, so adding
 * a goal deliberately does not.
 */
export const addGoal = spacetimedb.reducer(
  {
    title: t.string(),
    icon: t.string(),
    costTodayCents: t.i32(),
    targetMonth: t.i32(),
    priority: t.string(),
  },
  (ctx, { title, icon, costTodayCents, targetMonth, priority }) => {
    const caller = requireHuman(ctx);
    validateGoal(title, costTodayCents, targetMonth, priority);

    const existing = [...ctx.db.goal.householdId.filter(caller.householdId)].filter(
      g => g.status === 'active'
    );
    if (existing.length >= MAX_GOALS) {
      throw new SenderError(`a plan holds at most ${MAX_GOALS} goals`);
    }

    ctx.db.goal.insert({
      id: 0n,
      householdId: caller.householdId,
      title: capTrim(title, MAX_GOAL_TITLE),
      icon: cap(icon, MAX_ICON),
      costTodayCents,
      targetMonth,
      originalTargetMonth: targetMonth,
      committedShrinkPct: 0,
      priority,
      createdBy: caller.id,
      status: 'active',
    });
    recomputeProjection(ctx, caller.householdId, caller.id);
  }
);

export const editGoal = spacetimedb.reducer(
  {
    goalId: t.u64(),
    title: t.string(),
    costTodayCents: t.i32(),
    targetMonth: t.i32(),
    priority: t.string(),
  },
  (ctx, { goalId, title, costTodayCents, targetMonth, priority }) => {
    const caller = requireHuman(ctx);
    const existing = ctx.db.goal.id.find(goalId);
    if (!existing) throw new SenderError('goal not found');
    if (existing.householdId !== caller.householdId) {
      throw new SenderError('that goal is not in your household');
    }
    validateGoal(title, costTodayCents, targetMonth, priority);

    ctx.db.goal.id.update({
      ...existing,
      title: capTrim(title, MAX_GOAL_TITLE),
      costTodayCents,
      targetMonth,
      // A deliberate edit re-aims the goal, so the original moves with it. Only
      // a committed branch leaves the original behind to show the move.
      originalTargetMonth: targetMonth,
      priority,
    });
    recomputeProjection(ctx, caller.householdId, caller.id);
  }
);

export const removeGoal = spacetimedb.reducer({ goalId: t.u64() }, (ctx, { goalId }) => {
  const caller = requireHuman(ctx);
  const existing = ctx.db.goal.id.find(goalId);
  if (!existing) throw new SenderError('goal not found');
  if (existing.householdId !== caller.householdId) {
    throw new SenderError('that goal is not in your household');
  }
  ctx.db.goal.id.delete(goalId);
  recomputeProjection(ctx, caller.householdId, caller.id);
});

/**
 * Assumptions are editable per household and shown wherever they are used
 * (02 Ground Rules #8). Editing one recomputes the plan for both partners.
 *
 * Basis points, so an assumption is an integer like every other stored number.
 */
export const setAssumptions = spacetimedb.reducer(
  {
    savingsRateBps: t.i32(),
    inflationBps: t.i32(),
    mortgageRateBps: t.i32(),
    carRateBps: t.i32(),
  },
  (ctx, { savingsRateBps, inflationBps, mortgageRateBps, carRateBps }) => {
    const caller = requireHuman(ctx);
    for (const [name, value] of [
      ['savings rate', savingsRateBps],
      ['inflation', inflationBps],
      ['mortgage rate', mortgageRateBps],
      ['car rate', carRateBps],
    ] as const) {
      // 0% is legitimate (06 Engine Spec defines the r = 0 behaviour); 50% is
      // not, and a typo there would quietly produce nonsense projections.
      if (value < 0 || value > 5000) {
        throw new SenderError(`${name} must be between 0% and 50%`);
      }
    }
    const existing = ctx.db.assumption.householdId.find(caller.householdId);
    const row = {
      householdId: caller.householdId,
      savingsRateBps,
      inflationBps,
      mortgageRateBps,
      carRateBps,
    };
    if (existing) ctx.db.assumption.householdId.update(row);
    else ctx.db.assumption.insert(row);
    recomputeProjection(ctx, caller.householdId, caller.id);
  }
);

// ---------------------------------------------------------------------------
// Branches (Stage 5)
// ---------------------------------------------------------------------------

/** How many named branches the couple sees at once (06 Engine Spec). */
const BRANCHES_SHOWN = 3;

/**
 * The people in a household. Excludes the agent.
 *
 * This matters for the ready check: the agent is a `member` row with role
 * `agent`, so counting every row would mean a commit could never happen —
 * the agent has no hands to hold a button with.
 */
function humanMembers(ctx: Ctx, householdId: bigint) {
  return [...ctx.db.member.householdId.filter(householdId)]
    .filter(m => m.role === 'member')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Clear every ready flag in a session.
 *
 * Called by anything that changes what is on the table — a new selection,
 * tuning, a lock, a pin, a reroll (08 Live Session Spec#Ready check). Without
 * this, two people could commit a branch that silently changed underneath them
 * after they agreed to it.
 */
function clearReady(ctx: Ctx, sessionId: bigint): void {
  for (const row of [...ctx.db.sessionMember.sessionId.filter(sessionId)]) {
    if (!row.ready) continue;
    ctx.db.sessionMember.memberId.update({ ...row, ready: false, readyAt: undefined });
  }
}

function openSessionFor(ctx: Ctx, householdId: bigint) {
  return [...ctx.db.session.householdId.filter(householdId)].find(x => x.status === 'open');
}

function sessionOrReject(ctx: Ctx, sessionId: bigint, householdId: bigint) {
  const found = ctx.db.session.id.find(sessionId);
  if (!found || found.householdId !== householdId) throw new SenderError('session not found');
  return found;
}

/** Active constraints of a session, in the engine's shape. */
function constraintsFor(ctx: Ctx, sessionId: bigint, kind?: 'lock' | 'pin'): Constraint[] {
  return [...ctx.db.constraint.sessionId.filter(sessionId)]
    .filter(c => c.active && (kind === undefined || c.kind === kind))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(c => JSON.parse(c.target) as Constraint);
}

/**
 * The simulation input for a session: the household's plan, plus the event the
 * session is about, plus anything already committed.
 */
function sessionInput(ctx: Ctx, householdId: bigint, eventId: bigint): SimulationInput {
  const base = simulationInputFor(ctx, householdId);
  if (!base) throw new SenderError('finish onboarding first');
  if (base.goals.length === 0) throw new SenderError('add a goal first');

  const event = ctx.db.lifeEvent.id.find(eventId);
  if (!event) throw new SenderError('event not found');

  return {
    ...base,
    events: [
      {
        templateId: event.templateId as LifeEventTemplateId,
        params: JSON.parse(event.params) as Record<string, unknown>,
      },
    ],
  };
}

/** Plan-month index to a short calendar label, for the fallback branch names. */
function monthLabelFor(ctx: Ctx, householdId: bigint): (planMonth: number) => string {
  const household = ctx.db.household.id.find(householdId);
  const current = household?.currentMonth ?? '2026-01';
  const [yearStr, monthStr] = current.split('-');
  const baseIndex = Number(yearStr) * 12 + (Number(monthStr) - 1);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return planMonth => {
    const index = baseIndex + planMonth;
    return `${names[((index % 12) + 12) % 12]} ${Math.floor(index / 12)}`;
  };
}

/**
 * Write candidates, then name and show the first three.
 *
 * Stage 5 uses the engine's **template names**; Stage 6 replaces the naming
 * step with the agent and keeps this as the fallback
 * (07 Agent Spec#Deterministic fallbacks).
 */
function writeCandidatesAndBranches(
  ctx: Ctx,
  sessionRow: { id: bigint; householdId: bigint; eventId: bigint },
  candidates: readonly Candidate[],
  batch: number
): void {
  const input = sessionInput(ctx, sessionRow.householdId, sessionRow.eventId);
  const label = monthLabelFor(ctx, sessionRow.householdId);
  const goalTitles = new Map(
    [...ctx.db.goal.householdId.filter(sessionRow.householdId)].map(g => [String(g.id), g.title])
  );
  const titleOf = (goalId: string) => goalTitles.get(goalId) ?? goalId;

  // Replace the shown branches; candidates accumulate so a reroll can exclude
  // what has already been offered.
  for (const row of [...ctx.db.branch.sessionId.filter(sessionRow.id)]) {
    ctx.db.branch.id.delete(row.id);
  }

  candidates.forEach((candidate, index) => {
    const row = ctx.db.branchCandidate.insert({
      id: 0n,
      sessionId: sessionRow.id,
      eventId: sessionRow.eventId,
      batch,
      signature: candidate.signature,
      levers: JSON.stringify(candidate.levers),
      stats: JSON.stringify(candidate.stats),
      source: candidate.source,
      shownAt: index < BRANCHES_SHOWN ? ctx.timestamp : undefined,
    });

    if (index >= BRANCHES_SHOWN) return;

    // Goal titles live in the database, not the engine, so naming happens here.
    const named = {
      name: templateName(candidate.levers, input.goals, label),
      summary: templateSummary(candidate.stats, titleOf),
    };
    ctx.db.branch.insert({
      id: 0n,
      sessionId: sessionRow.id,
      candidateId: row.id,
      // The engine holds no titles, so it names by goal id; swap the real one in.
      name: named.name.replace(
        /^(Move|Smaller) (\S+)/,
        (_full, verb: string, goalId: string) => `${verb} ${titleOf(goalId)}`
      ),
      summary: named.summary,
      nameSource: 'template',
      position: index,
      tunedBy: undefined,
    });
  });
}

export const startSession = spacetimedb.reducer({ eventId: t.u64() }, (ctx, { eventId }) => {
  const caller = requireHuman(ctx);
  const event = ctx.db.lifeEvent.id.find(eventId);
  if (!event || event.householdId !== caller.householdId) {
    throw new SenderError('event not found');
  }
  // Only one session open per household (08 Live Session Spec).
  const existing = openSessionFor(ctx, caller.householdId);
  if (existing) {
    if (existing.eventId === eventId) return;
    ctx.db.session.id.update({ ...existing, status: 'closed' });
  }

  const created = ctx.db.session.insert({
    id: 0n,
    householdId: caller.householdId,
    eventId,
    status: 'open',
    startedBy: caller.id,
    committedBranchId: undefined,
    startedAt: ctx.timestamp,
  });

  // Enrol the starter immediately: their partner's invite banner keys off a
  // session they are not yet a member of.
  const existingMembership = ctx.db.sessionMember.memberId.find(caller.id);
  if (existingMembership) {
    ctx.db.sessionMember.memberId.update({
      ...existingMembership,
      sessionId: created.id,
      present: true,
      selectedBranchId: undefined,
      ready: false,
      readyAt: undefined,
    });
  } else {
    ctx.db.sessionMember.insert({
      memberId: caller.id,
      sessionId: created.id,
      present: true,
      selectedBranchId: undefined,
      ready: false,
      readyAt: undefined,
    });
  }

  postMessage(ctx, caller.householdId, {
    kind: 'system',
    text: 'Looking for paths forward…',
    authorMemberId: caller.id,
    refId: created.id,
  });
});

export const generateCandidates = spacetimedb.reducer(
  { sessionId: t.u64() },
  (ctx, { sessionId }) => {
    const caller = requireHuman(ctx);
    const sessionRow = sessionOrReject(ctx, sessionId, caller.householdId);
    const input = sessionInput(ctx, sessionRow.householdId, sessionRow.eventId);

    const candidates = viaEngine(() =>
      generateCandidatesWithEngine(input, { constraints: constraintsFor(ctx, sessionId) })
    );
    writeCandidatesAndBranches(ctx, sessionRow, candidates, 0);
    clearReady(ctx, sessionId);
  }
);

/**
 * Show other paths — honouring locks and never repeating a lever set already
 * offered this session (08 Live Session Spec#Locks and rerolls).
 *
 * OPEN(OD-5): unlimited rerolls; when nothing new fits, the UI says "these are
 * all the paths that fit what you've locked."
 */
export const reroll = spacetimedb.reducer({ sessionId: t.u64() }, (ctx, { sessionId }) => {
  const caller = requireHuman(ctx);
  const sessionRow = sessionOrReject(ctx, sessionId, caller.householdId);
  const input = sessionInput(ctx, sessionRow.householdId, sessionRow.eventId);

  const allCandidates = [...ctx.db.branchCandidate.sessionId.filter(sessionId)];
  const shown = allCandidates
    .filter(c => c.shownAt !== undefined && c.shownAt !== null)
    .map(c => c.signature);
  const batch = allCandidates.reduce((max, c) => Math.max(max, c.batch), 0) + 1;

  const candidates = viaEngine(() =>
    generateCandidatesWithEngine(input, {
      constraints: constraintsFor(ctx, sessionId),
      exclude: shown,
    })
  );

  if (candidates.length === 0) {
    postMessage(ctx, caller.householdId, {
      kind: 'system',
      text: "These are all the paths that fit what you've locked.",
      refId: sessionId,
    });
    return;
  }
  writeCandidatesAndBranches(ctx, sessionRow, candidates, batch);
  clearReady(ctx, sessionId);
});

export const addConstraint = spacetimedb.reducer(
  { sessionId: t.u64(), kind: t.string(), target: t.string() },
  (ctx, { sessionId, kind, target }) => {
    const caller = requireHuman(ctx);
    sessionOrReject(ctx, sessionId, caller.householdId);
    if (kind !== 'lock' && kind !== 'pin') throw new SenderError('kind must be lock or pin');
    if (target.length > MAX_CONSTRAINT_JSON) throw new SenderError('that constraint is too large');

    const parsed = viaEngine(() => JSON.parse(target) as Constraint);
    const allowed = ['goalOnTime', 'goalFullSize', 'noExtraSaving', 'saveMoreAtMost'];
    if (!allowed.includes(parsed.kind)) throw new SenderError(`unknown constraint: ${parsed.kind}`);

    // A member gets one pin (08 Live Session Spec), so a new one replaces it.
    if (kind === 'pin') {
      for (const existing of [...ctx.db.constraint.sessionId.filter(sessionId)]) {
        if (existing.memberId === caller.id && existing.kind === 'pin' && existing.active) {
          ctx.db.constraint.id.update({ ...existing, active: false });
        }
      }
    }

    ctx.db.constraint.insert({
      id: 0n,
      sessionId,
      memberId: caller.id,
      kind,
      target: JSON.stringify(parsed),
      active: true,
    });
    clearReady(ctx, sessionId);
  }
);

export const removeConstraint = spacetimedb.reducer(
  { constraintId: t.u64() },
  (ctx, { constraintId }) => {
    const caller = requireHuman(ctx);
    const existing = ctx.db.constraint.id.find(constraintId);
    if (!existing) throw new SenderError('constraint not found');
    sessionOrReject(ctx, existing.sessionId, caller.householdId);
    if (existing.memberId !== caller.id) throw new SenderError('that is not yours to remove');
    ctx.db.constraint.id.update({ ...existing, active: false });
    clearReady(ctx, existing.sessionId);
  }
);

/**
 * Bridge branches honouring every member's pin, or the closest-option
 * statements when none exists (08 Live Session Spec#Pins and bridge branches).
 *
 * No AI tiebreaker, ever: two deterministic statements about what it would take.
 */
export const requestBridge = spacetimedb.reducer(
  { sessionId: t.u64() },
  (ctx, { sessionId }) => {
    const caller = requireHuman(ctx);
    const sessionRow = sessionOrReject(ctx, sessionId, caller.householdId);
    const input = sessionInput(ctx, sessionRow.householdId, sessionRow.eventId);
    const pins = constraintsFor(ctx, sessionId, 'pin');
    if (pins.length === 0) throw new SenderError('nobody has pinned anything yet');

    const shown = [...ctx.db.branchCandidate.sessionId.filter(sessionId)]
      .filter(c => c.shownAt !== undefined && c.shownAt !== null)
      .map(c => c.signature);

    const bridges = viaEngine(() => generateBridgesWithEngine(input, pins, shown));

    if (bridges.length > 0) {
      const batch =
        [...ctx.db.branchCandidate.sessionId.filter(sessionId)].reduce(
          (max, c) => Math.max(max, c.batch),
          0
        ) + 1;
      writeCandidatesAndBranches(ctx, sessionRow, bridges, batch);
      clearReady(ctx, sessionId);
      return;
    }

    const closest = viaEngine(() => closestOptionWithEngine(input, pins));
    const goalTitles = new Map(
      [...ctx.db.goal.householdId.filter(sessionRow.householdId)].map(g => [String(g.id), g.title])
    );
    const lines: string[] = [];
    if (closest.saveMore !== null) {
      lines.push(`saving $${closest.saveMore} more a month would honour both`);
    }
    for (const [goalId, months] of Object.entries(closest.delayByGoalId)) {
      if (months === null) continue;
      lines.push(`letting ${goalTitles.get(goalId) ?? goalId} move ${months} months would make a path possible`);
    }

    postMessage(ctx, caller.householdId, {
      kind: 'system',
      text:
        lines.length === 0
          ? 'No path in range honours both of those. You can always keep the plan as it is.'
          : `Nothing fits both pins exactly. ${lines.join('; ')}.`,
      refId: sessionId,
      payload: closest,
    });
  }
);

/**
 * Drag a slider — 08 Live Session Spec#Live tuning.
 *
 * Replaces the branch's levers and stats for everyone, marking it `custom`.
 * Values outside the lever's domain are **clamped** rather than rejected, since
 * a slider should never throw. A tuned branch may become infeasible; it then
 * shows its at-risk goals instead of blocking.
 */
export const tuneLever = spacetimedb.reducer(
  { branchId: t.u64(), lever: t.string(), goalId: t.option(t.u64()), value: t.i32() },
  (ctx, { branchId, lever, goalId, value }) => {
    const caller = requireHuman(ctx);
    const branchRow = ctx.db.branch.id.find(branchId);
    if (!branchRow) throw new SenderError('branch not found');
    const sessionRow = sessionOrReject(ctx, branchRow.sessionId, caller.householdId);
    const candidate = ctx.db.branchCandidate.id.find(branchRow.candidateId);
    if (!candidate) throw new SenderError('candidate not found');

    const input = sessionInput(ctx, sessionRow.householdId, sessionRow.eventId);
    const levers = JSON.parse(candidate.levers) as Levers;
    // Mutable working copies: `Levers` holds readonly records, so the slider
    // builds its own maps and hands back a fresh lever set.
    const delays: Record<string, number> = { ...(levers.delays ?? {}) };
    const shrinks: Record<string, number> = { ...(levers.shrinks ?? {}) };
    let saveMoreValue = levers.saveMore ?? 0;

    if (lever === 'saveMore') {
      const cap = saveMoreCap(input.baseline.flexible);
      const steps = Math.round(value / SAVE_MORE_STEP) * SAVE_MORE_STEP;
      saveMoreValue = Math.max(0, Math.min(cap, steps));
    } else if (lever === 'delay' || lever === 'shrink') {
      if (goalId === undefined || goalId === null) throw new SenderError('which goal?');
      const key = String(goalId);
      const goal = input.goals.find(g => g.id === key);
      if (!goal) throw new SenderError('goal not found');
      const domain = lever === 'delay' ? delayDomain(goal) : shrinkDomain(goal);
      if (domain.length === 0) {
        throw new SenderError(
          lever === 'shrink' ? 'a must-have goal cannot be made smaller' : 'that goal cannot move'
        );
      }
      const lowest = domain[0]!;
      const highest = domain[domain.length - 1]!;
      const clamped = value <= 0 ? 0 : Math.max(lowest, Math.min(highest, value));
      const bucket = lever === 'delay' ? delays : shrinks;
      if (clamped === 0) delete bucket[key];
      else bucket[key] = clamped;
    } else {
      throw new SenderError(`unknown lever: ${lever}`);
    }

    const next: Levers = { delays, shrinks, saveMore: saveMoreValue };

    const reference = viaEngine(() => simulateWithEngine(input));
    const stats = viaEngine(() => statsFor(input, next, reference));

    ctx.db.branchCandidate.id.update({
      ...candidate,
      signature: leverSetSignature(next),
      levers: JSON.stringify(next),
      stats: JSON.stringify(stats),
      source: 'custom',
    });

    const goalTitles = new Map(
      [...ctx.db.goal.householdId.filter(sessionRow.householdId)].map(g => [String(g.id), g.title])
    );
    ctx.db.branch.id.update({
      ...branchRow,
      summary: templateSummary(stats, id => goalTitles.get(id) ?? id),
      name: branchRow.name.replace(/ · tuned$/, ''),
      tunedBy: caller.id,
    });

    // Any change to a branch clears every ready flag
    // (08 Live Session Spec#Live tuning).
    clearReady(ctx, branchRow.sessionId);
  }
);

/**
 * Apply a branch to the plan. Internal — reached only through the ready check
 * (or the dev override below).
 *
 * Applies the levers, marks the event applied and recomputes the plan, all in
 * one transaction (05 Data Model#Rules).
 *
 * How levers land:
 *  - a **delay** moves `targetMonth` and leaves `originalTargetMonth` behind, so
 *    the move stays visible;
 *  - a **shrink** is stored as `committedShrinkPct` against the untouched
 *    original cost;
 *  - **saveMore** becomes a `plan_commitment`, not an edit to the inferred
 *    baseline — the baseline means "what we observed", this means "what we
 *    decided".
 *
 * Idempotent: a session already committed does nothing, so two simultaneous
 * `setReady` calls cannot apply the same branch twice
 * (08 Live Session Spec#Edge cases).
 */
function applyBranch(ctx: Ctx, branchId: bigint, actorId: bigint): boolean {
  const branchRow = ctx.db.branch.id.find(branchId);
  if (!branchRow) throw new SenderError('branch not found');
  const sessionRow = ctx.db.session.id.find(branchRow.sessionId);
  if (!sessionRow) throw new SenderError('session not found');
  if (sessionRow.status !== 'open') return false;

  const candidate = ctx.db.branchCandidate.id.find(branchRow.candidateId);
  if (!candidate) throw new SenderError('candidate not found');
  const levers = JSON.parse(candidate.levers) as Levers;

  for (const goal of [...ctx.db.goal.householdId.filter(sessionRow.householdId)]) {
    const key = String(goal.id);
    const delay = levers.delays?.[key] ?? 0;
    const shrink = levers.shrinks?.[key] ?? 0;
    if (delay === 0 && shrink === 0) continue;
    ctx.db.goal.id.update({
      ...goal,
      targetMonth: Math.min(120, goal.targetMonth + delay),
      committedShrinkPct: Math.min(100, goal.committedShrinkPct + shrink),
    });
  }

  const saveMore = levers.saveMore ?? 0;
  const existingCommitment = ctx.db.planCommitment.householdId.find(sessionRow.householdId);
  const commitmentRow = {
    householdId: sessionRow.householdId,
    saveMoreCents: (existingCommitment?.saveMoreCents ?? 0) + toIntegerCents(saveMore),
    fromBranchId: branchId,
    committedAt: ctx.timestamp,
  };
  if (existingCommitment) ctx.db.planCommitment.householdId.update(commitmentRow);
  else ctx.db.planCommitment.insert(commitmentRow);

  const event = ctx.db.lifeEvent.id.find(sessionRow.eventId);
  if (event) ctx.db.lifeEvent.id.update({ ...event, status: 'applied' });

  ctx.db.session.id.update({ ...sessionRow, status: 'committed', committedBranchId: branchId });

  recomputeProjection(ctx, sessionRow.householdId, actorId);

  postMessage(ctx, sessionRow.householdId, {
    kind: 'system',
    text: `This is your plan now: ${branchRow.name}.`,
    refId: sessionRow.id,
  });

  // The agent writes the one-line summary (08 Live Session Spec). If no agent is
  // running the system line above already stands on its own.
  queueJob(ctx, sessionRow.householdId, {
    kind: 'explain',
    input: {
      what: 'committed-branch',
      branchName: branchRow.name,
      branchSummary: branchRow.summary,
      stats: JSON.parse(candidate.stats) as unknown,
    },
    sessionId: sessionRow.id,
  });

  return true;
}

// ---------------------------------------------------------------------------
// The live session (Stage 7)
// ---------------------------------------------------------------------------

/**
 * How long a member must hold before the client reports ready. OPEN(OD-6).
 *
 * Not exported: a SpacetimeDB module reserves named runtime exports for values
 * registered with it — reducers, lifecycle hooks, views, visibility filters.
 * Exporting a plain constant fails schema inspection with "exporting something
 * that is not a spacetime export", and only `spacetime generate` catches it;
 * `build` and `publish` both accept it silently.
 */
const READY_HOLD_MS = 1500;
void READY_HOLD_MS;

function sessionMemberRow(ctx: Ctx, sessionId: bigint, memberId: bigint) {
  const row = ctx.db.sessionMember.memberId.find(memberId);
  return row && row.sessionId === sessionId ? row : undefined;
}

/**
 * Open the session on this device. Presence is per-member, so joining twice is
 * harmless and a reconnect restores it.
 */
export const joinSession = spacetimedb.reducer({ sessionId: t.u64() }, (ctx, { sessionId }) => {
  const caller = requireHuman(ctx);
  sessionOrReject(ctx, sessionId, caller.householdId);

  const existing = ctx.db.sessionMember.memberId.find(caller.id);
  if (existing) {
    ctx.db.sessionMember.memberId.update({
      ...existing,
      sessionId,
      present: true,
      // Moving to a different session clears a stale pick.
      selectedBranchId: existing.sessionId === sessionId ? existing.selectedBranchId : undefined,
      ready: false,
      readyAt: undefined,
    });
    return;
  }
  ctx.db.sessionMember.insert({
    memberId: caller.id,
    sessionId,
    present: true,
    selectedBranchId: undefined,
    ready: false,
    readyAt: undefined,
  });
});

/**
 * Close the session screen. Selections, locks and pins stay — only presence and
 * the ready flag go (08 Live Session Spec#Edge cases).
 */
export const leaveSession = spacetimedb.reducer({ sessionId: t.u64() }, (ctx, { sessionId }) => {
  const caller = requireHuman(ctx);
  const row = sessionMemberRow(ctx, sessionId, caller.id);
  if (!row) return;
  ctx.db.sessionMember.memberId.update({
    ...row,
    present: false,
    ready: false,
    readyAt: undefined,
  });
});

/**
 * Pick a card. Every member's avatar shows on their selected card, on every
 * screen (08 Live Session Spec#Selection).
 */
export const selectBranch = spacetimedb.reducer(
  { sessionId: t.u64(), branchId: t.u64() },
  (ctx, { sessionId, branchId }) => {
    const caller = requireHuman(ctx);
    sessionOrReject(ctx, sessionId, caller.householdId);
    const branchRow = ctx.db.branch.id.find(branchId);
    if (!branchRow || branchRow.sessionId !== sessionId) throw new SenderError('branch not found');

    const row = sessionMemberRow(ctx, sessionId, caller.id);
    if (!row) throw new SenderError('join the session first');

    ctx.db.sessionMember.memberId.update({
      ...row,
      selectedBranchId: branchId,
      // Changing your mind un-readies everyone, including you.
      ready: false,
      readyAt: undefined,
    });
    clearReady(ctx, sessionId);
  }
);

/** One reaction per member per branch; the latest replaces the last. */
export const react = spacetimedb.reducer(
  { sessionId: t.u64(), branchId: t.u64(), emoji: t.string() },
  (ctx, { sessionId, branchId, emoji }) => {
    const caller = requireHuman(ctx);
    sessionOrReject(ctx, sessionId, caller.householdId);
    if (!['👍', '❤️', '😬'].includes(emoji)) throw new SenderError('unknown reaction');

    for (const existing of [...ctx.db.reaction.sessionId.filter(sessionId)]) {
      if (existing.memberId === caller.id && existing.branchId === branchId) {
        ctx.db.reaction.id.delete(existing.id);
      }
    }
    ctx.db.reaction.insert({ id: 0n, sessionId, memberId: caller.id, branchId, emoji });
  }
);

/**
 * The ready check — 08 Live Session Spec#Ready check.
 *
 * The client sends `true` only once a press-and-hold has lasted
 * `READY_HOLD_MS`, and `false` the moment the finger lifts. So both people are
 * still holding when the commit fires, which is what makes it simultaneous
 * rather than "both pressed at some point".
 *
 * The **server** decides. Inside this one transaction: if every household
 * member is present, ready, and ready for the *same* branch, the branch is
 * applied. Two simultaneous calls therefore commit once — the second finds the
 * session already committed and does nothing.
 */
export const setReady = spacetimedb.reducer(
  { sessionId: t.u64(), ready: t.bool() },
  (ctx, { sessionId, ready }) => {
    const caller = requireHuman(ctx);
    const sessionRow = sessionOrReject(ctx, sessionId, caller.householdId);
    if (sessionRow.status !== 'open') return;

    const row = sessionMemberRow(ctx, sessionId, caller.id);
    if (!row) throw new SenderError('join the session first');
    if (ready && row.selectedBranchId === undefined) {
      throw new SenderError('pick a path first');
    }

    ctx.db.sessionMember.memberId.update({
      ...row,
      ready,
      readyAt: ready ? ctx.timestamp : undefined,
    });
    if (!ready) return;

    const members = humanMembers(ctx, sessionRow.householdId);
    const states = members.map(m => sessionMemberRow(ctx, sessionId, m.id));

    // Everyone in the household, not merely everyone present: a decision this
    // size should not be possible while a partner is away.
    if (states.some(state => !state?.present || !state.ready)) return;

    const picks = new Set(states.map(state => String(state!.selectedBranchId)));
    if (picks.size !== 1) return;

    const branchId = states[0]!.selectedBranchId;
    if (branchId === undefined) return;

    applyBranch(ctx, branchId, caller.id);
  }
);

/**
 * Commit alone — **development only**.
 *
 * The ready check is the real path, and this refuses to run when a second
 * member is present, so it cannot quietly replace it. It exists so the journey
 * past a commit can be worked on in one browser tab.
 */
export const commitBranchSolo = spacetimedb.reducer({ branchId: t.u64() }, (ctx, { branchId }) => {
  const caller = requireHuman(ctx);
  const branchRow = ctx.db.branch.id.find(branchId);
  if (!branchRow) throw new SenderError('branch not found');
  const sessionRow = sessionOrReject(ctx, branchRow.sessionId, caller.householdId);

  const others = humanMembers(ctx, sessionRow.householdId).filter(m => m.id !== caller.id);
  const anyonePresent = others.some(
    m => sessionMemberRow(ctx, sessionRow.id, m.id)?.present === true
  );
  if (anyonePresent) {
    throw new SenderError('your partner is here — use the ready check');
  }
  if (!applyBranch(ctx, branchId, caller.id)) {
    throw new SenderError('this session is already settled');
  }
});

export const closeSession = spacetimedb.reducer({ sessionId: t.u64() }, (ctx, { sessionId }) => {
  const caller = requireHuman(ctx);
  const sessionRow = sessionOrReject(ctx, sessionId, caller.householdId);
  if (sessionRow.status !== 'open') return;
  // The event stays active so the session can be resumed (08 Live Session Spec).
  ctx.db.session.id.update({ ...sessionRow, status: 'closed' });
});

// ---------------------------------------------------------------------------
// The agent (Stage 6)
// ---------------------------------------------------------------------------

/**
 * Agent-only reducers reject anyone whose member role is not `agent`
 * (02 Ground Rules #4). Together with `requireHuman` on every plan-changing
 * reducer, this is what makes "the agent proposes; humans decide" structural
 * rather than a convention.
 */
function requireAgent(ctx: Ctx) {
  const m = ctx.db.member.identity.find(ctx.sender);
  if (!m || m.role !== 'agent') throw new SenderError('agent only');
  return m;
}

/**
 * The agent service claims the `agent` role for a household by presenting a
 * shared secret (see agent-secret.ts for why it is a module constant).
 *
 * Idempotent: a reconnecting service with the same identity re-registers
 * harmlessly, which matters because the service persists its token and will
 * reconnect across restarts.
 */
export const registerAgent = spacetimedb.reducer(
  { joinCode: t.string(), secret: t.string() },
  (ctx, { joinCode, secret }) => {
    if (secret !== AGENT_SHARED_SECRET) throw new SenderError('wrong agent secret');

    const household = ctx.db.household.joinCode.find(joinCode.trim().toUpperCase());
    if (!household) throw new SenderError('no household with that code');

    const existing = ctx.db.member.identity.find(ctx.sender);
    if (existing) {
      if (existing.householdId === household.id) {
        ctx.db.member.id.update({
          ...existing,
          role: 'agent',
          online: true,
          lastSeenAt: ctx.timestamp,
        });
        return;
      }
      // An **agent** may move between households: one service serving whichever
      // household exists is normal in development, and on a dev database with
      // leftovers it must be able to follow the live one. A human may not —
      // that would let someone walk out of their own plan.
      if (existing.role !== 'agent') {
        throw new SenderError('this identity already belongs to another household');
      }
      ctx.db.member.id.delete(existing.id);
    }

    const alreadyAgent = [...ctx.db.member.householdId.filter(household.id)].find(
      m => m.role === 'agent'
    );
    if (alreadyAgent) {
      // Replace the old agent identity: a restarted service without its token
      // would otherwise be locked out of its own household.
      ctx.db.member.id.delete(alreadyAgent.id);
    }

    ctx.db.member.insert({
      id: 0n,
      householdId: household.id,
      identity: ctx.sender,
      displayName: 'Branches',
      colorKey: 'agent',
      role: 'agent',
      online: true,
      lastSeenAt: ctx.timestamp,
    });
  }
);

/**
 * How long a `running` job may go untouched before it counts as abandoned.
 *
 * Comfortably longer than the service's own task budget
 * (`AGENT_TASK_BUDGET_MS`, 60s), so a slow-but-alive job is never stolen from
 * underneath itself.
 */
const STALE_JOB_MICROS = 120_000_000n;

/**
 * Give up on a job after this many claims.
 *
 * A job that crashes the service will crash it again, so unbounded requeuing is
 * a loop that keeps a household's agent permanently busy failing. Failing the
 * job instead hands the user the deterministic fallback, which is the whole
 * point of having one.
 */
const MAX_JOB_ATTEMPTS = 3;

/**
 * Recover jobs abandoned by a service that died mid-flight.
 *
 * Requeues anything `running` past `STALE_JOB_MICROS` so it can be picked up
 * again, or fails it once it has had `MAX_JOB_ATTEMPTS`. Returns how many rows
 * it touched.
 *
 * This runs inside `claimJob` as well as on its own, so a restarted service
 * recovers without needing to know it crashed.
 */
function reclaimStaleJobs(ctx: Ctx, householdId: bigint): number {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  let touched = 0;

  for (const job of [...ctx.db.agentJob.householdId.filter(householdId)]) {
    if (job.status !== 'running') continue;
    // A row written before this column existed has no claim time; treat it as
    // stale rather than immortal.
    const claimed = job.claimedAt?.microsSinceUnixEpoch;
    if (claimed !== undefined && now - claimed < STALE_JOB_MICROS) continue;

    if (job.attempts >= MAX_JOB_ATTEMPTS) {
      ctx.db.agentJob.id.update({
        ...job,
        status: 'failed',
        result: 'the assistant stopped responding',
        progressText: '',
        claimedAt: undefined,
      });
    } else {
      ctx.db.agentJob.id.update({
        ...job,
        status: 'queued',
        progressText: '',
        claimedAt: undefined,
      });
    }
    touched++;
  }
  return touched;
}

/**
 * Recover abandoned jobs, as its own reducer.
 *
 * The service calls this on connect and on a timer. A human cannot: like every
 * other job reducer it is agent-only, so this is not a route for one partner to
 * disturb the other's in-flight work.
 */
export const reclaimJobs = spacetimedb.reducer({}, ctx => {
  const agent = requireAgent(ctx);
  reclaimStaleJobs(ctx, agent.householdId);
});

/** Take a queued job. One at a time per household, in creation order. */
export const claimJob = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  const agent = requireAgent(ctx);
  const job = ctx.db.agentJob.id.find(jobId);
  if (!job) throw new SenderError('job not found');
  if (job.householdId !== agent.householdId) throw new SenderError('not your household');

  // Before deciding anything, clear out jobs a dead service left behind — the
  // check below would otherwise read an abandoned row as a live one and refuse
  // every future claim for this household.
  reclaimStaleJobs(ctx, job.householdId);

  // Re-read: the job we were asked for may itself have just been requeued or
  // failed by the sweep above.
  const fresh = ctx.db.agentJob.id.find(jobId);
  if (!fresh) throw new SenderError('job not found');
  if (fresh.status !== 'queued') throw new SenderError('that job is not queued');

  // Jobs are processed one at a time per household (07 Agent Spec#Job flow), so
  // a running job blocks the next claim rather than racing it.
  const running = [...ctx.db.agentJob.householdId.filter(fresh.householdId)].find(
    x => x.status === 'running'
  );
  if (running) throw new SenderError('another job is already running');

  ctx.db.agentJob.id.update({
    ...fresh,
    status: 'running',
    attempts: fresh.attempts + 1,
    claimedAt: ctx.timestamp,
  });
});

/** Progress text, shown live on every screen. */
export const setJobProgress = spacetimedb.reducer(
  { jobId: t.u64(), progressText: t.string() },
  (ctx, { jobId, progressText }) => {
    const agent = requireAgent(ctx);
    const job = ctx.db.agentJob.id.find(jobId);
    if (!job || job.householdId !== agent.householdId) throw new SenderError('job not found');
    // Progress is also a heartbeat: refreshing the claim is what distinguishes
    // a job that is slow from one whose service has died.
    ctx.db.agentJob.id.update({
      ...job,
      progressText: progressText.slice(0, 200),
      claimedAt: ctx.timestamp,
    });
  }
);

export const completeJob = spacetimedb.reducer(
  { jobId: t.u64(), result: t.string(), modelUsed: t.string() },
  (ctx, { jobId, result, modelUsed }) => {
    const agent = requireAgent(ctx);
    const job = ctx.db.agentJob.id.find(jobId);
    if (!job || job.householdId !== agent.householdId) throw new SenderError('job not found');
    ctx.db.agentJob.id.update({
      ...job,
      status: 'done',
      result: result.slice(0, 20000),
      modelUsed,
      progressText: '',
      claimedAt: undefined,
    });
  }
);

export const failJob = spacetimedb.reducer(
  { jobId: t.u64(), reason: t.string() },
  (ctx, { jobId, reason }) => {
    const agent = requireAgent(ctx);
    const job = ctx.db.agentJob.id.find(jobId);
    if (!job || job.householdId !== agent.householdId) throw new SenderError('job not found');
    ctx.db.agentJob.id.update({
      ...job,
      status: 'failed',
      result: reason.slice(0, 2000),
      progressText: '',
      claimedAt: undefined,
    });
  }
);

/** A message authored by the agent, with optional tap-able follow-up chips. */
export const postAgentMessage = spacetimedb.reducer(
  { text: t.string(), chips: t.array(t.string()), refId: t.option(t.u64()) },
  (ctx, { text, chips, refId }) => {
    const agent = requireAgent(ctx);
    ctx.db.chatMessage.insert({
      id: 0n,
      householdId: agent.householdId,
      sessionId: undefined,
      authorMemberId: agent.id,
      kind: 'text',
      text: cap(text, 2000),
      chips: chips.slice(0, 6).map(chip => cap(chip, 40)),
      refId,
      payload: '',
      createdAt: ctx.timestamp,
    });
  }
);

/**
 * The agent's three picks, with names and summaries
 * (07 Agent Spec#Tasks and tools).
 *
 * The agent may only **select and name** candidates the engine already
 * generated — it cannot invent a path. Passing an id that is not a candidate of
 * this session is rejected, which is the structural half of "the AI never
 * computes numbers" (02 Ground Rules #1).
 */
const BranchPick = t.object('BranchPick', {
  candidateId: t.u64(),
  name: t.string(),
  summary: t.string(),
});

/**
 * Name **one** branch and put it on screen at `position`.
 *
 * One call per branch, not one call for three: 08 Live Session Spec wants cards
 * to arrive one at a time, with "Building branch 2 of 3..." meaning something.
 * Writing all three in a single transaction would make both partners see them
 * land together and reduce the progress text to decoration.
 *
 * The agent may only **select and name** a candidate the engine already
 * generated. Passing an id that is not a candidate of this session is rejected,
 * which is the structural half of "the AI never computes numbers"
 * (02 Ground Rules #1).
 */
export const nameBranch = spacetimedb.reducer(
  { sessionId: t.u64(), position: t.i32(), pick: BranchPick, replaceExisting: t.bool() },
  (ctx, { sessionId, position, pick, replaceExisting }) => {
    const agent = requireAgent(ctx);
    const sessionRow = ctx.db.session.id.find(sessionId);
    if (!sessionRow || sessionRow.householdId !== agent.householdId) {
      throw new SenderError('session not found');
    }
    if (position < 0 || position >= BRANCHES_SHOWN) {
      throw new SenderError(`position must be 0..${BRANCHES_SHOWN - 1}`);
    }
    if (pick.name.length > 30) throw new SenderError('a branch name is at most 30 characters');
    if (pick.summary.length > 200) throw new SenderError('a summary is at most 200 characters');

    const candidate = ctx.db.branchCandidate.id.find(pick.candidateId);
    if (!candidate || candidate.sessionId !== sessionId) {
      throw new SenderError('that is not a candidate of this session');
    }

    const existing = [...ctx.db.branch.sessionId.filter(sessionId)];
    // The first of the three clears the previous batch, so a reroll does not
    // briefly show a mix of old and new cards.
    if (replaceExisting) {
      for (const row of existing) ctx.db.branch.id.delete(row.id);
    } else if (existing.some(row => row.candidateId === pick.candidateId)) {
      throw new SenderError('that candidate is already on screen');
    }

    for (const row of [...ctx.db.branch.sessionId.filter(sessionId)]) {
      if (row.position === position) ctx.db.branch.id.delete(row.id);
    }

    ctx.db.branchCandidate.id.update({ ...candidate, shownAt: ctx.timestamp });
    ctx.db.branch.insert({
      id: 0n,
      sessionId,
      candidateId: pick.candidateId,
      name: pick.name,
      summary: pick.summary,
      nameSource: 'agent',
      position,
      tunedBy: undefined,
    });

    // A new card means nobody has agreed to this set yet.
    clearReady(ctx, sessionId);
  }
);

/**
 * Create a life event from the agent's classification, and post the follow-ups
 * it still needs as chips.
 *
 * The agent chooses a template and fills parameters it was *told*; it never
 * computes an effect. Validation of the parameters themselves still happens in
 * the engine when the impact is computed.
 */
export const applyEventInterpretation = spacetimedb.reducer(
  {
    templateId: t.string(),
    params: t.array(ParamEntry),
    followUpPrompt: t.string(),
    followUpChips: t.array(t.string()),
  },
  (ctx, { templateId, params, followUpPrompt, followUpChips }) => {
    const agent = requireAgent(ctx);
    const template = EVENT_TEMPLATES[templateId as LifeEventTemplateId];
    if (!template) throw new SenderError(`unknown event: ${templateId}`);

    const existing = activeEventFor(ctx, agent.householdId);
    if (existing) {
      ctx.db.lifeEvent.id.update({ ...existing, status: 'dismissed' });
      const staleImpact = ctx.db.impact.eventId.find(existing.id);
      if (staleImpact) ctx.db.impact.eventId.delete(existing.id);
    }

    const event = ctx.db.lifeEvent.insert({
      id: 0n,
      householdId: agent.householdId,
      templateId,
      params: JSON.stringify(
        viaEngine(() => parseParams(templateId as LifeEventTemplateId, safeParams(params)))
      ),
      // `draft` while follow-ups are outstanding: an impact computed from
      // half-known parameters would be worse than none.
      status: followUpPrompt.trim() ? 'draft' : 'active',
      createdBy: agent.id,
      createdAt: ctx.timestamp,
    });

    ctx.db.chatMessage.insert({
      id: 0n,
      householdId: agent.householdId,
      sessionId: undefined,
      authorMemberId: agent.id,
      kind: followUpPrompt.trim() ? 'text' : 'event',
      text: capTrim(followUpPrompt, 300) || template.label,
      chips: followUpChips.slice(0, 6).map(chip => cap(chip, 40)),
      refId: event.id,
      payload: '',
      createdAt: ctx.timestamp,
    });
  }
);

/**
 * Turn typed feedback into constraints — "don't delay the house, we can cut
 * eating out" becomes a lock plus a saveMore allowance
 * (07 Agent Spec#Tasks and tools).
 *
 * The agent translates intent into the engine's own constraint shapes. It does
 * not choose a path; the engine rerolls and the couple still decides.
 */
export const applyConstraintTranslation = spacetimedb.reducer(
  { sessionId: t.u64(), memberId: t.u64(), targets: t.array(t.string()) },
  (ctx, { sessionId, memberId, targets }) => {
    const agent = requireAgent(ctx);
    const sessionRow = ctx.db.session.id.find(sessionId);
    if (!sessionRow || sessionRow.householdId !== agent.householdId) {
      throw new SenderError('session not found');
    }
    const onBehalfOf = ctx.db.member.id.find(memberId);
    if (!onBehalfOf || onBehalfOf.householdId !== agent.householdId) {
      throw new SenderError('member not found');
    }

    const allowed = ['goalOnTime', 'goalFullSize', 'noExtraSaving', 'saveMoreAtMost'];
    for (const target of targets.slice(0, 4)) {
      if (target.length > MAX_CONSTRAINT_JSON) throw new SenderError('that constraint is too large');
      const parsed = viaEngine(() => JSON.parse(target) as { kind: string });
      if (!allowed.includes(parsed.kind)) throw new SenderError(`unknown constraint: ${parsed.kind}`);
      ctx.db.constraint.insert({
        id: 0n,
        sessionId,
        // Recorded as the member's lock, not the agent's: the constraint is
        // theirs, the agent only read it out of a sentence.
        memberId,
        kind: 'lock',
        target: JSON.stringify(parsed),
        active: true,
      });
    }
  }
);

/** Queue work the app cannot queue itself, e.g. naming a fresh batch. */
export const requestBranchNaming = spacetimedb.reducer(
  { sessionId: t.u64() },
  (ctx, { sessionId }) => {
    const caller = requireHuman(ctx);
    const sessionRow = sessionOrReject(ctx, sessionId, caller.householdId);
    const candidates = [...ctx.db.branchCandidate.sessionId.filter(sessionId)]
      .filter(c => c.shownAt !== undefined && c.shownAt !== null)
      .map(c => ({
        candidateId: String(c.id),
        signature: c.signature,
        stats: JSON.parse(c.stats) as unknown,
      }));
    if (candidates.length === 0) throw new SenderError('no candidates to name');

    queueJob(ctx, caller.householdId, {
      kind: 'select_branches',
      input: { candidates },
      sessionId: sessionRow.id,
    });
  }
);

// ---------------------------------------------------------------------------
// Stage 0 sync canary — see schema.ts
// ---------------------------------------------------------------------------

export const increment = spacetimedb.reducer(ctx => {
  const row = ctx.db.counter.id.find(COUNTER_ID);
  if (!row) throw new SenderError('counter row missing; republish the module');
  ctx.db.counter.id.update({
    ...row,
    value: row.value + 1,
    engineCheck: f1SavingsNoInterest(12000, 24),
    engineVersion: ENGINE_VERSION,
    lastBumpedBy: ctx.sender,
  });
});

export const reset = spacetimedb.reducer(ctx => {
  const row = ctx.db.counter.id.find(COUNTER_ID);
  if (!row) return;
  ctx.db.counter.id.update({ ...row, value: 0, lastBumpedBy: undefined });
});
