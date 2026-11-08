import { SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import {
  DEFAULT_ASSUMPTIONS,
  ENGINE_VERSION,
  baselineFromItems,
  f1SavingsNoInterest,
  followUpForGapAnswer,
  inferBaseline,
  isLiquidSavingsQuestion,
  liquidSavingsFromRange,
  liquidSavingsGapQuestion,
  simulate,
  toIntegerCents,
  type Assumptions,
  type Baseline,
  type CounterpartyType,
  type GapQuestion,
  type Goal,
  type InferredItem,
  type Transaction,
} from '@branches/engine';
import {
  DEMO_NAMES,
  TEST_HOUSEHOLD_A_FUN_MONEY,
  TEST_HOUSEHOLD_A_LIQUID_SAVINGS,
  generateTestHouseholdA,
} from '@branches/mock-data';
import spacetimedb from './schema.ts';

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
  const baselineRow = ctx.db.baseline.householdId.find(householdId);
  if (!baselineRow) return;

  const members = [...ctx.db.member.householdId.filter(householdId)].filter(
    m => m.role === 'member'
  );

  const incomeByMember: Record<string, number> = {};
  for (const entry of baselineRow.incomeByMember) {
    incomeByMember[String(entry.memberId)] = entry.cents / 100;
  }
  // A member with no confirmed income still has to exist in the map, or the
  // simulation silently drops their fun money and income override slots.
  for (const m of members) {
    if (incomeByMember[String(m.id)] === undefined) incomeByMember[String(m.id)] = 0;
  }

  const funMoneyByMember: Record<string, number> = {};
  for (const m of members) {
    const fun = ctx.db.funMoney.memberId.find(m.id);
    funMoneyByMember[String(m.id)] = fun ? fun.monthlyCents / 100 : 0;
  }

  const baseline: Baseline = {
    incomeByMember,
    fixed: baselineRow.fixedCents / 100,
    debt: baselineRow.debtCents / 100,
    flexible: baselineRow.flexibleCents / 100,
    funMoneyByMember,
    retirement: baselineRow.retirementCents / 100,
    liquidSavings: baselineRow.liquidSavingsCents / 100,
  };

  const goals: Goal[] = [...ctx.db.goal.householdId.filter(householdId)]
    .filter(g => g.status === 'active')
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(g => ({
      id: String(g.id),
      costToday: g.costTodayCents / 100,
      targetMonth: g.targetMonth,
      priority: g.priority === 'must' ? 'must' : 'flex',
    }));

  const output = simulate({ baseline, goals, assumptions: assumptionsFor(ctx, householdId) });

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
  if (m) ctx.db.member.id.update({ ...m, online: false, lastSeenAt: ctx.timestamp });
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
      displayName: displayName.trim() || 'Partner A',
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
    const h = ctx.db.household.joinCode.find(joinCode.trim().toUpperCase());
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
      displayName: displayName.trim() || `Partner ${colorKey.toUpperCase()}`,
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
    const name = displayName.trim();
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
    if (monthlyCents < 0) throw new SenderError('an amount cannot be negative');
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

    ctx.db.gapQuestion.id.update({ ...q, answer });

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
    if (monthlyCents < 0) throw new SenderError('fun money cannot be negative');
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
      carryoverCents: Math.max(0, carryoverCents),
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
  const projection = ctx.db.planProjection.householdId.find(householdId);
  if (projection) ctx.db.planProjection.householdId.delete(householdId);

  const h = ctx.db.household.id.find(householdId);
  if (h) ctx.db.household.id.update({ ...h, onboarded: false });

  recomputeBaseline(ctx, householdId, caller.id);
});

// ---------------------------------------------------------------------------
// Goals and assumptions (Stage 3)
// ---------------------------------------------------------------------------

const MAX_GOALS = 12;

function validateGoal(title: string, costTodayCents: number, targetMonth: number, priority: string) {
  if (!title.trim()) throw new SenderError('a goal needs a name');
  if (costTodayCents <= 0) throw new SenderError('a goal needs a cost above zero');
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
      title: title.trim(),
      icon,
      costTodayCents,
      targetMonth,
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
      title: title.trim(),
      costTodayCents,
      targetMonth,
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
