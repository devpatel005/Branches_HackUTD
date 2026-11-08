/**
 * V4 Data flow, step 1 — 12 Verification#V4 Data flow.
 *
 * Drives the real reducers from two independent clients against a running
 * SpacetimeDB: create a household, join it, seed Test Household A, run
 * inference, confirm every item, answer the gap questions, set fun money, and
 * check the resulting baseline against 11 Mock Data.
 *
 * The part that cannot be tested any other way is **row-level security**: that
 * each partner receives only their own transactions, inferred items and gap
 * questions, while partner progress still arrives as counts. A single client
 * cannot prove that, and neither can reading the code.
 *
 *   npm run stdb:start   (separate terminal)
 *   npm run stdb:publish:local
 *   npm run verify:flow
 */
import { DbConnection, tables, reducers } from '@branches/bindings';
import type { Identity } from 'spacetimedb';
import { FLEXIBLE_LABEL } from '@branches/engine';
import { PRIVATE_MERCHANT_CANARIES, TEST_HOUSEHOLD_A_FUN_MONEY } from '@branches/mock-data';
import { check, finish, printTable, type Check } from './table.ts';

const HOST = process.env.SPACETIME_HOST ?? 'ws://127.0.0.1:3000';
const DB = process.env.SPACETIME_DB_NAME ?? 'branches';
const TIMEOUT_MS = 20_000;

const SUBSCRIPTIONS = [
  'SELECT * FROM household',
  'SELECT * FROM member',
  'SELECT * FROM transaction',
  'SELECT * FROM inferred_item',
  'SELECT * FROM gap_question',
  'SELECT * FROM fun_money',
  'SELECT * FROM baseline',
  'SELECT * FROM onboarding_progress',
  'SELECT * FROM goal',
  'SELECT * FROM plan_projection',
  'SELECT * FROM life_event',
  'SELECT * FROM impact',
  'SELECT * FROM chat_message',
  'SELECT * FROM session',
  'SELECT * FROM branch_candidate',
  'SELECT * FROM branch',
  'SELECT * FROM constraint',
  'SELECT * FROM plan_commitment',
];

type Client = { label: string; conn: DbConnection; identity: Identity };

function connect(label: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: no connection within ${TIMEOUT_MS}ms — is the module published?`)),
      TIMEOUT_MS
    );
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .onConnect((conn, identity) => {
        clearTimeout(timer);
        resolve({ label, conn, identity });
      })
      .onConnectError((_ctx, error) => {
        clearTimeout(timer);
        reject(new Error(`${label}: ${error.message}`));
      })
      .build();
  });
}

function subscribe(client: Client): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${client.label}: subscription timed out`)), TIMEOUT_MS);
    client.conn
      .subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(timer);
        resolve();
      })
      // The subscription builder's onError takes one argument; the error
      // arrives on the context, not as a second parameter.
      .onError(ctx => {
        clearTimeout(timer);
        reject(ctx.event ?? new Error('subscription failed'));
      })
      .subscribe(SUBSCRIPTIONS);
  });
}

/** Poll the client's local cache until a condition holds. */
async function waitFor<T>(what: string, read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 50));
  }
}

const rows = {
  members: (c: Client) => [...c.conn.db.member.iter()],
  items: (c: Client) => [...c.conn.db.inferredItem.iter()],
  gaps: (c: Client) => [...c.conn.db.gapQuestion.iter()],
  transactions: (c: Client) => [...c.conn.db.transaction.iter()],
  progress: (c: Client) => [...c.conn.db.onboardingProgress.iter()],
  baseline: (c: Client) => [...c.conn.db.baseline.iter()][0],
  funMoney: (c: Client) => [...c.conn.db.funMoney.iter()],
};

/**
 * Household-scoped readers for the **shared** tables.
 *
 * `transaction`, `inferred_item` and `gap_question` are already narrowed per
 * identity by row-level security, so a client only ever holds this run's rows.
 * `goal`, `plan_projection` and `baseline` are shared, and a local dev database
 * accumulates households across runs — so reading them unscoped picks up
 * leftovers and asserts against the wrong plan.
 */
let scopedHouseholdId: bigint | undefined;
const mine = {
  goals: (c: Client) => [...c.conn.db.goal.iter()].filter(g => g.householdId === scopedHouseholdId),
  projection: (c: Client) =>
    [...c.conn.db.planProjection.iter()].find(r => r.householdId === scopedHouseholdId),
  events: (c: Client) =>
    [...c.conn.db.lifeEvent.iter()].filter(e => e.householdId === scopedHouseholdId),
  impacts: (c: Client) =>
    [...c.conn.db.impact.iter()].filter(i => i.householdId === scopedHouseholdId),
  messages: (c: Client) =>
    [...c.conn.db.chatMessage.iter()]
      .filter(m => m.householdId === scopedHouseholdId)
      .sort((x, y) => (x.id < y.id ? -1 : 1)),
  sessions: (c: Client) =>
    [...c.conn.db.session.iter()].filter(x => x.householdId === scopedHouseholdId),
  commitment: (c: Client) =>
    [...c.conn.db.planCommitment.iter()].find(x => x.householdId === scopedHouseholdId),
};

/** Session-scoped readers, set once a session exists. */
let scopedSessionId: bigint | undefined;
const inSession = {
  candidates: (c: Client) =>
    [...c.conn.db.branchCandidate.iter()]
      .filter(x => x.sessionId === scopedSessionId)
      .sort((x, y) => (x.id < y.id ? -1 : 1)),
  branches: (c: Client) =>
    [...c.conn.db.branch.iter()]
      .filter(x => x.sessionId === scopedSessionId)
      .sort((x, y) => x.position - y.position),
  constraints: (c: Client) =>
    [...c.conn.db.constraint.iter()].filter(x => x.sessionId === scopedSessionId && x.active),
};

const checks: Check[] = [];

// ======================================================================
// 1. Two devices, one household
// ======================================================================
const a = await connect('A');
const b = await connect('B');
await Promise.all([subscribe(a), subscribe(b)]);

await a.conn.reducers.createHousehold({ displayName: 'Maya' });

// Find *our* household via our own member row. The table accumulates
// households across runs, so taking the first row would pick up a leftover
// from an earlier run and everything after would assert against the wrong one.
const myMember = await waitFor('my member row', () =>
  rows.members(a).find(m => m.identity.toHexString() === a.identity.toHexString())
);
const household = await waitFor('my household', () =>
  [...a.conn.db.household.iter()].find(h => h.id === myMember.householdId)
);
scopedHouseholdId = household.id;

checks.push(
  check('F1', 'join code is 6 characters', household.joinCode.length, 6),
  check('F2', 'join code uses the unambiguous alphabet', /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(household.joinCode), true),
  check('F3', 'currentMonth looks like YYYY-MM', /^\d{4}-(0[1-9]|1[0-2])$/.test(household.currentMonth), true),
  check('F4', 'household starts un-onboarded', household.onboarded, false)
);

await b.conn.reducers.joinHousehold({ joinCode: household.joinCode, displayName: 'Jordan' });
await waitFor('both members on A', () =>
  rows.members(a).filter(m => m.householdId === household.id && m.role === 'member').length === 2
    ? true
    : undefined
);

const householdMembers = rows
  .members(a)
  .filter(m => m.householdId === household.id && m.role === 'member')
  .sort((x, y) => (x.id < y.id ? -1 : 1));
const memberA = householdMembers[0]!;
const memberB = householdMembers[1]!;

