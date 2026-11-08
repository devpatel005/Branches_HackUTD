/**
 * V5 end to end — the **real** agent service, over the real bus.
 *
 * `verify:agent` checks the contract in isolation. This drives the whole thing:
 * a household in the database, the service registered as the `agent` member,
 * a job queued by `sendMessage`, claimed, worked, and written back — with the
 * bundled mock standing in for the model so no API key is needed.
 *
 * It also proves the two rules that matter most are structural:
 *   - a human cannot call an agent-only reducer;
 *   - the agent cannot change the plan.
 *
 * Needs a published module, the mock, and the service:
 *   npm run stdb:start
 *   npm run stdb:publish:local
 *   npm run agent:mock
 *   AGENT_BASE_URL=http://127.0.0.1:8099/v1 npm run agent
 *   npm run verify:agent:e2e
 */
import { DbConnection, reducers } from '@branches/bindings';
import type { Identity } from 'spacetimedb';
import { check, printTable, type Check } from './table.ts';

const HOST = process.env.SPACETIME_HOST ?? 'ws://127.0.0.1:3000';
const DB = process.env.SPACETIME_DB_NAME ?? 'branches';
const TIMEOUT_MS = 30_000;

const SUBSCRIPTIONS = [
  'SELECT * FROM household',
  'SELECT * FROM member',
  'SELECT * FROM baseline',
  'SELECT * FROM goal',
  'SELECT * FROM fun_money',
  'SELECT * FROM inferred_item',
  'SELECT * FROM gap_question',
  'SELECT * FROM plan_projection',
  'SELECT * FROM life_event',
  'SELECT * FROM impact',
  'SELECT * FROM chat_message',
  'SELECT * FROM session',
  'SELECT * FROM branch_candidate',
  'SELECT * FROM branch',
  'SELECT * FROM constraint',
  'SELECT * FROM agent_job',
];

type Client = { conn: DbConnection; identity: Identity };

