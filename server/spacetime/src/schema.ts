import { schema, table, t } from 'spacetimedb/server';

/**
 * Branches tables — 05 Data Model.
 *
 * Money is **integer cents** (02 Ground Rules #5). Columns use `i32`, not
 * `i64`: i32 cents tops out around $21.4M, far beyond any household plan, and
 * it keeps money out of JavaScript `bigint` — which `JSON.stringify` refuses to
 * serialize, and which would otherwise infect every projection payload and
 * every number the UI formats. Row ids stay `u64` because `autoInc` requires it.
 *
 * Rows that belong to one person carry `ownerIdentity` alongside
 * `ownerMemberId`, so a client visibility filter can key on `:sender` directly.
 */

export const household = table(
  { name: 'household', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    joinCode: t.string().unique(),
    name: t.string(),
    /** Plan month 0, as `YYYY-MM`. Set from ctx.timestamp at creation. */
    currentMonth: t.string(),
    createdAt: t.timestamp(),
    /** True once both partners have finished onboarding. */
    onboarded: t.bool(),
  }
);

export const member = table(
  { name: 'member', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index('btree'),
    identity: t.identity().unique(),
    displayName: t.string(),
    /** `a` / `b` -> memberA / memberB in 09 Design System. */
    colorKey: t.string(),
    /** `member` or `agent`. Agent-only reducers check this. */
    role: t.string(),
    online: t.bool(),
    lastSeenAt: t.timestamp(),
  }
);

export const assumption = table(
  { name: 'assumption', public: true },
  {
    householdId: t.u64().primaryKey(),
    /** Basis points, so assumptions are integers too. 400 = 4.00%. */
    savingsRateBps: t.i32(),
    inflationBps: t.i32(),
    mortgageRateBps: t.i32(),
    carRateBps: t.i32(),
  }
);

/**
 * Mock PNC-style transactions.
 *
 * **Never contains a fun-money purchase** (02 Ground Rules #3). Those are
 * device-local and never reach this database. Readable only by their owner —
 * see `transactionVisibility` in index.ts — which also means the agent, a
 * client like any other, can never subscribe to them.
 */
export const transaction = table(
  { name: 'transaction', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index('btree'),
    ownerMemberId: t.u64(),
    ownerIdentity: t.identity().index('btree'),
    /** ISO `YYYY-MM-DD`. */
    date: t.string(),
    amountCents: t.i32(),
    counterparty: t.string(),
    counterpartyType: t.string(),
  }
);

export const inferredItem = table(
  { name: 'inferred_item', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index('btree'),
    ownerMemberId: t.u64(),
    ownerIdentity: t.identity().index('btree'),
    /** income / fixed / debt / retirement / external_account / flexible */
    kind: t.string(),
    label: t.string(),
    monthlyCents: t.i32(),
    /** pending / confirmed / edited / rejected */
    status: t.string(),
    /** Sort key from inference, so the UI shows the engine's documented order. */
    sortIndex: t.i32(),
  }
);

export const gapQuestion = table(
  { name: 'gap_question', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index('btree'),
    ownerMemberId: t.u64(),
    ownerIdentity: t.identity().index('btree'),
    /** Stable key from the engine, so re-running inference is idempotent. */
    engineKey: t.string(),
    prompt: t.string(),
    /** range / choice / number */
    answerType: t.string(),
    options: t.array(t.string()),
    answer: t.option(t.string()),
    /** The inferred item label this question qualifies. */
    subject: t.string(),
  }
);

/** One member's share of the baseline income, as a nested row value. */
export const MemberIncome = t.object('MemberIncome', {
  memberId: t.u64(),
  cents: t.i32(),
});

/**
 * Derived from confirmed inferred items; recomputed by a reducer, never written
 * by a client (05 Data Model).
 */
export const baseline = table(
  { name: 'baseline', public: true },
  {
    householdId: t.u64().primaryKey(),
    incomeByMember: t.array(MemberIncome),
    fixedCents: t.i32(),
    debtCents: t.i32(),
    flexibleCents: t.i32(),
    retirementCents: t.i32(),
    liquidSavingsCents: t.i32(),
  }
);