checks.push(
  check('F5', 'both partners appear on the first device', householdMembers.length, 2),
  check('F6', 'colour keys are assigned in join order', householdMembers.map(m => m.colorKey), ['a', 'b']),
  check('F7', 'display names came through', householdMembers.map(m => m.displayName), ['Maya', 'Jordan']),
  check('F8', 'a wrong join code is rejected', await rejects(() => b.conn.reducers.joinHousehold({ joinCode: 'ZZZZZZ', displayName: 'X' })), true),
  check('F9', 'joining twice is rejected', await rejects(() => b.conn.reducers.joinHousehold({ joinCode: household.joinCode, displayName: 'X' })), true)
);

// ======================================================================
// 2. Seed and infer
// ======================================================================
await a.conn.reducers.seedMockData({ profileId: 'test-household-a' });
await a.conn.reducers.runInference({});

await waitFor('A to receive inferred items', () =>
  rows.items(a).length > 0 ? true : undefined
);
await waitFor('B to receive inferred items', () =>
  rows.items(b).length > 0 ? true : undefined
);

const itemsSeenByA = rows.items(a);
const itemsSeenByB = rows.items(b);
const txnsSeenByA = rows.transactions(a);
const txnsSeenByB = rows.transactions(b);

// ======================================================================
// 3. Row-level security — the check that needs two clients
// ======================================================================
checks.push(
  check('P1', 'A receives only items it owns', itemsSeenByA.every(i => i.ownerMemberId === memberA.id), true),
  check('P2', 'B receives only items it owns', itemsSeenByB.every(i => i.ownerMemberId === memberB.id), true),
  check('P3', 'A sees 8 of its own items, not all 16', itemsSeenByA.length, 8),
  check('P4', 'B sees 8 of its own items, not all 16', itemsSeenByB.length, 8),
  check('P5', 'A receives only its own transactions', txnsSeenByA.every(t => t.ownerMemberId === memberA.id), true),
  check('P6', 'B receives only its own transactions', txnsSeenByB.every(t => t.ownerMemberId === memberB.id), true),
  check('P7', 'A cannot see a single transaction of B', txnsSeenByA.filter(t => t.ownerMemberId === memberB.id).length, 0),
  check('P8', 'A receives only its own gap question', rows.gaps(a).every(g => g.ownerMemberId === memberA.id), true),
  check('P9', 'each partner has two gap questions (brokerage + liquid savings)', [rows.gaps(a).length, rows.gaps(b).length], [2, 2]),
  // Progress is the deliberate exception: counts, for both members, to anyone
  // in the household.
  check('P10', 'progress view shows both members to A', rows.progress(a).filter(p => p.householdId === household.id).length, 2),
  check(
    'P11',
    'progress exposes counts only, no amounts or labels',
    Object.keys(rows.progress(a)[0] ?? {}).sort(),
    ['colorKey', 'displayName', 'funMoneySet', 'gapsAnswered', 'gapsTotal', 'householdId', 'itemsConfirmed', 'itemsTotal', 'memberId', 'online']
  )
);

// ======================================================================
// 4. Inference results, per owner
// ======================================================================
const rowOf = (i: { kind: string; label: string; monthlyCents: number }) =>
  `${i.kind}/${i.label}/${(i.monthlyCents / 100).toFixed(2)}`;
const sortedA = [...itemsSeenByA].sort((x, y) => x.sortIndex - y.sortIndex).map(rowOf);
const sortedB = [...itemsSeenByB].sort((x, y) => x.sortIndex - y.sortIndex).map(rowOf);

checks.push(
  check('I1', "A's items match 11 Mock Data, in order", sortedA, [
    'income/Northwind Corp/5000.00',
    'fixed/Oakridge Apartments/2200.00',
    'fixed/Shieldway Insurance/300.00',
    'fixed/StreamBox/20.00',
    'fixed/TuneHub/10.00',
    'debt/Lakeside Auto Finance/350.00',
    'retirement/Harborview Investments/250.00',
    `flexible/${FLEXIBLE_LABEL}/800.00`,
  ]),
  check('I2', "B's items match 11 Mock Data, in order", sortedB, [
    'income/Brightline Health/3800.00',
    'fixed/Cinewave/30.00',
    'fixed/FitCore Gym/40.00',
    'fixed/Lone Star Energy/250.00',
    'fixed/Metro Wireless/150.00',
    'debt/Summit Loan Servicing/150.00',
    'retirement/Harborview Investments/150.00',
    `flexible/${FLEXIBLE_LABEL}/700.00`,
  ]),
  check('I3', 'every item starts pending', itemsSeenByA.every(i => i.status === 'pending'), true),
  check('I4', '12 months of transactions per member', new Set(txnsSeenByA.map(t => t.date.slice(0, 7))).size, 12)
);

// ======================================================================
// 5. Confirm, answer, set fun money
// ======================================================================
await a.conn.reducers.confirmAllMyItems({});
await b.conn.reducers.confirmAllMyItems({});
await waitFor('A items confirmed', () =>
  rows.items(a).every(i => i.status === 'confirmed') ? true : undefined
);

// Both brokerage transfers are retirement, per the fixture's onboarding answers,
// and both partners hold $5-10K — which sums to the fixture's $15,000.
const brokerageGap = (c: Client) => rows.gaps(c).find(g => g.subject !== 'liquid-savings')!;
const liquidGap = (c: Client) => rows.gaps(c).find(g => g.subject === 'liquid-savings')!;

await a.conn.reducers.answerGap({ questionId: brokerageGap(a).id, answer: 'Retirement' });
await b.conn.reducers.answerGap({ questionId: brokerageGap(b).id, answer: 'Retirement' });
await a.conn.reducers.answerGap({ questionId: liquidGap(a).id, answer: '$5-10K' });
await b.conn.reducers.answerGap({ questionId: liquidGap(b).id, answer: '$5-10K' });
await waitFor('gaps answered', () =>
  rows.gaps(a).every(g => g.answer !== undefined) ? true : undefined
);

checks.push(
  check('G1', 'answering "Retirement" asks no follow-up', rows.gaps(a).length, 2),
  check('G2', 'the item stays classified as retirement', rows.items(a).find(i => i.label === 'Harborview Investments')?.kind, 'retirement'),
  check('G3', 'an answer outside the options is rejected', await rejects(() => a.conn.reducers.answerGap({ questionId: brokerageGap(a).id, answer: 'Something else' })), true),
  check("G4", "a member cannot answer the partner's question", await rejects(() => a.conn.reducers.answerGap({ questionId: brokerageGap(b).id, answer: 'Retirement' })), true),
  check('G5', "a member cannot confirm the partner's item", await rejects(() => a.conn.reducers.confirmItem({ itemId: itemsSeenByB[0]!.id })), true)
);

const funCents = TEST_HOUSEHOLD_A_FUN_MONEY * 100;
await a.conn.reducers.setFunMoney({ monthlyCents: funCents });
await b.conn.reducers.setFunMoney({ monthlyCents: funCents });
await a.conn.reducers.setFunMoneyStatus({ status: 'within', carryoverCents: 0 });
await waitFor('fun money set for both', () =>
  rows.funMoney(a).filter(f => f.householdId === household.id).length === 2 ? true : undefined
);

checks.push(
  check('M1', 'fun money stores the amount for both members', rows.funMoney(a).filter(f => f.householdId === household.id).map(f => f.monthlyCents), [funCents, funCents]),
  check('M2', 'fun money status is shared, amounts spent are not', Object.keys(rows.funMoney(a)[0] ?? {}).sort(), ['carryoverCents', 'householdId', 'memberId', 'monthlyCents', 'status']),
  check('M3', 'an invalid status is rejected', await rejects(() => a.conn.reducers.setFunMoneyStatus({ status: 'maybe', carryoverCents: 0 })), true)
);

// ======================================================================
// 6. The resulting baseline must equal 11 Mock Data's expectation
// ======================================================================
const baseline = await waitFor('baseline', () => {
  const row = [...a.conn.db.baseline.iter()].find(r => r.householdId === household.id);
  return row && row.fixedCents > 0 ? row : undefined;
});
const incomeCents = baseline.incomeByMember.map(e => e.cents).sort((x, y) => y - x);

