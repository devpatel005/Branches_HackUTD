import { DbConnection, tables, reducers } from '@branches/bindings';
import type { Identity } from 'spacetimedb';
import { fallbackFor } from './fallbacks.ts';
import { tiersFromEnv, type Tier } from './providers.ts';
import { runTask } from './tasks.ts';
import {
  checkAffordabilityTool,
  classifyLifeEventTool,
  selectBranchesTool,
  setConstraintsTool,
} from './tools.ts';
import {
  checkAffordabilitySchema,
  classifyLifeEventSchema,
  selectBranchesSchema,
  setConstraintsSchema,
  validatePicks,
  validateText,
} from './validate.ts';
import type { AgentContextInput } from './context.ts';

/**
 * The agent service — 04 Architecture#Message bus pattern.
 *
 * An ordinary SpacetimeDB client with no public URL: it subscribes to queued
 * `agent_job` rows, claims one at a time, writes progress as it works, and
 * writes results back through agent-only reducers. That is why it can run on a
 * laptop during the demo, and why both partners see "Thinking…" at once.
 *
 *   npm run -w @branches/agent mock      # terminal 1, no API key needed
 *   AGENT_BASE_URL=http://127.0.0.1:8099/v1 npm run agent
 */

const HOST = process.env.SPACETIME_HOST ?? 'ws://127.0.0.1:3000';
const DB = process.env.SPACETIME_DB_NAME ?? 'branches';
const JOIN_CODE = process.env.AGENT_JOIN_CODE ?? '';
const SECRET = process.env.AGENT_SECRET ?? 'branches-dev-agent-secret';
const POLL_MS = Number(process.env.AGENT_POLL_MS ?? 400);
/**
 * Pause between branch cards so they are visibly sequential.
 *
 * Without it the three writes land within milliseconds and the effect is lost —
 * the point is that the couple watches the options appear.
 */
const CARD_STAGGER_MS = Number(process.env.AGENT_CARD_STAGGER_MS ?? 450);