/**
 * Fun money: **amount and status only** (02 Ground Rules #3).
 *
 * The purchases behind `status` never leave the owner's device. Overspending is
 * self-contained — an overage reduces that member's next month via
 * `carryoverCents` — so the shared plan never changes and the partner is never
 * notified.
 */
export const funMoney = table(
  { name: 'fun_money', public: true },
  {
    memberId: t.u64().primaryKey(),
    householdId: t.u64().index('btree'),
    monthlyCents: t.i32(),
    /** `within` or `over`. Computed on the owner's device. */
    status: t.string(),
    carryoverCents: t.i32(),
  }
);

/**
 * A goal is **shared**: both partners see every goal, unlike transactions and
 * inferred items. There is no visibility filter here on purpose — the plan is
 * the thing they build together (01 Product Overview).
 */
export const goal = table(
  { name: 'goal', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index('btree'),
    title: t.string(),
    icon: t.string(),
    costTodayCents: t.i32(),
    /** Plan-month index T, 1..120. The goal settles at the end of month T-1. */
    targetMonth: t.i32(),
    /**
     * Where this goal was first aimed, before any committed branch moved it.
     *
     * Kept so Timeline and Goal Detail can say "moved from Jun 2028 to Mar
     * 2029" — the couple should be able to see what a decision cost them — and
     * so a later event's branches measure delays from the real original rather
     * than from an already-delayed date.
     */
    originalTargetMonth: t.i32(),
    /** Percent of today's cost removed by a committed shrink lever. */
    committedShrinkPct: t.i32(),
    /** `must` or `flex`. Must-have goals are funded first. */
    priority: t.string(),
    createdBy: t.u64(),
    /** `active` or `completed`. */
    status: t.string(),
  }
);

/**
 * The engine's output for the committed plan (05 Data Model).
 *
 * Stored as one JSON string rather than split across columns: the whole
 * `SimulationOutput` for Test Household A is ~13.6 KB including the 120-month
 * series and all provenance, which is small enough that splitting it would buy
 * nothing and cost the UI a join. Recomputed on **every** plan change, so
 * clients never see a projection that disagrees with the goals it came from.
 *
 * `version` increments on each write, which gives the UI something cheap to
 * watch and makes a stale read obvious.
 */
export const planProjection = table(
  { name: 'plan_projection', public: true },
  {
    householdId: t.u64().primaryKey(),
    version: t.i32(),
    json: t.string(),
    updatedAt: t.timestamp(),
    /** Who triggered the recompute, so the UI can pulse in their colour. */
    lastChangedBy: t.option(t.u64()),
  }
);

/**
 * A life event. **One is active at a time** per household: 08 Live Session says
 * a session is about one event, so a new event supersedes any existing draft.
 * Applied and dismissed events stay as history.
 */
export const lifeEvent = table(
  { name: 'life_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index('btree'),
    templateId: t.string(),
    /** Template-specific parameters as JSON (05 Data Model). */
    params: t.string(),
    /** `draft` | `active` | `applied` | `dismissed`. */
    status: t.string(),
    createdBy: t.u64(),
    createdAt: t.timestamp(),
  }
);

/** The engine's impact output for one event (05 Data Model). */
export const impact = table(
  { name: 'impact', public: true },
  {
    eventId: t.u64().primaryKey(),
    householdId: t.u64().index('btree'),
    json: t.string(),
    computedAt: t.timestamp(),
  }
);

/**
 * The shared chat thread.
 *
 * Pulled forward from Stage 6 deliberately: Stage 4 already needs somewhere for
 * event entries, impact cards and affordability answers to live, and
 * 10 Screens#Chat describes a thread. Building the thread now means Stage 6 adds
 * the agent as another author rather than rebuilding the screen.
 *
 * `authorMemberId` is absent for engine-produced cards — they are results, not
 * anybody's opinion. The agent will author its own messages as a member with
 * role `agent`.
 */