checks.push(
  check('B1', 'income per member', incomeCents, [500000, 380000]),
  check('B2', 'fixed', baseline.fixedCents, 300000),
  check('B3', 'debt', baseline.debtCents, 50000),
  check('B4', 'flexible', baseline.flexibleCents, 150000),
  check('B5', 'retirement', baseline.retirementCents, 40000),
  check('B6', 'liquid savings from both answered ranges', baseline.liquidSavingsCents, 1500000)
);

// ======================================================================
// 7. Privacy canaries — nothing device-local reached the database
// ======================================================================
// Row ids are u64, so JSON.stringify needs a BigInt replacer. (Money columns
// are i32 precisely to avoid this; ids cannot be, because autoInc requires u64.)
const bigintSafe = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

const everythingAnyClientCanSee = JSON.stringify(
  [
    rows.transactions(a), rows.transactions(b),
    rows.items(a), rows.items(b),
    rows.gaps(a), rows.gaps(b),
    rows.funMoney(a), rows.progress(a), baseline,
  ],
  bigintSafe
);
const leaked = PRIVATE_MERCHANT_CANARIES.filter(name => everythingAnyClientCanSee.includes(name));

checks.push(
  check('C1', 'no private-purchase merchant appears in any readable row', leaked, []),
  check('C2', 'fun_money carries no spent amount or merchant', /merchant|purchase|spent/i.test(JSON.stringify(rows.funMoney(a), bigintSafe)), false)
);

// ======================================================================
// 8. Goals and the projection — Stage 3's Done-when
// ======================================================================
// Test Household A's two goals: Japan $5,000 at month 24 (flexible) and the
// House $40,000 at month 60 (must-have).
await a.conn.reducers.addGoal({
  title: 'Japan',
  icon: 'plane',
  costTodayCents: 500000,
  targetMonth: 24,
  priority: 'flex',
});
await b.conn.reducers.addGoal({
  title: 'House',
  icon: 'house',
  costTodayCents: 4000000,
  targetMonth: 60,
  priority: 'must',
});

await waitFor('both goals on A', () => (mine.goals(a).length === 2 ? true : undefined));
await waitFor('projection with both goals', () => {
  const row = mine.projection(a);
  if (!row) return undefined;
  const parsed = JSON.parse(row.json) as { goals: { id: string }[] };
  return parsed.goals.length === 2 ? row : undefined;
});

const projectionRow = mine.projection(a)!;
const projection = JSON.parse(projectionRow.json) as {
  goals: { id: string; inflatedCost: number; requiredMonthlyAtStart: number; funded: boolean; settleMonth: number }[];
  atRiskGoalIds: string[];
  tightMonths: number[];
  freeToPlan: number;
  emergencyMonthsNow: number;
  goalsOnTrack: { funded: number; total: number };
  series: { monthly: { month: number; totalSavings: number }[]; yearly: unknown[] };
  provenance: Record<string, { formula: string; formulaText: string; result: number }>;
};

const goalRows = mine.goals(a).sort((x, y) => x.targetMonth - y.targetMonth);
const japanId = String(goalRows[0]!.id);
const houseId = String(goalRows[1]!.id);
const pGoal = (id: string) => projection.goals.find(g => g.id === id);

checks.push(
  // A goal added by B is visible to A: goals are shared, unlike transactions.
  check('S1', 'both partners see both goals', [mine.goals(a).length, mine.goals(b).length], [2, 2]),
  check('S2', "a goal added by B reaches A", mine.goals(a).some(g => g.title === 'House'), true),
  check('S3', 'projection reaches B as well', mine.projection(b) !== undefined, true),

  // E1 / E2 / E3 — the Stage 3 Done-when, now out of a reducer rather than a script.
  check('S4', 'E1 Japan inflated cost', pGoal(japanId)?.inflatedCost, 5273.65),
  check('S5', 'E1 House inflated cost', pGoal(houseId)?.inflatedCost, 45699.58),
  check('S6', 'E2 Japan required monthly', pGoal(japanId)?.requiredMonthlyAtStart, 211.43),
  check('S7', 'E2 House required monthly', pGoal(houseId)?.requiredMonthlyAtStart, 689.3),
  check('S8', 'E3 freeToPlan', projection.freeToPlan, 1899.28),
  check('S9', 'E3 no at-risk goals', projection.atRiskGoalIds, []),
  check('S10', 'E3 no tight months', projection.tightMonths, []),
  check('S11', 'E3 emergency-fund months now', projection.emergencyMonthsNow, 4.29),
  check('S12', 'goals on track', projection.goalsOnTrack, { funded: 2, total: 2 }),

  // The chart's series and the "show the math" source must both be present.
  check('S13', 'monthly series spans the window', projection.series.monthly.length, 120),
  check('S14', 'yearly samples present', projection.series.yearly.length, 10),
  check('S15', 'chart line drops when a goal settles', projection.series.monthly[22]!.totalSavings > projection.series.monthly[23]!.totalSavings, true),
  check('S16', 'provenance travels with the projection', Object.keys(projection.provenance).length >= 9, true),
  check('S17', 'every goal number has provenance', [`goals.${japanId}.inflatedCost`, `goals.${japanId}.requiredMonthlyAtStart`].every(k => projection.provenance[k] !== undefined), true),
  check('S18', 'provenance carries readable formula text', (projection.provenance['freeToPlan']?.formulaText?.length ?? 0) > 20, true),
  check('S19', 'the projection records who changed it', projectionRow.lastChangedBy !== undefined, true)
);

// Editing an assumption must recompute for everyone.
const versionBefore = projectionRow.version;
await a.conn.reducers.setAssumptions({
  savingsRateBps: 600,
  inflationBps: 270,
  mortgageRateBps: 625,
  carRateBps: 700,
});
await waitFor('projection recomputed after assumption change', () =>
  (mine.projection(a)?.version ?? 0) > versionBefore ? true : undefined
);
const afterRateChange = JSON.parse(mine.projection(a)!.json) as { goals: { id: string; requiredMonthlyAtStart: number }[] };

checks.push(
  check('S20', 'changing the savings rate bumps the projection version', (mine.projection(a)?.version ?? 0) > versionBefore, true),
  // A higher savings rate means each goal needs less per month.
  check('S21', 'a higher savings rate lowers the required monthly', (afterRateChange.goals.find(g => g.id === japanId)?.requiredMonthlyAtStart ?? 0) < 211.43, true),
  check('S22', 'an absurd assumption is rejected', await rejects(() => a.conn.reducers.setAssumptions({ savingsRateBps: 9000, inflationBps: 270, mortgageRateBps: 625, carRateBps: 700 })), true)
);

// Put it back, then confirm goal edit and removal both recompute.
await a.conn.reducers.setAssumptions({ savingsRateBps: 400, inflationBps: 270, mortgageRateBps: 625, carRateBps: 700 });
await waitFor('rate restored', () => {
  const parsed = JSON.parse(mine.projection(a)!.json) as { goals: { id: string; requiredMonthlyAtStart: number }[] };
  return parsed.goals.find(g => g.id === japanId)?.requiredMonthlyAtStart === 211.43 ? true : undefined;
});

await a.conn.reducers.editGoal({
  goalId: goalRows[0]!.id,
  title: 'Japan trip',
  costTodayCents: 600000,
  targetMonth: 24,
  priority: 'flex',
});
await waitFor('edited goal recomputed', () => {
  const parsed = JSON.parse(mine.projection(a)!.json) as { goals: { id: string; inflatedCost: number }[] };
  return (parsed.goals.find(g => g.id === japanId)?.inflatedCost ?? 0) > 6000 ? true : undefined;
});

