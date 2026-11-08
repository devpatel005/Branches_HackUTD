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

const spacetimedb = schema({
  household,
  member,
  assumption,
  transaction,
  inferredItem,
  gapQuestion,
  baseline,
  funMoney,
  counter,
});

export default spacetimedb;
export { spacetimedb };