function connect(label: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: no connection`)), TIMEOUT_MS);
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .onConnect((conn, identity) => {
        clearTimeout(timer);
        resolve({ conn, identity });
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

async function waitFor<T>(what: string, read: () => T | undefined, ms = TIMEOUT_MS): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

async function rejects(call: () => Promise<void>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

const checks: Check[] = [];

// Two partners and a household, so the agent has something to serve.
const a = await connect('A');
const b = await connect('B');
await Promise.all([subscribe(a), subscribe(b)]);

await a.conn.reducers.createHousehold({ displayName: 'Maya' });
const myMember = await waitFor('my member', () =>
  [...a.conn.db.member.iter()].find(m => m.identity.toHexString() === a.identity.toHexString())
);
const household = await waitFor('household', () =>
  [...a.conn.db.household.iter()].find(h => h.id === myMember.householdId)
);
const householdId = household.id;

await b.conn.reducers.joinHousehold({ joinCode: household.joinCode, displayName: 'Jordan' });
await waitFor('both members', () =>
  [...a.conn.db.member.iter()].filter(m => m.householdId === householdId && m.role === 'member')
    .length === 2
    ? true
    : undefined
);

await a.conn.reducers.seedMockData({ profileId: 'test-household-a' });
await a.conn.reducers.runInference({});
await waitFor('items', () => ([...a.conn.db.inferredItem.iter()].length > 0 ? true : undefined));
await a.conn.reducers.confirmAllMyItems({});
await b.conn.reducers.confirmAllMyItems({});
await a.conn.reducers.setFunMoney({ monthlyCents: 30000 });
await b.conn.reducers.setFunMoney({ monthlyCents: 30000 });
await a.conn.reducers.addGoal({
  title: 'Japan',
  icon: '✈️',
  costTodayCents: 500000,
  targetMonth: 24,
  priority: 'flex',
});
await a.conn.reducers.addGoal({
  title: 'House',
  icon: '🏠',
  costTodayCents: 4000000,
  targetMonth: 60,
  priority: 'must',
});
await waitFor('goals', () =>
  [...a.conn.db.goal.iter()].filter(g => g.householdId === householdId).length === 2
    ? true
    : undefined
);

// ======================================================================
// The role checks — structural, not conventional
// ======================================================================
checks.push(
  check(
    'R1',
    'a human cannot claim the agent role without the secret',
    await rejects(() => a.conn.reducers.registerAgent({ joinCode: household.joinCode, secret: 'guess' })),
    true
  ),
  check(
    'R2',
    'a human cannot post as the agent',
    await rejects(() => a.conn.reducers.postAgentMessage({ text: 'hi', chips: [], refId: undefined })),
    true
  ),
  check(
    'R3',
    'a human cannot complete a job',
    await rejects(() => a.conn.reducers.completeJob({ jobId: 1n, result: '{}', modelUsed: 'x' })),
    true
  ),
  check(
    'R4',
    'a human cannot name branches directly',
    await rejects(() => a.conn.reducers.nameBranches({ sessionId: 1n, picks: [] })),
    true
  )
);

// ======================================================================
// The service must be running for the rest
// ======================================================================
const agentMember = await waitFor(
  'the agent service to register (is it running?)',
  () =>
    [...a.conn.db.member.iter()].find(m => m.householdId === householdId && m.role === 'agent'),
  40_000
);

checks.push(
  check('E1', 'the agent registered as a member of the household', agentMember.role, 'agent'),
  check('E2', 'with its own display name', agentMember.displayName, 'Branches'),
  check('E3', 'and the agent colour key', agentMember.colorKey, 'agent')
);

// ======================================================================
// A sentence becomes an event, follow-ups and an impact
// ======================================================================
await a.conn.reducers.sendMessage({ text: 'We just found out we are pregnant!' });

const job = await waitFor('a job to be queued', () =>
  [...a.conn.db.agentJob.iter()].find(j => j.householdId === householdId)
);
const finished = await waitFor('the job to finish', () => {
  const current = [...a.conn.db.agentJob.iter()].find(j => j.id === job.id);
  return current && (current.status === 'done' || current.status === 'failed') ? current : undefined;
});

const event = await waitFor('the agent to create an event', () =>
  [...a.conn.db.lifeEvent.iter()].find(e => e.householdId === householdId)
);
const agentMessage = await waitFor('the agent to ask a follow-up', () =>
  [...a.conn.db.chatMessage.iter()]
    .filter(m => m.householdId === householdId && m.authorMemberId === agentMember.id)
    .sort((x, y) => (x.id < y.id ? 1 : -1))[0]
);

checks.push(
  check('E4', 'the job completed', finished.status, 'done'),
  check('E5', 'and recorded which model answered', finished.modelUsed.length > 0, true),
  check('E6', 'the agent classified it as a baby', event.templateId, 'baby'),
  check('E7', 'and left it a draft while follow-ups are outstanding', event.status, 'draft'),
  check('E8', 'the agent is the author of the follow-up', agentMessage.authorMemberId, agentMember.id),
  check('E9', 'and it offers tap-able chips', agentMessage.chips.length > 0, true),
  check('E10', 'the follow-up reaches the partner too', [...b.conn.db.chatMessage.iter()].some(m => m.id === agentMessage.id), true),
  check('E11', 'the question uses no advice language', /\bshould\b|\brecommend\b|best option/i.test(agentMessage.text), false)
);

// Answering the chips completes the event, and the impact can be computed.
await a.conn.reducers.answerEventParam({ eventId: event.id, key: 'leaveMonths', value: '2' });
await a.conn.reducers.answerEventParam({ eventId: event.id, key: 'care', value: 'daycare' });
await a.conn.reducers.answerEventParam({
  eventId: event.id,
  key: 'leaveMember',
  value: String([...a.conn.db.member.iter()].filter(m => m.householdId === householdId && m.role === 'member').sort((x, y) => (x.id < y.id ? 1 : -1))[0]!.id),
});
await a.conn.reducers.computeImpact({ eventId: event.id });

const impactRow = await waitFor('the impact', () =>
  [...a.conn.db.impact.iter()].find(i => i.eventId === event.id)
);
const impact = JSON.parse(impactRow.json) as {
  newlyAtRiskGoalIds: string[];
  shortfallsByGoalId: Record<string, number>;
};
// Scoped to this run's household: `goal` has no row-level security and a dev
// database accumulates households, so an unscoped lookup finds a leftover
// Japan from an earlier run and asserts against the wrong plan.
const japan = [...a.conn.db.goal.iter()].find(
  g => g.householdId === householdId && g.title === 'Japan'
)!;

checks.push(
  check('E12', 'the engine finds Japan at risk, from an agent-created event', impact.newlyAtRiskGoalIds, [String(japan.id)]),
  check('E13', 'with the golden shortfall', impact.shortfallsByGoalId[String(japan.id)], 2183.97)
);

// ======================================================================
// The agent names branches, but cannot invent one
// ======================================================================
await a.conn.reducers.startSession({ eventId: event.id });
const session = await waitFor('session', () =>
  [...a.conn.db.session.iter()].find(s => s.householdId === householdId && s.status === 'open')
);
await a.conn.reducers.generateCandidates({ sessionId: session.id });
await waitFor('template-named branches', () =>
  [...a.conn.db.branch.iter()].filter(x => x.sessionId === session.id).length === 3
    ? true
    : undefined
);
const templateNames = [...a.conn.db.branch.iter()]
  .filter(x => x.sessionId === session.id)
  .map(x => x.name);

await a.conn.reducers.requestBranchNaming({ sessionId: session.id });
const namedByAgent = await waitFor('the agent to rename them', () => {
  const branches = [...a.conn.db.branch.iter()].filter(x => x.sessionId === session.id);
  return branches.length === 3 && branches.every(x => x.nameSource === 'agent')
    ? branches
    : undefined;
}, 40_000);

checks.push(
  check('N1', 'the agent named all three branches', namedByAgent.length, 3),
  check('N2', 'and they are marked as agent-named', namedByAgent.every(x => x.nameSource === 'agent'), true),
  check('N3', 'the names actually changed from the templates', namedByAgent.map(x => x.name).join() !== templateNames.join(), true),
  check('N4', 'no name exceeds 30 characters', namedByAgent.every(x => x.name.length <= 30), true),
  check('N5', 'no summary exceeds 200 characters', namedByAgent.every(x => x.summary.length <= 200), true),
  check('N6', 'no name or summary uses advice language', namedByAgent.every(x => !/\bshould\b|\brecommend\b|best option/i.test(`${x.name} ${x.summary}`)), true),
  check(
    'N7',
    'every named branch still points at a real engine candidate',
    namedByAgent.every(x => [...a.conn.db.branchCandidate.iter()].some(c => c.id === x.candidateId)),
    true
  )
);

// ======================================================================
// The agent proposes; humans decide
// ======================================================================
checks.push(
  check(
    'D1',
    'the committed plan is unchanged by anything the agent did',
    JSON.parse([...a.conn.db.planProjection.iter()].find(p => p.householdId === householdId)!.json).atRiskGoalIds,
    []
  ),
  check('D2', 'no session has been committed', session.committedBranchId, undefined),
  check('D3', 'the event is not applied', [...a.conn.db.lifeEvent.iter()].find(e => e.id === event.id)?.status, 'active')
);

const ok = printTable('V5 Agent, end to end (real service, mock model)', checks);
a.conn.disconnect();
b.conn.disconnect();
process.exit(ok ? 0 : 1);