// Wait on **B** before asserting B: waiting only for A's projection proves
// nothing about whether the partner's device converged.
await waitFor("B to see the retitled goal", () =>
  mine.goals(b).find(g => String(g.id) === japanId)?.title === 'Japan trip' ? true : undefined
);

checks.push(
  check('S23', 'editing a goal retitles it for both partners', mine.goals(b).find(g => String(g.id) === japanId)?.title, 'Japan trip'),
  check('S24', 'editing a goal recomputes its inflated cost', JSON.parse(mine.projection(a)!.json).goals.find((g: { id: string }) => g.id === japanId).inflatedCost, 6328.37),
  check('S25', 'a goal with a zero cost is rejected', await rejects(() => a.conn.reducers.addGoal({ title: 'Nope', icon: 'star', costTodayCents: 0, targetMonth: 12, priority: 'flex' })), true),
  check('S26', 'a target month past the window is rejected', await rejects(() => a.conn.reducers.addGoal({ title: 'Nope', icon: 'star', costTodayCents: 100000, targetMonth: 121, priority: 'flex' })), true)
);

await a.conn.reducers.removeGoal({ goalId: goalRows[0]!.id });
await waitFor('goal removed on A', () => (mine.goals(a).length === 1 ? true : undefined));
await waitFor('goal removal reaches B', () => (mine.goals(b).length === 1 ? true : undefined));

checks.push(
  check('S27', 'removing a goal removes it for both', [mine.goals(a).length, mine.goals(b).length], [1, 1]),
  check('S28', 'the projection drops the removed goal', JSON.parse(mine.projection(a)!.json).goals.length, 1)
);

// ======================================================================
// 9. Life events and impact — Stage 4's Done-when
// ======================================================================
// Put Japan back, so the household is the one the goldens describe.
await a.conn.reducers.addGoal({
  title: 'Japan',
  icon: 'plane',
  costTodayCents: 500000,
  targetMonth: 24,
  priority: 'flex',
});
await waitFor('both goals restored', () => (mine.goals(a).length === 2 ? true : undefined));

const memberBId = memberB.id;

// --- E4: a $6,000 medical bill in month 3 changes nothing ---------------
await a.conn.reducers.createEvent({
  templateId: 'medical_bill',
  params: [
    { key: 'amount', value: '6000' },
    { key: 'month', value: '3' },
  ],
});
const medicalEvent = await waitFor('medical event', () =>
  mine.events(a).find(e => e.templateId === 'medical_bill' && e.status === 'active')
);
await a.conn.reducers.computeImpact({ eventId: medicalEvent.id });
const medicalImpact = await waitFor('medical impact', () =>
  mine.impacts(a).find(i => i.eventId === medicalEvent.id)
);
const e4 = JSON.parse(medicalImpact.json) as {
  noImpact: boolean;
  newlyAtRiskGoalIds: string[];
  tightMonthsAfter: number[];
  effects: { label: string }[];
};

checks.push(
  check('E4a', 'medical bill: reports no impact', e4.noImpact, true),
  check('E4b', 'medical bill: nothing newly at risk', e4.newlyAtRiskGoalIds, []),
  check('E4c', 'medical bill: no tight months', e4.tightMonthsAfter, []),
  check('E4d', 'medical bill: one effect line, the bill itself', e4.effects.length, 1),
  check('E4e', 'the effect line names the amount and month', e4.effects[0]?.label, '$6,000 once in month 3 for the bill')
);

// --- E5: the baby event ------------------------------------------------
await b.conn.reducers.createEvent({
  templateId: 'baby',
  params: [
    { key: 'monthsUntilBirth', value: '9' },
    { key: 'leaveMember', value: String(memberBId) },
    { key: 'leaveMonths', value: '2' },
    { key: 'care', value: 'daycare' },
  ],
});
const babyEvent = await waitFor('baby event on A', () =>
  mine.events(a).find(e => e.templateId === 'baby' && e.status === 'active')
);

checks.push(
  check('V1', 'one active event at a time: the medical bill was superseded', mine.events(a).find(e => e.id === medicalEvent.id)?.status, 'dismissed'),
  check('V2', 'a superseded event drops its stale impact', mine.impacts(a).some(i => i.eventId === medicalEvent.id), false),
  check('V3', "an event created by B reaches A", babyEvent.createdBy, memberBId)
);

await b.conn.reducers.computeImpact({ eventId: babyEvent.id });
const babyImpactRow = await waitFor('baby impact on A', () =>
  mine.impacts(a).find(i => i.eventId === babyEvent.id)
);
const e5 = JSON.parse(babyImpactRow.json) as {
  noImpact: boolean;
  newlyAtRiskGoalIds: string[];
  shortfallsByGoalId: Record<string, number>;
  tightMonthsAfter: number[];
  tightYearsBefore: number[];
  tightYearsAfter: number[];
  freeToPlanBefore: number;
  freeToPlanAfter: number;
  effects: { label: string; cause: string }[];
  provenance: Record<string, { formulaText: string; result: number; inputs: Record<string, unknown> }>;
  goalsAfter: { id: string; funded: boolean }[];
};

const japanGoal = mine.goals(a).find(g => g.title === 'Japan')!;
const houseGoal = mine.goals(a).find(g => g.title === 'House')!;
const expectedTightMonths = Array.from({ length: 23 - 9 + 1 }, (_, i) => i + 9);

checks.push(
  check('E5a', 'baby: Japan is newly at risk', e5.newlyAtRiskGoalIds, [String(japanGoal.id)]),
  check('E5b', 'baby: Japan shortfall', e5.shortfallsByGoalId[String(japanGoal.id)], 2183.97),
  check('E5c', 'baby: House still funded', e5.goalsAfter.find(g => g.id === String(houseGoal.id))?.funded, true),
  check('E5d', 'baby: tight months are 9 through 23', e5.tightMonthsAfter, expectedTightMonths),
  check('E5e', 'baby: tight years go from none to two', [e5.tightYearsBefore.length, e5.tightYearsAfter.length], [0, 2]),
  check('E5f', 'baby: it is not a no-impact event', e5.noImpact, false),
  // The event starts in month 9, so it costs nothing *today* — an honest result
  // rather than a bug: it breaks a goal two years out.
  check('E5g', 'baby: free to plan today is unchanged', e5.freeToPlanAfter, e5.freeToPlanBefore),

  // The four attributed effect lines, which are the "why it changed" block.
  check('E5h', 'baby: four attributed effects', e5.effects.length, 4),
  check('E5i', 'baby: effects are attributed, not summed', e5.effects.map(x => x.cause), ['unpaid-leave', 'birth', 'raising-a-child', 'daycare']),
  check('E5j', 'baby: daycare is its own line, not merged into the monthly cost', e5.effects.some(x => x.cause === 'daycare' && x.label.includes('$1,200')), true),
  check('E5k', 'baby: the leave line names the partner', e5.effects.find(x => x.cause === 'unpaid-leave')?.label.includes('Jordan'), true),

  // Every impact number is explainable.
  check('E5l', 'impact provenance covers the deltas', ['impact.freeToPlan', 'impact.emergencyMonthsMin', 'impact.tightYears', 'impact.goalsAtRisk'].every(k => e5.provenance[k] !== undefined), true),
  check('E5m', 'the shortfall has its own provenance record', e5.provenance[`impact.shortfall.${japanGoal.id}`] !== undefined, true),
  check('E5n', 'impact provenance explains why, not just what', Object.keys(e5.provenance['impact.tightYears']?.inputs ?? {}).some(k => k.startsWith('effect')), true),
  check('E5o', 'tightYears provenance result is the delta', e5.provenance['impact.tightYears']?.result, 2)
);

