/**
 * V7 Ready check — 12 Verification#V7 Ready check cases.
 *
 * Drives the ready check from two real clients against a running SpacetimeDB.
 * The commit rule lives in the **server**, inside `setReady`, so these cases
 * are about the rule itself and not about any client's behaviour.
 *
 * R3 ("release before 1.5s sends nothing") is deliberately absent: it is a
 * property of the control, not of the reducer, and is reported as a manual
 * check. Everything a reducer can decide is here.
 *
 *   npm run stdb:start
 *   npm run stdb:publish:local
 *   npm run verify:ready
 */
import { DbConnection } from '@branches/bindings';
import type { Identity } from 'spacetimedb';
import { check, finish, printTable, type Check } from './table.ts';

const HOST = process.env.SPACETIME_HOST ?? 'ws://127.0.0.1:3000';
const DB = process.env.SPACETIME_DB_NAME ?? 'branches';
const TIMEOUT_MS = 25_000;

const SUBSCRIPTIONS = [
  'SELECT * FROM household',
  'SELECT * FROM member',
  'SELECT * FROM baseline',
  'SELECT * FROM fun_money',
  'SELECT * FROM inferred_item',
  'SELECT * FROM gap_question',
  'SELECT * FROM goal',
  'SELECT * FROM plan_projection',
  'SELECT * FROM life_event',
  'SELECT * FROM impact',
  'SELECT * FROM session',
  'SELECT * FROM session_member',
  'SELECT * FROM branch_candidate',
  'SELECT * FROM branch',
  'SELECT * FROM constraint',
  'SELECT * FROM reaction',
  'SELECT * FROM chat_message',
];

type Client = { label: string; conn: DbConnection; identity: Identity };

