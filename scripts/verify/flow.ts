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
import { check, printTable, type Check } from './table.ts';

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
      .onError((_ctx, error) => {
        clearTimeout(timer);
        reject(error);
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
  rows.members(a).filter(m => m.householdId === household.id).length === 2 ? true : undefined
);

const householdMembers = rows
  .members(a)
  .filter(m => m.householdId === household.id)
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
await a.conn.reducers.runInference();

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
await a.conn.reducers.confirmAllMyItems();
await b.conn.reducers.confirmAllMyItems();
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
// 9. Reseed keeps the pairing
// ======================================================================
await a.conn.reducers.finishOnboarding();
await waitFor('onboarded', () =>
  [...a.conn.db.household.iter()].find(h => h.id === household.id)?.onboarded ? true : undefined
);

await a.conn.reducers.reseedHousehold();
await waitFor('reseed clears items', () => (rows.items(a).length === 0 ? true : undefined));

checks.push(
  check('R1', 'reseed clears inferred items', rows.items(a).length, 0),
  check('R2', 'reseed clears gap questions', rows.gaps(a).length, 0),
  check('R3', 'reseed clears fun money', rows.funMoney(a).filter(f => f.householdId === household.id).length, 0),
  check('R4', 'reseed keeps both members paired', rows.members(a).filter(m => m.householdId === household.id).length, 2),
  check('R5', 'reseed keeps the join code', [...a.conn.db.household.iter()].find(h => h.id === household.id)?.joinCode, household.joinCode),
  check('R6', 'reseed keeps the transactions, so inference can re-run', rows.transactions(a).length > 0, true),
  check('R7', 'reseed returns the household to un-onboarded', [...a.conn.db.household.iter()].find(h => h.id === household.id)?.onboarded, false),
  check('R8', 'reseed clears goals', mine.goals(a).length, 0)
);

/** True when a reducer call is rejected, which is what we want to assert. */
async function rejects(call: () => Promise<void>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

const ok = printTable('V4 Data flow — Stage 2 (household, inference, onboarding)', checks);
a.conn.disconnect();
b.conn.disconnect();
process.exit(ok ? 0 : 1);