// --- The thread --------------------------------------------------------
const messages = mine.messages(a);
checks.push(
  check('T1', 'the thread records the event and its impact', messages.filter(m => m.kind === 'event' || m.kind === 'impact').length >= 4, true),
  check('T2', 'the impact message reaches B as well', mine.messages(b).some(m => m.kind === 'impact'), true),
  check('T3', 'an engine card has no author', messages.find(m => m.kind === 'impact')?.authorMemberId, undefined),
  check('T4', 'an event entry is attributed to whoever added it', messages.find(m => m.kind === 'event' && m.refId === babyEvent.id)?.authorMemberId, memberBId)
);

// --- Affordability -----------------------------------------------------
await a.conn.reducers.checkAffordability({ amountCents: 120000, label: 'couch' });
const affordMessage = await waitFor('affordability card', () =>
  mine.messages(a).find(m => m.kind === 'affordability')
);
const afford = JSON.parse(affordMessage.payload) as {
  amount: number;
  label: string;
  affordableWithoutChanges: boolean;
  emergencyMonthsMinBefore: number;
  emergencyMonthsMinAfter: number;
  minimalSaveMore: number | null;
};

checks.push(
  check('A1', 'affordability records the amount asked about', afford.amount, 1200),
  check('A2', 'affordability answers in emergency-fund months too', afford.emergencyMonthsMinAfter <= afford.emergencyMonthsMinBefore, true),
  check('A3', 'a $1,200 couch needs no goal changes', afford.affordableWithoutChanges, true),
  check('A4', 'an amount of zero is rejected', await rejects(() => a.conn.reducers.checkAffordability({ amountCents: 0, label: 'nothing' })), true)
);

// A large one-time purchase lands on the **emergency fund**, not on goal
// contributions: goals draw from the monthly surplus, and 06 Engine Spec's own
// example answer is "no goal changes; emergency fund goes from 4.2 to 3.9
// months". So the honest assertion for a big spend is that the safety net
// collapses and months turn tight, while the goals themselves still complete.
await a.conn.reducers.checkAffordability({ amountCents: 4000000, label: 'a boat' });
const bigAfford = await waitFor('big affordability card', () =>
  mine
    .messages(a)
    .filter(m => m.kind === 'affordability')
    .map(
      m =>
        JSON.parse(m.payload) as {
          amount: number;
          newlyAtRiskGoalIds: string[];
          emergencyMonthsMinBefore: number;
          emergencyMonthsMinAfter: number;
          tightMonthsBefore: number;
          tightMonthsAfter: number;
        }
    )
    .find(x => x.amount === 40000)
);

checks.push(
  check('A5', 'a $40,000 boat collapses the emergency fund', bigAfford.emergencyMonthsMinAfter < 0, true),
  check('A6', 'and turns months tight that were not before', [bigAfford.tightMonthsBefore, bigAfford.tightMonthsAfter > 0], [0, true]),
  check('A7', 'but the goals still complete: a lump sum does not starve them', bigAfford.newlyAtRiskGoalIds, []),
  check('A8', 'the small purchase moved the fund only slightly', afford.emergencyMonthsMinBefore - afford.emergencyMonthsMinAfter < 1, true)
);

// --- Dismiss -----------------------------------------------------------
await a.conn.reducers.dismissEvent({ eventId: babyEvent.id });
await waitFor('event dismissed on B', () =>
  mine.events(b).find(e => e.id === babyEvent.id)?.status === 'dismissed' ? true : undefined
);

checks.push(
  check('D1', 'dismissing an event marks it dismissed for both', mine.events(b).find(e => e.id === babyEvent.id)?.status, 'dismissed'),
  check('D2', 'dismissing drops the impact', mine.impacts(a).some(i => i.eventId === babyEvent.id), false),
  check('D3', 'dismissing leaves the committed plan alone', JSON.parse(mine.projection(a)!.json).atRiskGoalIds, []),
  check('D4', 'an unknown event is rejected', await rejects(() => a.conn.reducers.computeImpact({ eventId: 999999n })), true)
);

// ======================================================================
// 10. Branches — Stage 5's Done-when
// ======================================================================
// Re-create the baby event: the previous section dismissed it.
await b.conn.reducers.createEvent({
  templateId: 'baby',
  params: [
    { key: 'monthsUntilBirth', value: '9' },
    { key: 'leaveMember', value: String(memberBId) },
    { key: 'leaveMonths', value: '2' },
    { key: 'care', value: 'daycare' },
  ],
});
const sessionEvent = await waitFor('baby event again', () =>
  mine.events(a).find(e => e.templateId === 'baby' && e.status === 'active')
);
await a.conn.reducers.computeImpact({ eventId: sessionEvent.id });
await waitFor('impact again', () => mine.impacts(a).find(i => i.eventId === sessionEvent.id));

await a.conn.reducers.startSession({ eventId: sessionEvent.id });
const sessionRow = await waitFor('session', () =>
  mine.sessions(a).find(x => x.eventId === sessionEvent.id && x.status === 'open')
);
scopedSessionId = sessionRow.id;

await a.conn.reducers.generateCandidates({ sessionId: sessionRow.id });
await waitFor('branches on A', () => (inSession.branches(a).length === 3 ? true : undefined));
await waitFor('branches on B', () => (inSession.branches(b).length === 3 ? true : undefined));

const branches = inSession.branches(a);
const candidatesById = new Map(inSession.candidates(a).map(c => [c.id, c]));
const leverSetOf = (branchId: bigint) =>
  candidatesById.get(inSession.branches(a).find(x => x.id === branchId)!.candidateId)!;

const japanGoal2 = mine.goals(a).find(g => g.title === 'Japan')!;
const houseGoal2 = mine.goals(a).find(g => g.title === 'House')!;

// E8: the order and the fallback names.
checks.push(
  check('S5a', 'three branches are named and shown', branches.length, 3),
  check(
    'S5b',
    'E8 candidate order survives the round trip',
    branches.map(x => candidatesById.get(x.candidateId)?.signature),
    ['m:175', `d:${houseGoal2.id}=9|m:75`, `d:${houseGoal2.id}=18`]
  ),
  check('S5c', 'the first fallback name is the saveMore template', branches[0]?.name, 'Save $175 more a month'),
  check('S5d', 'a two-lever path is named Balanced', branches[1]?.name, 'Balanced'),
  check('S5e', 'a delay-only path names the goal and a date', /^Move House to \w{3} \d{4}$/.test(branches[2]?.name ?? ''), true),
  check('S5f', 'names come from templates, not the agent', branches.every(x => x.nameSource === 'template'), true),
  check('S5g', 'every branch has a projection-language summary', branches.every(x => x.summary.length > 20 && !/should|recommend|best option/i.test(x.summary)), true),
  check('S5h', 'candidates reach B as well', inSession.candidates(b).length, inSession.candidates(a).length)
);

// E9: each shown branch fixes the plan.
for (const [index, branchRow] of branches.entries()) {
  const stats = JSON.parse(candidatesById.get(branchRow.candidateId)!.stats) as {
    atRiskGoalIds: string[];
    goalsFunded: number;
    goalsTotal: number;
    tightYears: number;
  };
  checks.push(
    check(`S5i.${index + 1}`, `branch ${index + 1} leaves nothing at risk`, stats.atRiskGoalIds, []),
    check(`S5j.${index + 1}`, `branch ${index + 1} funds every goal`, [stats.goalsFunded, stats.goalsTotal], [2, 2])
  );
}