const SUBSCRIPTIONS = [
  'SELECT * FROM household',
  'SELECT * FROM member',
  'SELECT * FROM baseline',
  'SELECT * FROM fun_money',
  'SELECT * FROM goal',
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

const tiers = tiersFromEnv();

function log(...parts: unknown[]): void {
  console.log(new Date().toISOString().slice(11, 19), ...parts);
}

async function main(): Promise<void> {
  if (tiers.length === 0) {
    console.error(
      'No model tier is configured. Set AGENT_API_KEY (or NVIDIA_API_KEY), or point\n' +
        'AGENT_BASE_URL at the bundled mock:\n' +
        '  npm run -w @branches/agent mock\n' +
        '  AGENT_BASE_URL=http://127.0.0.1:8099/v1 npm run agent'
    );
    process.exit(1);
  }
  log(`tiers: ${tiers.map(t => `${t.tier}:${t.label}/${t.model}`).join(', ')}`);

  const { conn, identity } = await connect();
  log(`connected as ${identity.toHexString().slice(0, 12)}…`);
  await subscribe(conn);

  // Claim the agent role. Without the shared secret the module refuses, which
  // is what keeps "the agent proposes; humans decide" from being decorative.
  await register(conn);

  // One job at a time per household (07 Agent Spec#Job flow). A simple poll
  // over the subscribed rows is enough and avoids racing the claim.
  for (;;) {
    // Follow a household created after start-up. `register` is a no-op unless
    // the target is strictly newer, so this neither hops nor re-registers.
    await register(conn);

    const job = nextQueuedJob(conn, identity);
    if (job) {
      try {
        await handleJob(conn, job);
      } catch (error) {
        log('job failed unexpectedly:', error instanceof Error ? error.message : error);
        try {
          await conn.reducers.failJob({
            jobId: job.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        } catch {
          /* the job row may have gone */
        }
      }
    }
    await sleep(POLL_MS);
  }
}

/** The household this service is currently registered for. */
let currentlyServing: { id: bigint; joinCode: string } | undefined;

/** Register for the household we should be serving. */
async function register(conn: Conn): Promise<void> {
  const target = JOIN_CODE
    ? [...conn.db.household.iter()].find(h => h.joinCode === JOIN_CODE)
    : householdToServe(conn);

  if (!target) {
    if (!currentlyServing) log('no household to serve yet; waiting for one');
    return;
  }
  if (currentlyServing && target.id <= currentlyServing.id) return;

  try {
    await conn.reducers.registerAgent({ joinCode: target.joinCode, secret: SECRET });
    currentlyServing = { id: target.id, joinCode: target.joinCode };
    log(`serving household ${target.joinCode}`);
  } catch (error) {
    log('could not register:', error instanceof Error ? error.message : error);
  }
}

type Conn = DbConnection;
type JobRow = ReturnType<typeof allJobs>[number];

const allJobs = (conn: Conn) => [...conn.db.agentJob.iter()];

/**
 * Our own household, found by identity.
 *
 * Matching on `role === 'agent'` alone would pick up an agent row left behind
 * by a previous service instance and make us work another household's jobs.
 */
function myHouseholdId(conn: Conn, identity: Identity): bigint | undefined {
  const hex = identity.toHexString();
  return [...conn.db.member.iter()].find(
    m => m.role === 'agent' && m.identity.toHexString() === hex
  )?.householdId;
}

function nextQueuedJob(conn: Conn, identity: Identity): JobRow | undefined {
  const householdId = myHouseholdId(conn, identity);
  if (householdId === undefined) return undefined;
  const jobs = allJobs(conn).filter(j => j.householdId === householdId);
  // Never claim while one is running: the module rejects it anyway, and
  // ordering matters for a conversation.
  if (jobs.some(j => j.status === 'running')) return undefined;
  return jobs.filter(j => j.status === 'queued').sort((a, b) => (a.id < b.id ? -1 : 1))[0];
}

/**
 * Which household to serve when `AGENT_JOIN_CODE` is not set.
 *
 * The **newest** household, full stop — not "the newest without an agent".
 *
 * Both of the obvious rules are wrong in practice. Taking the *first* row serves
 * the oldest leftover, because a development database accumulates households
 * across runs. Taking the newest *without* an agent makes the service hop
 * forever: the moment it registers somewhere, that household has an agent, so
 * the next leftover becomes the target.
 *
 * Newest-overall is stable, and `currentlyServing` below only ever moves to
 * something strictly newer, so a household created after start-up is picked up
 * exactly once.
 */
function householdToServe(conn: Conn): { id: bigint; joinCode: string } | undefined {
  return [...conn.db.household.iter()].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
}

/** Everything the allowlist permits, assembled from the subscribed rows. */
function contextFor(conn: Conn, householdId: bigint, engineData?: unknown): AgentContextInput {
  const members = [...conn.db.member.iter()]
    .filter(m => m.householdId === householdId && m.role === 'member')
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(m => ({ id: String(m.id), displayName: m.displayName, colorKey: m.colorKey }));

  const baselineRow = [...conn.db.baseline.iter()].find(b => b.householdId === householdId);
  const household = [...conn.db.household.iter()].find(h => h.id === householdId);
  const projectionRow = [...conn.db.planProjection.iter()].find(p => p.householdId === householdId);
  const projection = projectionRow
    ? (JSON.parse(projectionRow.json) as {
        goals: { id: string; funded: boolean; requiredMonthlyAtStart: number }[];
      })
    : undefined;

  const goals = [...conn.db.goal.iter()]
    .filter(g => g.householdId === householdId && g.status === 'active')
    .sort((a, b) => a.targetMonth - b.targetMonth)
    .map(g => {
      const result = projection?.goals.find(x => x.id === String(g.id));
      return {
        id: String(g.id),
        title: g.title,
        costToday: g.costTodayCents / 100,
        targetMonth: g.targetMonth,
        targetLabel: monthLabel(household?.currentMonth ?? '2026-01', g.targetMonth),
        priority: g.priority,
        funded: result?.funded,
        requiredMonthly: result?.requiredMonthlyAtStart,
      };
    });

  // Amounts only — a fun-money *status* or purchase must never reach a model
  // (02 Ground Rules #3).
  const funMoneyByMember: Record<string, number> = {};
  for (const row of [...conn.db.funMoney.iter()].filter(f => f.householdId === householdId)) {
    funMoneyByMember[String(row.memberId)] = row.monthlyCents / 100;
  }

  const recentMessages = [...conn.db.chatMessage.iter()]
    .filter(m => m.householdId === householdId && (m.kind === 'text' || m.kind === 'system'))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(-8)
    .map(m => ({
      author:
        m.authorMemberId === undefined
          ? 'Branches'
          : members.find(x => x.id === String(m.authorMemberId))?.displayName ?? 'Branches',
      text: m.text,
    }));

  return {
    members,
    baseline: baselineRow
      ? {
          incomeByMember: Object.fromEntries(
            baselineRow.incomeByMember.map(e => [String(e.memberId), e.cents / 100])
          ),
          fixed: baselineRow.fixedCents / 100,
          debt: baselineRow.debtCents / 100,
          flexible: baselineRow.flexibleCents / 100,
          retirement: baselineRow.retirementCents / 100,
          liquidSavings: baselineRow.liquidSavingsCents / 100,
        }
      : undefined,
    funMoneyByMember,
    goals,
    engineData,
    recentMessages,
  };
}

function monthLabel(currentMonth: string, planMonth: number): string {
  const [yearStr, monthStr] = currentMonth.split('-');
  const index = Number(yearStr) * 12 + (Number(monthStr) - 1) + planMonth;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[((index % 12) + 12) % 12]} ${Math.floor(index / 12)}`;
}

async function handleJob(conn: Conn, job: JobRow): Promise<void> {
  log(`claiming job ${job.id} (${job.kind})`);
  await conn.reducers.claimJob({ jobId: job.id });

  const progress = async (text: string) => {
    try {
      await conn.reducers.setJobProgress({ jobId: job.id, progressText: text });
    } catch {
      /* progress is best-effort */
    }
  };

  const input = JSON.parse(job.input) as Record<string, unknown>;

  switch (job.kind) {
    case 'interpret_event':
      await interpretEvent(conn, job, input, progress);
      break;
    case 'select_branches':
      await selectBranches(conn, job, input, progress);
      break;
    case 'translate_feedback':
      await translateFeedback(conn, job, input, progress);
      break;
    case 'affordability':
      await affordability(conn, job, input, progress);
      break;
    case 'explain':
      await explain(conn, job, input, progress);
      break;
    default:
      await failWithFallback(conn, job, `unknown job kind: ${job.kind}`);
  }
}

/** Fail the job and tell the user what to do instead. Never leave them stuck. */
async function failWithFallback(conn: Conn, job: JobRow, reason: string): Promise<void> {
  log(`job ${job.id} falling back: ${reason}`);
  const plan = fallbackFor(job.kind);
  try {
    await conn.reducers.postAgentMessage({ text: plan.message, chips: [], refId: undefined });
  } catch {
    /* posting is best-effort */
  }
  await conn.reducers.failJob({ jobId: job.id, reason: reason.slice(0, 2000) });
}

async function interpretEvent(
  conn: Conn,
  job: JobRow,
  input: Record<string, unknown>,
  progress: (text: string) => Promise<void>
): Promise<void> {
  await progress('Reading what happened…');
  const text = String(input.text ?? '');
  const context = contextFor(conn, job.householdId, { userSaid: text });

  const outcome = await runTask(
    tiers,
    {
      kind: job.kind,
      context,
      instruction: `The couple said: "${text}". Classify it into one life-event template and ask for anything you still need.`,
      tool: classifyLifeEventTool,
      parse: args => {
        const parsed = classifyLifeEventSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, failure: { gate: 'schema', detail: parsed.error.message } };
        }
        for (const followUp of parsed.data.followUps) {
          const failure = validateText(followUp.prompt, context.engineData, {
            maxLength: 200,
            label: 'follow-up',
          });
          if (failure) return { ok: false, failure };
        }
        return { ok: true, value: parsed.data };
      },
    },
    text => void progress(text)
  );

  if (!outcome.ok) {
    await failWithFallback(conn, job, outcome.reason);
    return;
  }

  const first = outcome.value.followUps[0];
  await conn.reducers.applyEventInterpretation({
    templateId: outcome.value.templateId,
    params: Object.entries(outcome.value.params).map(([key, value]) => ({
      key,
      value: String(value),
    })),
    followUpPrompt: first?.prompt ?? '',
    followUpChips: first?.chips ?? [],
  });

  await conn.reducers.completeJob({
    jobId: job.id,
    result: JSON.stringify(outcome.value),
    modelUsed: outcome.modelUsed,
  });
  log(`job ${job.id} done (${outcome.value.templateId}) via ${outcome.modelUsed}`);
}

async function selectBranches(
  conn: Conn,
  job: JobRow,
  input: Record<string, unknown>,
  progress: (text: string) => Promise<void>
): Promise<void> {
  const candidates = (input.candidates ?? []) as {
    candidateId: string;
    signature: string;
    stats: unknown;
  }[];
  if (candidates.length < 3) {
    // The engine already named these with templates when it generated them, so
    // there is nothing broken to repair — just nothing for the agent to add.
    await conn.reducers.completeJob({
      jobId: job.id,
      result: JSON.stringify({ skipped: 'fewer than three candidates' }),
      modelUsed: 'none',
    });
    return;
  }

  await progress(`Naming ${candidates.length} paths…`);
  const context = contextFor(conn, job.householdId, { candidates });

  const outcome = await runTask(
    tiers,
    {
      kind: job.kind,
      context,
      instruction:
        'Choose exactly three of these candidate paths and give each a short, warm name and a one-or-two-sentence summary describing what the projection shows.',
      tool: selectBranchesTool,
      parse: args => {
        const parsed = selectBranchesSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, failure: { gate: 'schema', detail: parsed.error.message } };
        }
        const failure = validatePicks(
          parsed.data.picks,
          candidates.map(c => c.candidateId),
          context.engineData
        );
        if (failure) return { ok: false, failure };
        return { ok: true, value: parsed.data };
      },
    },
    text => void progress(text)
  );

  if (!outcome.ok) {
    // The template names are already on screen, so this failure is invisible to
    // the couple — exactly as 07 Agent Spec intends.
    log(`job ${job.id} keeping template names: ${outcome.reason}`);
    await conn.reducers.failJob({ jobId: job.id, reason: outcome.reason.slice(0, 2000) });
    return;
  }

  if (job.sessionId === undefined || job.sessionId === null) {
    await failWithFallback(conn, job, 'no session on the job');
    return;
  }

  // One card at a time, with progress between — 08 Live Session Spec wants
  // cards to arrive one by one and "Building branch 2 of 3…" to mean something.
  // Both partners watch the same rows land in the same order.
  const total = outcome.value.picks.length;
  for (const [index, pick] of outcome.value.picks.entries()) {
    await progress(`Building branch ${index + 1} of ${total}…`);
    await conn.reducers.nameBranch({
      sessionId: job.sessionId,
      position: index,
      pick: {
        candidateId: BigInt(pick.candidateId),
        name: pick.name,
        summary: pick.summary,
      },
      // The first write clears the previous batch, so a reroll never shows a
      // mix of old and new cards.
      replaceExisting: index === 0,
    });
    if (index < total - 1) await sleep(CARD_STAGGER_MS);
  }

  await conn.reducers.completeJob({
    jobId: job.id,
    result: JSON.stringify(outcome.value),
    modelUsed: outcome.modelUsed,
  });
  log(`job ${job.id} named ${total} branches via ${outcome.modelUsed}`);
}

async function translateFeedback(
  conn: Conn,
  job: JobRow,
  input: Record<string, unknown>,
  progress: (text: string) => Promise<void>
): Promise<void> {
  await progress('Working out what that means…');
  const text = String(input.text ?? '');
  const memberId = String(input.memberId ?? '');
  const context = contextFor(conn, job.householdId, { userSaid: text });

  const outcome = await runTask(
    tiers,
    {
      kind: job.kind,
      context,
      instruction: `In a planning session, one of them said: "${text}". Translate it into constraints the engine understands, using the goal ids from the data. If it asks for nothing concrete, return no locks.`,
      tool: setConstraintsTool,
      parse: args => {
        const parsed = setConstraintsSchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, failure: { gate: 'schema', detail: parsed.error.message } };
        }
        const goalIds = new Set((context.goals ?? []).map(g => g.id));
        for (const lock of parsed.data.locks) {
          if ('goalId' in lock && !goalIds.has(lock.goalId)) {
            return {
              ok: false,
              failure: { gate: 'schema', detail: `goalId ${lock.goalId} is not in the data` },
            };
          }
        }
        return { ok: true, value: parsed.data };
      },
    },
    t => void progress(t)
  );

  if (!outcome.ok) {
    await failWithFallback(conn, job, outcome.reason);
    return;
  }

  if (outcome.value.locks.length === 0) {
    await conn.reducers.postAgentMessage({
      text: "I didn't catch anything to change there. You can lock an effect or pin what matters most on any card.",
      chips: [],
      refId: undefined,
    });
  } else if (job.sessionId !== undefined && job.sessionId !== null) {
    await conn.reducers.applyConstraintTranslation({
      sessionId: job.sessionId,
      memberId: BigInt(memberId),
      targets: outcome.value.locks.map(lock => JSON.stringify(lock)),
    });
    // The engine rerolls under the new constraints; the couple still decides.
    await conn.reducers.reroll({ sessionId: job.sessionId }).catch(() => undefined);
  }

  await conn.reducers.completeJob({
    jobId: job.id,
    result: JSON.stringify(outcome.value),
    modelUsed: outcome.modelUsed,
  });
  log(`job ${job.id} set ${outcome.value.locks.length} constraint(s) via ${outcome.modelUsed}`);
}

async function affordability(
  conn: Conn,
  job: JobRow,
  input: Record<string, unknown>,
  progress: (text: string) => Promise<void>
): Promise<void> {
  await progress('Checking what that would mean…');
  const text = String(input.text ?? '');
  const context = contextFor(conn, job.householdId, { userSaid: text });

  const outcome = await runTask(
    tiers,
    {
      kind: job.kind,
      context,
      instruction: `They asked: "${text}". Extract the amount in dollars and a short label.`,
      tool: checkAffordabilityTool,
      parse: args => {
        const parsed = checkAffordabilitySchema.safeParse(args);
        if (!parsed.success) {
          return { ok: false, failure: { gate: 'schema', detail: parsed.error.message } };
        }
        return { ok: true, value: parsed.data };
      },
    },
    t => void progress(t)
  );

  if (!outcome.ok) {
    await failWithFallback(conn, job, outcome.reason);
    return;
  }

  // The engine answers it; the agent only read the question.
  await conn.reducers.checkAffordability({
    amountCents: Math.round(outcome.value.amount * 100),
    label: outcome.value.label,
  });
  await conn.reducers.completeJob({
    jobId: job.id,
    result: JSON.stringify(outcome.value),
    modelUsed: outcome.modelUsed,
  });
}

/**
 * A sentence about an engine result — the post-commit summary
 * (08 Live Session Spec#Agent as the third participant).
 *
 * Text, not a tool call, so it goes through the same gates as everything else:
 * no number that is not in the data, no advice language. A rejection is
 * invisible to the couple, because `applyBranch` already posted a plain system
 * line when it committed.
 */
async function explain(
  conn: Conn,
  job: JobRow,
  input: Record<string, unknown>,
  progress: (text: string) => Promise<void>
): Promise<void> {
  await progress('Writing it up…');
  const context = contextFor(conn, job.householdId, input);

  const outcome = await runTask(
    tiers,
    {
      kind: job.kind,
      context,
      instruction:
        'The couple just chose this path together. Write one warm sentence describing what the projection now shows. Use only numbers from the data. Do not give advice.',
      maxTokens: 300,
      parse: (_args, text) => {
        const trimmed = text.trim();
        if (!trimmed) {
          return { ok: false as const, failure: { gate: 'schema', detail: 'empty reply' } };
        }
        const failure = validateText(trimmed, context.engineData, {
          maxLength: 240,
          label: 'summary',
        });
        return failure ? { ok: false as const, failure } : { ok: true as const, value: trimmed };
      },
    },
    text => void progress(text)
  );

  if (!outcome.ok) {
    log(`job ${job.id} no summary: ${outcome.reason}`);
    await conn.reducers.failJob({ jobId: job.id, reason: outcome.reason.slice(0, 2000) });
    return;
  }

  await conn.reducers.postAgentMessage({
    text: outcome.value,
    chips: [],
    refId: job.sessionId ?? undefined,
  });
  await conn.reducers.completeJob({
    jobId: job.id,
    result: JSON.stringify({ summary: outcome.value }),
    modelUsed: outcome.modelUsed,
  });
}

// ---------------------------------------------------------------------------
// Connection plumbing
// ---------------------------------------------------------------------------

function connect(): Promise<{ conn: Conn; identity: Identity }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('could not reach SpacetimeDB')), 20000);
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      // The agent keeps its identity across restarts, so it stays the same
      // member of the household (04 Architecture#Identity and households).
      .withToken(process.env.AGENT_TOKEN || undefined)
      .withAutomaticReconnect()
      .onConnect((conn, identity, token) => {
        clearTimeout(timer);
        if (!process.env.AGENT_TOKEN) {
          log('no AGENT_TOKEN set; add this to services/agent/.env to keep this identity:');
          log(`AGENT_TOKEN=${token}`);
        }
        resolve({ conn, identity });
      })
      .onConnectError((_ctx, error) => {
        clearTimeout(timer);
        reject(error);
      })
      .build();
  });
}

function subscribe(conn: Conn): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscription timed out')), 20000);
    conn
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