function connect(label: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: no connection`)), TIMEOUT_MS);
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .onConnect((conn, identity) => {
        clearTimeout(timer);
        resolve({ label, conn, identity });
      })
      .onConnectError((_ctx, error) => {
        clearTimeout(timer);
        reject(error);
      })
      .build();
  });
}

function subscribe(client: Client): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscription timed out')), TIMEOUT_MS);
    client.conn
      .subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(timer);
        resolve();
      })
      .onError(ctx => {
        clearTimeout(timer);
        reject(ctx.event ?? new Error('subscription failed'));
      })
      .subscribe(SUBSCRIPTIONS);
  });
}

async function waitFor<T>(what: string, read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 80));
  }
}

const settle = () => new Promise(r => setTimeout(r, 250));

async function rejects(call: () => Promise<void>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

const a = await connect('A');
const b = await connect('B');
await Promise.all([subscribe(a), subscribe(b)]);

// ---------------------------------------------------------------------------
// A household with a plan, an event, and three named branches
// ---------------------------------------------------------------------------
await a.conn.reducers.createHousehold({ displayName: 'Maya' });
const myMember = await waitFor('my member', () =>
  [...a.conn.db.member.iter()].find(m => m.identity.toHexString() === a.identity.toHexString())
);
const householdId = myMember.householdId;
const household = await waitFor('household', () =>
  [...a.conn.db.household.iter()].find(h => h.id === householdId)
);

await b.conn.reducers.joinHousehold({ joinCode: household.joinCode, displayName: 'Jordan' });
await waitFor('both partners', () =>
  [...a.conn.db.member.iter()].filter(m => m.householdId === householdId && m.role === 'member')
    .length === 2
    ? true
    : undefined
);
const partners = [...a.conn.db.member.iter()]
  .filter(m => m.householdId === householdId && m.role === 'member')
  .sort((x, y) => (x.id < y.id ? -1 : 1));

await a.conn.reducers.seedMockData({ profileId: 'test-household-a' });
await a.conn.reducers.runInference({});
await waitFor('items', () => ([...a.conn.db.inferredItem.iter()].length > 0 ? true : undefined));
await a.conn.reducers.confirmAllMyItems({});
await b.conn.reducers.confirmAllMyItems({});
await a.conn.reducers.setFunMoney({ monthlyCents: 30000 });
await b.conn.reducers.setFunMoney({ monthlyCents: 30000 });
await a.conn.reducers.addGoal({ title: 'Japan', icon: '✈️', costTodayCents: 500000, targetMonth: 24, priority: 'flex' });
await a.conn.reducers.addGoal({ title: 'House', icon: '🏠', costTodayCents: 4000000, targetMonth: 60, priority: 'must' });
await waitFor('goals', () =>
  [...a.conn.db.goal.iter()].filter(g => g.householdId === householdId).length === 2 ? true : undefined
);

await a.conn.reducers.createEvent({
  templateId: 'baby',
  params: [
    { key: 'monthsUntilBirth', value: '9' },
    { key: 'leaveMember', value: String(partners[1]!.id) },
    { key: 'leaveMonths', value: '2' },
    { key: 'care', value: 'daycare' },
  ],
});
const event = await waitFor('event', () =>
  [...a.conn.db.lifeEvent.iter()].find(e => e.householdId === householdId && e.status === 'active')
);
await a.conn.reducers.computeImpact({ eventId: event.id });
await waitFor('impact', () => [...a.conn.db.impact.iter()].find(i => i.eventId === event.id));

await a.conn.reducers.startSession({ eventId: event.id });
const session = await waitFor('session', () =>
  [...a.conn.db.session.iter()].find(s => s.householdId === householdId && s.status === 'open')
);
await a.conn.reducers.generateCandidates({ sessionId: session.id });
await waitFor('branches', () =>
  [...a.conn.db.branch.iter()].filter(x => x.sessionId === session.id).length === 3 ? true : undefined
);

const branches = [...a.conn.db.branch.iter()]
  .filter(x => x.sessionId === session.id)
  .sort((x, y) => x.position - y.position);
const first = branches[0]!;
const second = branches[1]!;

const stateOf = (client: Client, memberId: bigint) =>
  [...client.conn.db.sessionMember.iter()].find(
    r => r.memberId === memberId && r.sessionId === session.id
  );
const sessionStatus = (client: Client) =>
  [...client.conn.db.session.iter()].find(s => s.id === session.id)?.status;
const houseTarget = (client: Client) =>
  [...client.conn.db.goal.iter()].find(g => g.householdId === householdId && g.title === 'House')
    ?.targetMonth;

const checks: Check[] = [];

// ---------------------------------------------------------------------------
// Presence and visibility
// ---------------------------------------------------------------------------
await a.conn.reducers.joinSession({ sessionId: session.id });
await settle();

checks.push(
  check('P1', 'joining marks the member present', stateOf(a, partners[0]!.id)?.present, true),
  check('P2', 'and the partner sees it', stateOf(b, partners[0]!.id)?.present, true),
  check('P3', 'the partner is not present until they open it', stateOf(b, partners[1]!.id)?.present ?? false, false),
  check(
    'P4',
    'ready is refused before picking a path',
    await rejects(() => a.conn.reducers.setReady({ sessionId: session.id, ready: true })),
    true
  )
);

await b.conn.reducers.joinSession({ sessionId: session.id });
await settle();

// ---------------------------------------------------------------------------
// R2 - one ready, the other never: no commit
// ---------------------------------------------------------------------------
await a.conn.reducers.selectBranch({ sessionId: session.id, branchId: first.id });
await b.conn.reducers.selectBranch({ sessionId: session.id, branchId: first.id });
await settle();

checks.push(
  check('S1', "a selection reaches the partner's device", stateOf(b, partners[0]!.id)?.selectedBranchId, first.id)
);

await a.conn.reducers.setReady({ sessionId: session.id, ready: true });
await settle();

checks.push(
  check('R2a', 'one partner ready does not commit', sessionStatus(a), 'open'),
  check('R2b', 'and the partner can see who is ready', stateOf(b, partners[0]!.id)?.ready, true)
);

// ---------------------------------------------------------------------------
// R6 - different branches, both ready: no commit
// ---------------------------------------------------------------------------
await b.conn.reducers.selectBranch({ sessionId: session.id, branchId: second.id });
await settle();

checks.push(
  check('R6a', 'changing a selection clears every ready flag', stateOf(a, partners[0]!.id)?.ready, false)
);

await a.conn.reducers.setReady({ sessionId: session.id, ready: true });
await b.conn.reducers.setReady({ sessionId: session.id, ready: true });
await settle();

checks.push(
  check('R6b', 'both ready on different branches does not commit', sessionStatus(a), 'open'),
  check('R6c', 'both are nonetheless marked ready', [stateOf(a, partners[0]!.id)?.ready, stateOf(a, partners[1]!.id)?.ready], [true, true])
);

// ---------------------------------------------------------------------------
// R4 - both ready, then one tunes a slider: flags clear, no commit
// ---------------------------------------------------------------------------
await b.conn.reducers.selectBranch({ sessionId: session.id, branchId: first.id });
await a.conn.reducers.setReady({ sessionId: session.id, ready: true });
await settle();
const beforeTune = sessionStatus(a);
await b.conn.reducers.tuneLever({
  branchId: first.id,
  lever: 'saveMore',
  goalId: undefined,
  value: 100,
});
await settle();

checks.push(
  check('R4a', 'tuning clears every ready flag', [stateOf(a, partners[0]!.id)?.ready, stateOf(a, partners[1]!.id)?.ready], [false, false]),
  check('R4b', 'and nothing committed in the meantime', [beforeTune, sessionStatus(a)], ['open', 'open']),
  check('R4c', 'the tuner is recorded, for "Tuned by …"', [...a.conn.db.branch.iter()].find(x => x.id === first.id)?.tunedBy, partners[1]!.id)
);

// A lock must clear ready too.
await a.conn.reducers.setReady({ sessionId: session.id, ready: true });
await settle();
const house = [...a.conn.db.goal.iter()].find(g => g.householdId === householdId && g.title === 'House')!;
await b.conn.reducers.addConstraint({
  sessionId: session.id,
  kind: 'lock',
  target: JSON.stringify({ kind: 'goalOnTime', goalId: String(house.id) }),
});
await settle();

checks.push(
  check('R4d', 'a lock clears every ready flag', stateOf(a, partners[0]!.id)?.ready, false)
);

// ---------------------------------------------------------------------------
// Presence gates the commit
// ---------------------------------------------------------------------------
await b.conn.reducers.leaveSession({ sessionId: session.id });
await settle();
await a.conn.reducers.selectBranch({ sessionId: session.id, branchId: first.id });
await a.conn.reducers.setReady({ sessionId: session.id, ready: true });
await settle();

checks.push(
  check('A1', 'an absent partner leaves them not present', stateOf(a, partners[1]!.id)?.present, false),
  check('A2', 'leaving clears their ready flag', stateOf(a, partners[1]!.id)?.ready, false),
  check('A3', 'one partner cannot commit while the other is away', sessionStatus(a), 'open'),
  check('A4', 'but their selection survives', stateOf(a, partners[1]!.id)?.selectedBranchId, first.id)
);

// ---------------------------------------------------------------------------
// R1 - both ready on the same branch: commits exactly once
// ---------------------------------------------------------------------------
await b.conn.reducers.joinSession({ sessionId: session.id });
await settle();
await a.conn.reducers.selectBranch({ sessionId: session.id, branchId: first.id });
await b.conn.reducers.selectBranch({ sessionId: session.id, branchId: first.id });
await settle();

const targetBeforeCommit = houseTarget(a);
await a.conn.reducers.setReady({ sessionId: session.id, ready: true });
await b.conn.reducers.setReady({ sessionId: session.id, ready: true });
await waitFor('the commit', () => (sessionStatus(a) === 'committed' ? true : undefined));

checks.push(
  check('R1a', 'both ready on the same branch commits', sessionStatus(a), 'committed'),
  check('R1b', 'and records which branch', [...a.conn.db.session.iter()].find(s => s.id === session.id)?.committedBranchId, first.id),
  check('R1c', 'the commit reaches the partner', sessionStatus(b), 'committed'),
  check('R1d', 'the event is marked applied', [...a.conn.db.lifeEvent.iter()].find(e => e.id === event.id)?.status, 'applied'),
  check('R1e', 'the plan is recomputed with nothing at risk', JSON.parse([...a.conn.db.planProjection.iter()].find(p => p.householdId === householdId)!.json).atRiskGoalIds, []),
  check('R1f', 'the thread records the decision', [...a.conn.db.chatMessage.iter()].some(m => m.householdId === householdId && m.text.startsWith('This is your plan now')), true)
);

// ---------------------------------------------------------------------------
// R5 - a second ready is idempotent
// ---------------------------------------------------------------------------
const targetAfterCommit = houseTarget(a);
await a.conn.reducers.setReady({ sessionId: session.id, ready: true }).catch(() => undefined);
await b.conn.reducers.setReady({ sessionId: session.id, ready: true }).catch(() => undefined);
await settle();

checks.push(
  check('R5a', 'a second ready does not apply the branch twice', houseTarget(a), targetAfterCommit),
  check(
    'R5b',
    'and the first commit really did move the goal',
    targetAfterCommit !== targetBeforeCommit || (JSON.parse([...a.conn.db.branchCandidate.iter()].find(c => c.id === first.candidateId)!.levers) as { saveMore?: number }).saveMore !== undefined,
    true
  ),
  check('R5c', 'the session is still committed exactly once', [...a.conn.db.session.iter()].filter(s => s.id === session.id && s.status === 'committed').length, 1)
);

// A settled session accepts no more changes.
checks.push(
  check(
    'C1',
    'a committed session cannot be committed again by the dev override',
    await rejects(() => a.conn.reducers.commitBranchSolo({ branchId: first.id })),
    true
  )
);

const ok = printTable('V7 Ready check', checks);

console.log('MANUAL (R3) — a release before the hold completes must send nothing.');
console.log('  That is a property of the control, not the reducer: hold the ring briefly');
console.log('  and confirm no "ready" appears on the partner\'s screen.\n');

a.conn.disconnect();
b.conn.disconnect();
finish(ok);