export const chatMessage = table(
  { name: 'chat_message', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index('btree'),
    sessionId: t.option(t.u64()),
    authorMemberId: t.option(t.u64()),
    /** `text` | `event` | `impact` | `affordability` | `system`. */
    kind: t.string(),
    text: t.string(),
    /** Tap-able follow-up answers (Stage 6). */
    chips: t.array(t.string()),
    /** The row this card refers to: an event id, mostly. */
    refId: t.option(t.u64()),
    /** Card data as JSON, for kinds that carry a result. */
    payload: t.string(),
    createdAt: t.timestamp(),
  }
);

/**
 * A planning session — one event, one conversation.
 *
 * Pulled forward from Stage 7 so candidates, constraints and reroll exclusions
 * have a real session to hang off, and so Stage 7 adds presence, selections and
 * the ready check to an existing screen rather than building one. Only one
 * session may be open per household (08 Live Session Spec).
 */
export const session = table(
  { name: 'session', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index('btree'),
    eventId: t.u64().index('btree'),
    /** `open` | `committed` | `closed`. */
    status: t.string(),
    startedBy: t.u64(),
    committedBranchId: t.option(t.u64()),
    startedAt: t.timestamp(),
  }
);

/**
 * A path the engine generated but the couple may not have seen yet.
 *
 * `signature` is the canonical lever-set string: it is how a reroll avoids
 * repeating a path and how a candidate keeps its identity across batches.
 */
export const branchCandidate = table(
  { name: 'branch_candidate', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    eventId: t.u64(),
    /** Which generation round produced it; a reroll increments this. */
    batch: t.i32(),
    signature: t.string(),
    levers: t.string(),
    stats: t.string(),
    /** `engine` | `bridge` | `custom`. */
    source: t.string(),
    /** Set once the candidate has been offered, so a reroll can exclude it. */
    shownAt: t.option(t.timestamp()),
  }
);

/** One of the three named paths actually on screen. */
export const branch = table(
  { name: 'branch', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    candidateId: t.u64(),
    name: t.string(),
    summary: t.string(),
    /** `agent` | `template`. Stage 5 only ever writes `template`. */
    nameSource: t.string(),
    position: t.i32(),
    /** Who last tuned a slider on this branch, for "Tuned by Jordan". */
    tunedBy: t.option(t.u64()),
  }
);

/**
 * A lock (keep this effect when rerolling) or a pin (a member's single
 * non-negotiable). Same shapes, different purpose (08 Live Session Spec).
 */
export const constraint = table(
  { name: 'constraint', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    memberId: t.u64(),
    /** `lock` or `pin`. */
    kind: t.string(),
    /** The constraint shape, as JSON: goalOnTime / goalFullSize / etc. */
    target: t.string(),
    active: t.bool(),
  }
);

/**
 * One member's state inside a session — 05 Data Model#Live session.
 *
 * Presence, their pick, and their ready flag. This is the table the ready check
 * reads: the commit rule is "every household member is present, every one is
 * ready, and all of them are ready for the *same* branch".
 */
export const sessionMember = table(
  { name: 'session_member', public: true },
  {
    memberId: t.u64().primaryKey(),
    sessionId: t.u64().index('btree'),
    /** True while this member has the session screen open and is connected. */
    present: t.bool(),
    selectedBranchId: t.option(t.u64()),
    ready: t.bool(),
    readyAt: t.option(t.timestamp()),
  }
);

/**
 * One reaction per member per branch; the latest wins
 * (08 Live Session Spec#Reactions).
 */
export const reaction = table(
  { name: 'reaction', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.u64().index('btree'),
    memberId: t.u64(),
    branchId: t.u64(),
    emoji: t.string(),
  }
);

/**
 * What the couple decided, kept separate from what was observed.
 *
 * The baseline means "what your transactions show"; this means "what we chose
 * to change". Keeping `saveMore` here rather than editing the baseline's
 * flexible figure means the decision stays visible and reversible, and
 * re-running inference cannot silently undo it.
 */