// --- Locks and reroll ---------------------------------------------------
// Test Household A has exactly **three** paths out of E5 (saveMore 175, the
// balanced pair, and delay house 18), and the first generation shows all three.
// So a reroll here correctly finds nothing new and says so — which is the
// documented exhaustion behaviour (OPEN(OD-5)), not a failure.
await a.conn.reducers.addConstraint({
  sessionId: sessionRow.id,
  kind: 'lock',
  target: JSON.stringify({ kind: 'goalOnTime', goalId: String(houseGoal2.id) }),
});
await waitFor('lock registered', () => (inSession.constraints(a).length === 1 ? true : undefined));

const shownBeforeLock = inSession.candidates(a).map(c => c.signature);

// Generating under the lock must never offer a path that delays the house.
await a.conn.reducers.generateCandidates({ sessionId: sessionRow.id });
await waitFor('branches under the lock', () =>
  inSession.branches(a).length > 0 ? true : undefined
);
const underLock = inSession.branches(a).map(
  x => inSession.candidates(a).find(y => y.id === x.candidateId)!
);

const messagesBeforeReroll = mine.messages(a).length;
await a.conn.reducers.reroll({ sessionId: sessionRow.id });
await waitFor('reroll answered', () =>
  mine.messages(a).length > messagesBeforeReroll ||
  inSession.candidates(a).some(c => c.batch > 0)
    ? true
    : undefined
);
const rerollMessage = mine
  .messages(a)
  .slice(messagesBeforeReroll)
  .find(m => m.text.includes('all the paths that fit'));
const newBatch = inSession.candidates(a).filter(c => c.batch > 0);

checks.push(
  check('L1', 'a lock is visible to both partners', inSession.constraints(b).length, 1),
  check(
    'L2',
    'locking "House on time" never offers a path that delays the house',
    underLock.every(c => {
      const levers = JSON.parse(c.levers) as { delays?: Record<string, number> };
      return (levers.delays?.[String(houseGoal2.id)] ?? 0) === 0;
    }),
    true
  ),
  check('L3', 'and a path still exists under that lock', underLock.length > 0, true),
  check(
    'L4',
    'a reroll either offers new paths or says there are none left',
    newBatch.length > 0 || rerollMessage !== undefined,
    true
  ),
  check(
    'L5',
    'nothing a reroll offers repeats an already-shown lever set',
    newBatch.some(c => shownBeforeLock.includes(c.signature)),
    false
  ),
  check(
    'L6',
    'exhaustion is reported in the documented words',
    newBatch.length === 0 ? rerollMessage?.text : "These are all the paths that fit what you've locked.",
    "These are all the paths that fit what you've locked."
  )
);

// --- Pins and bridges ---------------------------------------------------
// Each partner pins one thing, and they conflict: Japan must not move, and no
// extra saving. Nothing in the normal domains satisfies both.
await a.conn.reducers.addConstraint({
  sessionId: sessionRow.id,
  kind: 'pin',
  target: JSON.stringify({ kind: 'goalOnTime', goalId: String(japanGoal2.id) }),
});
await b.conn.reducers.addConstraint({
  sessionId: sessionRow.id,
  kind: 'pin',
  target: JSON.stringify({ kind: 'noExtraSaving' }),
});
await waitFor('two pins', () =>
  inSession.constraints(a).filter(c => c.kind === 'pin').length === 2 ? true : undefined
);

const messagesBeforeBridge = mine.messages(a).length;
await a.conn.reducers.requestBridge({ sessionId: sessionRow.id });
await waitFor('bridge answered', () =>
  mine.messages(a).length > messagesBeforeBridge ||
  inSession.candidates(a).some(c => c.source === 'bridge')
    ? true
    : undefined
);

const bridgeCandidates = inSession.candidates(a).filter(c => c.source === 'bridge');
const closestMessage = mine
  .messages(a)
  .slice(messagesBeforeBridge)
  .find(m => m.kind === 'system');

checks.push(
  check('P1b', 'each member holds exactly one pin', inSession.constraints(a).filter(c => c.kind === 'pin').length, 2),
  check(
    'P2b',
    'conflicting pins produce bridges or a closest-option statement',
    bridgeCandidates.length > 0 || closestMessage !== undefined,
    true
  ),
  check(
    'P3b',
    'any bridge honours every pin',
    bridgeCandidates.every(c => {
      const levers = JSON.parse(c.levers) as { delays?: Record<string, number>; saveMore?: number };
      return (levers.saveMore ?? 0) === 0 && (levers.delays?.[String(japanGoal2.id)] ?? 0) === 0;
    }),
    true
  ),
  check(
    'P4b',
    'the closest option says what it would take, with no AI tiebreaker',
    bridgeCandidates.length > 0 || /would|No path in range/.test(closestMessage?.text ?? ''),
    true
  ),
  check('P5b', 'a second pin from the same member replaces the first', await onePinPerMember(a, sessionRow.id, String(houseGoal2.id)), 1)
);

// Clear the pins so the rest of the section works on an unconstrained session.
for (const c of inSession.constraints(a).filter(x => x.kind === 'pin' && x.memberId === memberA.id)) {
  await a.conn.reducers.removeConstraint({ constraintId: c.id });
}
for (const c of inSession.constraints(b).filter(x => x.kind === 'pin' && x.memberId === memberBId)) {
  await b.conn.reducers.removeConstraint({ constraintId: c.id });
}
for (const c of inSession.constraints(a).filter(x => x.kind === 'lock')) {
  await a.conn.reducers.removeConstraint({ constraintId: c.id });
}
await waitFor('constraints cleared', () => (inSession.constraints(a).length === 0 ? true : undefined));

// --- Slider tuning ------------------------------------------------------
await a.conn.reducers.generateCandidates({ sessionId: sessionRow.id });
await waitFor('fresh branches', () => (inSession.branches(a).length === 3 ? true : undefined));

const tunable = inSession.branches(a)[0]!;
const tunableCandidate = inSession.candidates(a).find(c => c.id === tunable.candidateId)!;
const statsBefore = JSON.parse(tunableCandidate.stats) as { saveMore: number };

await a.conn.reducers.tuneLever({
  branchId: tunable.id,
  lever: 'saveMore',
  goalId: undefined,
  value: 250,
});
await waitFor('tuned on B', () => {
  const c = [...b.conn.db.branchCandidate.iter()].find(x => x.id === tunableCandidate.id);
  return c && c.source === 'custom' ? true : undefined;
});

const tunedCandidate = [...a.conn.db.branchCandidate.iter()].find(x => x.id === tunableCandidate.id)!;
const tunedStats = JSON.parse(tunedCandidate.stats) as { saveMore: number; atRiskGoalIds: string[] };

// Clamping: the cap is 25% of $1,500 flexible, rounded down to $25 -> $375.
await a.conn.reducers.tuneLever({
  branchId: tunable.id,
  lever: 'saveMore',
  goalId: undefined,
  value: 99999,
});
await waitFor('clamped', () => {
  const c = [...a.conn.db.branchCandidate.iter()].find(x => x.id === tunableCandidate.id);
  const stats = c ? (JSON.parse(c.stats) as { saveMore: number }) : undefined;
  return stats && stats.saveMore === 375 ? true : undefined;
});

checks.push(
  check('T5', 'tuning a slider changes the stats', tunedStats.saveMore !== statsBefore.saveMore, true),
  check('T6', 'tuning marks the branch as custom', tunedCandidate.source, 'custom'),
  check('T7', 'the tuned stats reach the partner', [...b.conn.db.branchCandidate.iter()].find(x => x.id === tunableCandidate.id)?.source, 'custom'),
  check(
    'T8',
    'an out-of-range slider value clamps to the lever domain',
    (JSON.parse([...a.conn.db.branchCandidate.iter()].find(x => x.id === tunableCandidate.id)!.stats) as { saveMore: number }).saveMore,
    375
  ),
  check('T9', 'a shrink on a must-have goal is refused', await rejects(() => a.conn.reducers.tuneLever({ branchId: tunable.id, lever: 'shrink', goalId: houseGoal2.id, value: 10 })), true),
  check('T10', 'an unknown lever is refused', await rejects(() => a.conn.reducers.tuneLever({ branchId: tunable.id, lever: 'nonsense', goalId: undefined, value: 1 })), true)
);

