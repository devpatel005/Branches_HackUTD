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
  check('P9', 'each partner has exactly one gap question', [rows.gaps(a).length, rows.gaps(b).length], [1, 1]),
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

// Both brokerage transfers are retirement, per the fixture's onboarding answers.
await a.conn.reducers.answerGap({ questionId: rows.gaps(a)[0]!.id, answer: 'Retirement' });
await b.conn.reducers.answerGap({ questionId: rows.gaps(b)[0]!.id, answer: 'Retirement' });
await waitFor('gaps answered', () =>
  rows.gaps(a)[0]?.answer !== undefined ? true : undefined
);

checks.push(
  check('G1', 'answering "Retirement" asks no follow-up', rows.gaps(a).length, 1),
  check('G2', 'the item stays classified as retirement', rows.items(a).find(i => i.label === 'Harborview Investments')?.kind, 'retirement'),
  check('G3', 'an answer outside the options is rejected', await rejects(() => a.conn.reducers.answerGap({ questionId: rows.gaps(a)[0]!.id, answer: 'Something else' })), true),
  check("G4", "a member cannot answer the partner's question", await rejects(() => a.conn.reducers.answerGap({ questionId: rows.gaps(b)[0]!.id, answer: 'Retirement' })), true),
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
  check('B6', 'liquid savings seeded', baseline.liquidSavingsCents, 1500000)
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
// 8. Reseed keeps the pairing
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
  check('R7', 'reseed returns the household to un-onboarded', [...a.conn.db.household.iter()].find(h => h.id === household.id)?.onboarded, false)
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