export const planCommitment = table(
  { name: 'plan_commitment', public: true },
  {
    householdId: t.u64().primaryKey(),
    saveMoreCents: t.i32(),
    /** The branch this came from, for provenance. */
    fromBranchId: t.option(t.u64()),
    committedAt: t.timestamp(),
  }
);

/**
 * The bus between the app and the agent service (04 Architecture#Message bus).
 *
 * The app never calls the agent. It queues a job; the service — an ordinary
 * SpacetimeDB client with no public URL — picks it up, writes progress as it
 * goes, and writes results back through agent-only reducers. Every subscribed
 * client sees the progress and the result live, which is what makes "Building
 * branch 2 of 3..." appear on both partners' screens at once.
 */
export const agentJob = table(
  { name: 'agent_job', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index('btree'),
    sessionId: t.option(t.u64()),
    /** interpret_event | select_branches | translate_feedback | affordability | explain | general_chat */
    kind: t.string(),
    /** Task-specific input as JSON. */
    input: t.string(),
    /** `queued` | `running` | `done` | `failed`. */
    status: t.string().index('btree'),
    /** Shown live on both screens: "Reading your event...". */
    progressText: t.string(),
    result: t.string(),
    /** Retries used. The spec allows one retry per tier before failing over. */
    attempts: t.i32(),
    /**
     * When `claimJob` set this job `running`, so a job abandoned by a service
     * that died mid-flight can be found and recovered.
     *
     * Without it a crash between `claimJob` and `completeJob` left the row
     * `running` forever — and because `claimJob` refuses while any job in the
     * household is running, that wedged the agent for that household
     * permanently, with both partners watching a spinner that would never stop.
     */
    claimedAt: t.option(t.timestamp()),
    /** Which model answered, so a failover is visible after the fact. */
    modelUsed: t.string(),
    /** The message that prompted this job, for threading the reply. */
    promptMessageId: t.option(t.u64()),
    createdAt: t.timestamp(),
  }
);

/**
 * Stage 0's sync canary, kept deliberately.
 *
 * `verify:stdb` uses it as a stale-publish detector: the reducer recomputes
 * F1(12000, 24) and the engine version on every call, so a deployed module that
 * does not match the working tree fails loudly.
 */
export const counter = table(
  { name: 'counter', public: true },
  {
    id: t.u32().primaryKey(),
    value: t.u32(),
    engineCheck: t.f64(),
    engineVersion: t.string(),
    lastBumpedBy: t.option(t.identity()),
  }
);

/**
 * "Serve this household" — the Menu tab's one-button fix for an agent that has
 * latched onto the wrong household.
 *
 * With no `AGENT_JOIN_CODE`, the service serves the **newest** household in the
 * database. That is right on a clean database and wrong on a development one:
 * `verify:flow` mints a fresh household on every run, so a verification run
 * silently steals the agent, and the service's "only ever move to something
 * strictly newer" guard means it can never come back on its own. The symptom is
 * an agent that is plainly running and plainly ignoring you.
 *
 * A row here is a human saying which household is the live one, and it outranks
 * both rules — including `AGENT_JOIN_CODE`, because a tap that just happened is
 * better evidence than a value set at boot.
 *
 * One row per household; the newest `requestedAt` wins. Old rows are kept
 * because they cost nothing and make "who asked, and when" readable in
 * `spacetime sql`.
 */
export const agentRequest = table(
  { name: 'agent_request', public: true },
  {
    householdId: t.u64().primaryKey(),
    requestedAt: t.timestamp(),
    /** Who tapped it, so the log can name them. */
    requestedBy: t.u64(),
  }
);

const spacetimedb = schema({
  household,
  member,
  assumption,
  transaction,
  inferredItem,
  gapQuestion,
  baseline,
  funMoney,
  goal,
  planProjection,
  lifeEvent,
  impact,
  chatMessage,
  session,
  branchCandidate,
  branch,
  constraint,
  sessionMember,
  reaction,
  planCommitment,
  agentJob,
  agentRequest,
  counter,
});

export default spacetimedb;
export { spacetimedb };