// --- Commit -------------------------------------------------------------
// Commit the delay-only branch, so both the goal move and the saveMore path
// are exercised across the suite.
await a.conn.reducers.generateCandidates({ sessionId: sessionRow.id });
await waitFor('branches for commit', () => (inSession.branches(a).length === 3 ? true : undefined));

const delayBranch = inSession.branches(a).find(x => {
  const c = inSession.candidates(a).find(y => y.id === x.candidateId);
  const levers = c ? (JSON.parse(c.levers) as { delays?: Record<string, number>; saveMore?: number }) : undefined;
  return (levers?.delays?.[String(houseGoal2.id)] ?? 0) > 0 && (levers?.saveMore ?? 0) === 0;
})!;
const delayLevers = JSON.parse(
  inSession.candidates(a).find(y => y.id === delayBranch.candidateId)!.levers
) as { delays: Record<string, number> };
const houseBefore = mine.goals(a).find(g => g.id === houseGoal2.id)!;

// The commit now goes through the ready check (Stage 7): both partners join,
// select the same branch, and report ready. The server commits inside the
// second `setReady`, in one transaction.
await a.conn.reducers.joinSession({ sessionId: sessionRow.id });
await b.conn.reducers.joinSession({ sessionId: sessionRow.id });
await a.conn.reducers.selectBranch({ sessionId: sessionRow.id, branchId: delayBranch.id });
await b.conn.reducers.selectBranch({ sessionId: sessionRow.id, branchId: delayBranch.id });
await a.conn.reducers.setReady({ sessionId: sessionRow.id, ready: true });
await b.conn.reducers.setReady({ sessionId: sessionRow.id, ready: true });
// Wait for **both** caches. The checks below read from A, so waiting only for
// B asserts against a client that has not caught up yet — the same trap as
// Stage 3's goal-edit checks, and it reads as a product failure rather than a
// test one.
await waitFor('committed on B', () =>
  mine.sessions(b).find(x => x.id === sessionRow.id)?.status === 'committed' ? true : undefined
);
await waitFor('committed on A', () =>
  mine.sessions(a).find(x => x.id === sessionRow.id)?.status === 'committed' ? true : undefined
);
await waitFor('the goal move to reach A', () =>
  (mine.goals(a).find(g => g.id === houseGoal2.id)?.targetMonth ?? 0) > houseBefore.targetMonth
    ? true
    : undefined
);

const houseAfter = mine.goals(a).find(g => g.id === houseGoal2.id)!;
const committedProjection = JSON.parse(mine.projection(a)!.json) as { atRiskGoalIds: string[] };

checks.push(
  check('K1', 'committing moves the goal', houseAfter.targetMonth, houseBefore.targetMonth + delayLevers.delays[String(houseGoal2.id)]!),
  check('K2', 'but keeps the original target, so the move stays visible', houseAfter.originalTargetMonth, houseBefore.originalTargetMonth),
  check('K3', 'the event is marked applied', mine.events(a).find(e => e.id === sessionEvent.id)?.status, 'applied'),
  check('K4', 'the session is committed and records the branch', [mine.sessions(a).find(x => x.id === sessionRow.id)?.status, mine.sessions(a).find(x => x.id === sessionRow.id)?.committedBranchId === delayBranch.id], ['committed', true]),
  check('K5', 'the plan is recomputed with nothing at risk', committedProjection.atRiskGoalIds, []),
  // Idempotent: a second ready on a settled session does nothing rather than
  // applying the branch twice (08 Live Session Spec#Edge cases).
  check('K6', 'a second ready on a committed session does nothing', await secondReadyIsHarmless(a, sessionRow.id, houseGoal2.id), true),
  check('K7', 'the thread records the decision', mine.messages(a).some(m => m.text.startsWith('This is your plan now')), true)
);

// Committing a saveMore branch must store a decision, not edit the baseline.
const baselineFlexibleBefore = mine.goals(a).length > 0 ? [...a.conn.db.baseline.iter()].find(x => x.householdId === household.id)!.flexibleCents : 0;
await a.conn.reducers.createEvent({
  templateId: 'medical_bill',
  params: [
    { key: 'amount', value: '500' },
    { key: 'month', value: '1' },
  ],
});
const smallEvent = await waitFor('small event', () =>
  mine.events(a).find(e => e.templateId === 'medical_bill' && e.status === 'active')
);
await a.conn.reducers.startSession({ eventId: smallEvent.id });
const session2 = await waitFor('second session', () =>
  mine.sessions(a).find(x => x.eventId === smallEvent.id && x.status === 'open')
);

checks.push(
  check('K8', 'starting a new session closes the old one', mine.sessions(a).filter(x => x.status === 'open').length, 1),
  check(
    'K9',
    'the baseline flexible figure is untouched by a commitment',
    [...a.conn.db.baseline.iter()].find(x => x.householdId === household.id)?.flexibleCents,
    baselineFlexibleBefore
  ),
  check('K10', 'the commitment row records what was decided', (mine.commitment(a)?.saveMoreCents ?? -1) >= 0, true)
);

await a.conn.reducers.closeSession({ sessionId: session2.id });
await a.conn.reducers.dismissEvent({ eventId: smallEvent.id });

/**
 * A member gets one pin (08 Live Session Spec), so adding a second must replace
 * the first. Returns how many active pins that member ends up holding.
 */
async function onePinPerMember(
  client: Client,
  sessionId: bigint,
  goalId: string
): Promise<number> {
  await client.conn.reducers.addConstraint({
    sessionId,
    kind: 'pin',
    target: JSON.stringify({ kind: 'goalOnTime', goalId }),
  });
  await new Promise(r => setTimeout(r, 200));
  return inSession.constraints(client).filter(c => c.kind === 'pin' && c.memberId === memberA.id)
    .length;
}

// ======================================================================
// 11. Reseed keeps the pairing
// ======================================================================
await a.conn.reducers.finishOnboarding({});
await waitFor('onboarded', () =>
  [...a.conn.db.household.iter()].find(h => h.id === household.id)?.onboarded ? true : undefined
);

await a.conn.reducers.reseedHousehold({});
await waitFor('reseed clears items', () => (rows.items(a).length === 0 ? true : undefined));

checks.push(
  check('R1', 'reseed clears inferred items', rows.items(a).length, 0),
  check('R2', 'reseed clears gap questions', rows.gaps(a).length, 0),
  check('R3', 'reseed clears fun money', rows.funMoney(a).filter(f => f.householdId === household.id).length, 0),
  // Role-filtered: an agent service, if one is running, registers as a member
  // of this household too. Counting every row would make this fail whenever the
  // agent happens to be up.
  check('R4', 'reseed keeps both partners paired', rows.members(a).filter(m => m.householdId === household.id && m.role === 'member').length, 2),
  check('R5', 'reseed keeps the join code', [...a.conn.db.household.iter()].find(h => h.id === household.id)?.joinCode, household.joinCode),
  check('R6', 'reseed keeps the transactions, so inference can re-run', rows.transactions(a).length > 0, true),
  check('R7', 'reseed returns the household to un-onboarded', [...a.conn.db.household.iter()].find(h => h.id === household.id)?.onboarded, false),
  check('R8', 'reseed clears goals', mine.goals(a).length, 0),
  // Agent-authored text is excluded on purpose. If an agent service is running
  // it will have registered into this household and may post the post-commit
  // summary moments after the reseed — correct behaviour, and not a reseed
  // failure. The assertion is that reseed cleared what *was* there.
  check(
    'R9',
    'reseed clears events and the thread',
    [mine.events(a).length, mine.messages(a).filter(m => m.kind !== 'text').length],
    [0, 0]
  ),
  check('R10', 'reseed clears sessions', mine.sessions(a).length, 0)
);

/**
 * A second `setReady` on a committed session must change nothing.
 *
 * Returns true when the goal's target month is identical afterwards — i.e. the
 * branch was not applied a second time.
 */
async function secondReadyIsHarmless(
  client: Client,
  sessionId: bigint,
  goalId: bigint
): Promise<boolean> {
  const before = mine.goals(client).find(g => g.id === goalId)?.targetMonth;
  try {
    await client.conn.reducers.setReady({ sessionId, ready: true });
  } catch {
    // A rejection is also acceptable: either way nothing was applied twice.
  }
  await new Promise(r => setTimeout(r, 200));
  return mine.goals(client).find(g => g.id === goalId)?.targetMonth === before;
}

/** True when a reducer call is rejected, which is what we want to assert. */
async function rejects(call: () => Promise<void>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

// ======================================================================
// 15. Reducer hardening — Stage 8
// ======================================================================
/**
 * Every reducer argument has a bound, and the bound is enforced server-side.
 *
 * The reducers were already careful about *who* and *which enum*; they were not
 * careful about *how big*. An argument goes straight into a row, and
 * `household`, `member`, `goal` and `chat_message` are public — so an unbounded
 * string is not one client's problem, it is a row every subscriber downloads.
 *
 * Two policies, asserted separately because they differ on purpose: free text
 * is truncated (a clipped name never interrupts anyone), money is rejected
 * (silently clamping somebody's figure would build the plan on a number they
 * never typed).
 */
const HUGE = 'x'.repeat(20000);

// Its own goal, not the Japan/House fixture: section 14's reseed deletes every
// goal, so anything created earlier is gone by the time this runs.
await a.conn.reducers.addGoal({
  title: 'Hardening',
  icon: 'star',
  costTodayCents: 123400,
  targetMonth: 30,
  priority: 'flex',
});
const goalForEdits = await waitFor('the hardening goal', () =>
  mine.goals(a).find(g => g.title === 'Hardening')
);

// --- Money at the domain edges ---
checks.push(
  check(
    'H1',
    'a goal cost above the ceiling is rejected, not clamped',
    await rejects(() =>
      a.conn.reducers.addGoal({
        title: 'Absurd',
        icon: 'star',
        costTodayCents: 2_000_000_000,
        targetMonth: 12,
        priority: 'flex',
      })
    ),
    true
  ),
  check(
    'H2',
    'a negative fun-money amount is rejected',
    await rejects(() => a.conn.reducers.setFunMoney({ monthlyCents: -1 })),
    true
  ),
  check(
    'H3',
    'an absurd fun-money amount is rejected too — the old check only had a floor',
    await rejects(() => a.conn.reducers.setFunMoney({ monthlyCents: 2_000_000_000 })),
    true
  ),
  check(
    'H4',
    'an affordability check above the ceiling is rejected',
    await rejects(() => a.conn.reducers.checkAffordability({ amountCents: 2_000_000_000, label: 'a yacht' })),
    true
  ),
  check(
    'H5',
    'an item edited to an absurd amount is rejected',
    await rejects(() => a.conn.reducers.editItem({ itemId: itemsSeenByA[0]!.id, monthlyCents: 2_000_000_000 })),
    true
  )
);

// --- Oversized free text is stored truncated, and the call still succeeds ---
await a.conn.reducers.setDisplayName({ displayName: HUGE });
await waitFor('the truncated name to land', () =>
  (rows.members(a).find(m => m.id === memberA.id)?.displayName.length ?? 0) > 0 &&
  (rows.members(a).find(m => m.id === memberA.id)?.displayName.length ?? 0) < 100
    ? true
    : undefined
);
const storedName = rows.members(a).find(m => m.id === memberA.id)!.displayName;

await a.conn.reducers.editGoal({
  goalId: goalForEdits.id,
  title: HUGE,
  costTodayCents: goalForEdits.costTodayCents,
  targetMonth: goalForEdits.targetMonth,
  priority: goalForEdits.priority,
});
await waitFor('the truncated goal title to land', () => {
  const title = mine.goals(a).find(g => g.id === goalForEdits.id)?.title;
  return title !== undefined && title.length < 100 ? true : undefined;
});
const storedTitle = mine.goals(a).find(g => g.id === goalForEdits.id)!.title;

checks.push(
  check('H6', 'a 20,000-character display name is truncated, not stored whole', storedName.length <= 40, true),
  check('H7', 'and the reducer still succeeded rather than erroring at the user', storedName.length > 0, true),
  check('H8', 'a 20,000-character goal title is truncated', storedTitle.length <= 60, true)
);

// Put the fixture back, so later assertions and reruns see the real values.
await a.conn.reducers.setDisplayName({ displayName: memberA.displayName });
await a.conn.reducers.editGoal({
  goalId: goalForEdits.id,
  title: goalForEdits.title,
  costTodayCents: goalForEdits.costTodayCents,
  targetMonth: goalForEdits.targetMonth,
  priority: goalForEdits.priority,
});

// --- Bad ids and oversized payloads ---
checks.push(
  check(
    'H9',
    'an unknown goal id is rejected rather than creating one',
    await rejects(() =>
      a.conn.reducers.editGoal({
        goalId: 999_999_999n,
        title: 'Ghost',
        costTodayCents: 100000,
        targetMonth: 12,
        priority: 'flex',
      })
    ),
    true
  ),
  check(
    'H10',
    'an unknown item id is rejected',
    await rejects(() => a.conn.reducers.editItem({ itemId: 999_999_999n, monthlyCents: 1000 })),
    true
  ),
  check(
    'H11',
    'an unknown event id is rejected',
    await rejects(() => a.conn.reducers.computeImpact({ eventId: 999_999_999n })),
    true
  ),
  check(
    'H12',
    'an unknown session id is rejected',
    await rejects(() => a.conn.reducers.generateCandidates({ sessionId: 999_999_999n })),
    true
  ),
  check(
    'H13',
    'a stale session id cannot be readied',
    await rejects(() => a.conn.reducers.setReady({ sessionId: 999_999_999n, ready: true })),
    true
  ),
  check(
    'H14',
    'an unknown template is rejected rather than stored',
    await rejects(() => a.conn.reducers.createEvent({ templateId: HUGE, params: [] })),
    true
  ),
  check(
    'H15',
    'an oversized message is rejected',
    await rejects(() => a.conn.reducers.sendMessage({ text: HUGE })),
    true
  ),
  check(
    'H16',
    'an unknown profile cannot be seeded',
    await rejects(() => a.conn.reducers.seedMockData({ profileId: 'not-a-profile' })),
    true
  ),
  check(
    'H17',
    'an empty name is rejected, since a blank avatar is worse than a clipped one',
    await rejects(() => a.conn.reducers.setDisplayName({ displayName: '   ' })),
    true
  )
);

// --- A flood of event parameters must not reach the engine as-is ---
// `parseParams` validates meaning, not volume; the entry cap is what keeps a
// thousand-entry array from becoming its problem.
const manyParams = Array.from({ length: 500 }, (_, i) => ({ key: `k${i}`, value: String(i) }));
checks.push(
  check(
    'H18',
    'hundreds of event parameters are rejected for their content, not accepted wholesale',
    await rejects(() => a.conn.reducers.createEvent({ templateId: 'baby', params: manyParams })),
    true
  )
);

const ok = printTable('V4 Data flow — Stage 2 (household, inference, onboarding)', checks);
a.conn.disconnect();
b.conn.disconnect();
finish(ok);
