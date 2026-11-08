import {
  delayDomain,
  mergeLevers,
  minimalDelay,
  minimalSaveMore,
  minimalShrink,
  saveMoreDomain,
  shrinkDomain,
} from './levers.ts';
import { simulate } from './simulate.ts';
import { toCents } from './money.ts';
import type { Goal, Levers, SimulationInput, SimulationOutput } from './types.ts';

/**
 * Branch candidates — 06 Engine Spec#Branch candidates.
 *
 * **These are the v1 rules and are expected to change (OPEN(OD-3)).** Generation,
 * ordering and naming are deliberately three separate exported functions so the
 * team can swap any one of them without touching the module or the UI.
 */

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

/**
 * A lock ("keep this effect when rerolling") and a pin (a member's single
 * non-negotiable) have the same shapes — only who set it and why differ
 * (08 Live Session Spec).
 */
export type Constraint =
  | { kind: 'goalOnTime'; goalId: string }
  | { kind: 'goalFullSize'; goalId: string }
  | { kind: 'noExtraSaving' }
  | { kind: 'saveMoreAtMost'; amount: number };

export type ConstraintKind = Constraint['kind'];

/** True when a lever set respects every constraint. */
export function satisfiesConstraints(
  levers: Levers,
  constraints: readonly Constraint[]
): boolean {
  for (const constraint of constraints) {
    switch (constraint.kind) {
      case 'goalOnTime':
        if ((levers.delays?.[constraint.goalId] ?? 0) > 0) return false;
        break;
      case 'goalFullSize':
        if ((levers.shrinks?.[constraint.goalId] ?? 0) > 0) return false;
        break;
      case 'noExtraSaving':
        if ((levers.saveMore ?? 0) > 0) return false;
        break;
      case 'saveMoreAtMost':
        if ((levers.saveMore ?? 0) > constraint.amount) return false;
        break;
    }
  }
  return true;
}

/**
 * The strictest saveMore ceiling the constraints impose, or null for none.
 * `noExtraSaving` is `saveMoreAtMost(0)` by another name.
 */
function saveMoreCeiling(constraints: readonly Constraint[]): number | null {
  let ceiling: number | null = null;
  for (const constraint of constraints) {
    const limit =
      constraint.kind === 'noExtraSaving'
        ? 0
        : constraint.kind === 'saveMoreAtMost'
          ? constraint.amount
          : null;
    if (limit === null) continue;
    ceiling = ceiling === null ? limit : Math.min(ceiling, limit);
  }
  return ceiling;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export type CandidateSource = 'engine' | 'bridge' | 'custom';

export type Candidate = {
  /** Canonical lever-set string — stable identity across reroll batches. */
  signature: string;
  levers: Levers;
  source: CandidateSource;
  stats: CandidateStats;
};

/**
 * The card stats, which are also the health indicators on Home
 * (06 Engine Spec#Outputs).
 */
export type CandidateStats = {
  freeToPlan: number;
  emergencyMonthsMin: number;
  tightYears: number;
  goalsFunded: number;
  goalsTotal: number;
  atRiskGoalIds: string[];
  /** goalId -> months later than the current plan. Negative means earlier. */
  goalDateChanges: Record<string, number>;
  saveMore: number;
  totalMonthsDelayed: number;
  totalShrinkPct: number;
};

/**
 * Canonical string for a lever set, used for identity, de-duplication across
 * reroll batches, and as the final tie-break in the documented sort order.
 *
 * Keys are sorted so two equal lever sets always produce the same string.
 */
export function leverSetSignature(levers: Levers): string {
  const delays = Object.entries(levers.delays ?? {})
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, v]) => `d:${id}=${v}`);
  const shrinks = Object.entries(levers.shrinks ?? {})
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, v]) => `s:${id}=${v}`);
  const saveMore = (levers.saveMore ?? 0) > 0 ? [`m:${levers.saveMore}`] : [];
  const parts = [...delays, ...shrinks, ...saveMore];
  return parts.length === 0 ? '(none)' : parts.join('|');
}

export function statsFor(
  input: SimulationInput,
  levers: Levers,
  /** The plan as it stands, to measure each goal's date change against. */
  reference: SimulationOutput
): CandidateStats {
  const output = simulate({ ...input, levers: mergeLevers(input.levers, levers) });

  const goalDateChanges: Record<string, number> = {};
  for (const goal of output.goals) {
    const before = reference.goals.find(g => g.id === goal.id);
    if (before && before.targetMonth !== goal.targetMonth) {
      goalDateChanges[goal.id] = goal.targetMonth - before.targetMonth;
    }
  }

  return {
    freeToPlan: output.freeToPlan,
    emergencyMonthsMin: output.emergencyMonthsMin.months,
    tightYears: output.tightYears.length,
    goalsFunded: output.goalsOnTrack.funded,
    goalsTotal: output.goalsOnTrack.total,
    atRiskGoalIds: output.atRiskGoalIds,
    goalDateChanges,
    saveMore: toCents(levers.saveMore ?? 0),
    totalMonthsDelayed: Object.values(levers.delays ?? {}).reduce((s, v) => s + v, 0),
    totalShrinkPct: Object.values(levers.shrinks ?? {}).reduce((s, v) => s + v, 0),
  };
}

/** Every non-null minimal single lever, per 06 Engine Spec#Levers. */
export function minimalLevers(
  input: SimulationInput,
  constraints: readonly Constraint[] = []
): { delays: Record<string, number | null>; shrinks: Record<string, number | null>; saveMore: number | null } {
  const delays: Record<string, number | null> = {};
  const shrinks: Record<string, number | null> = {};

  for (const goal of input.goals) {
    delays[goal.id] = satisfiesConstraints({ delays: { [goal.id]: 1 } }, constraints)
      ? minimalDelayUnder(input, goal, constraints)
      : null;
    shrinks[goal.id] = satisfiesConstraints({ shrinks: { [goal.id]: 1 } }, constraints)
      ? minimalShrinkUnder(input, goal, constraints)
      : null;
  }

  const ceiling = saveMoreCeiling(constraints);
  const saveMore = ceiling === 0 ? null : minimalSaveMoreUnder(input, constraints);

  return { delays, shrinks, saveMore };
}

/**
 * The searches below mirror `levers.ts` but apply active constraints while
 * searching, which 06 Engine Spec requires: a reroll under a lock must not even
 * consider a value the lock forbids.
 */
function minimalDelayUnder(
  input: SimulationInput,
  goal: Goal,
  constraints: readonly Constraint[]
): number | null {
  for (const d of delayDomain(goal)) {
    const levers: Levers = { delays: { [goal.id]: d } };
    if (!satisfiesConstraints(levers, constraints)) continue;
    if (fixes(input, levers)) return d;
  }
  return null;
}

function minimalShrinkUnder(
  input: SimulationInput,
  goal: Goal,
  constraints: readonly Constraint[]
): number | null {
  for (const p of shrinkDomain(goal)) {
    const levers: Levers = { shrinks: { [goal.id]: p } };
    if (!satisfiesConstraints(levers, constraints)) continue;
    if (fixes(input, levers)) return p;
  }
  return null;
}

function minimalSaveMoreUnder(
  input: SimulationInput,
  constraints: readonly Constraint[],
  extra: Levers = {}
): number | null {
  for (const s of saveMoreDomain(input.baseline.flexible)) {
    const levers: Levers = { ...extra, saveMore: s };
    if (!satisfiesConstraints(levers, constraints)) continue;
    if (fixes(input, levers)) return s;
  }
  return null;
}

function fixes(input: SimulationInput, levers: Levers): boolean {
  return (
    simulate({ ...input, levers: mergeLevers(input.levers, levers) }).atRiskGoalIds.length === 0
  );
}

export const MAX_CANDIDATES = 8;

/**
 * Generate candidates for an event.
 *
 * v1 rules (OPEN(OD-3)):
 *  1. every non-null minimal single lever;
 *  2. balanced pairs — for each single delay fix with d >= 2, half that delay
 *     plus the minimal saveMore that then fixes the plan;
 *  3. drop anything violating an active constraint or repeating a lever set
 *     already shown in this session;
 *  4. order by the documented keys;
 *  5. keep at most 8.
 */
export function generateCandidates(
  input: SimulationInput,
  options?: {
    constraints?: readonly Constraint[];
    /** Signatures already shown this session, which a reroll must not repeat. */
    exclude?: readonly string[];
    source?: CandidateSource;
  }
): Candidate[] {
  const constraints = options?.constraints ?? [];
  const exclude = new Set(options?.exclude ?? []);
  const source = options?.source ?? 'engine';

  // The plan as it stands with the event applied, for date-change comparisons.
  const reference = simulate(input);

  const found = new Map<string, Levers>();
  const add = (levers: Levers) => {
    if (!satisfiesConstraints(levers, constraints)) return;
    const signature = leverSetSignature(levers);
    if (signature === '(none)' || exclude.has(signature) || found.has(signature)) return;
    found.set(signature, levers);
  };

  const minimal = minimalLevers(input, constraints);

  // 1. Single-lever fixes.
  for (const goal of input.goals) {
    const d = minimal.delays[goal.id];
    if (d !== null && d !== undefined) add({ delays: { [goal.id]: d } });
    const p = minimal.shrinks[goal.id];
    if (p !== null && p !== undefined) add({ shrinks: { [goal.id]: p } });
  }
  if (minimal.saveMore !== null) add({ saveMore: minimal.saveMore });

  // 2. Balanced pairs: half the delay, plus whatever extra saving closes the gap.
  for (const goal of input.goals) {
    const d = minimal.delays[goal.id];
    if (d === null || d === undefined || d < 2) continue;
    const halved = Math.ceil(d / 2);
    const partial: Levers = { delays: { [goal.id]: halved } };
    const topUp = minimalSaveMoreUnder(input, constraints, partial);
    if (topUp === null) continue;
    add({ delays: { [goal.id]: halved }, saveMore: topUp });
  }

  const candidates: Candidate[] = [...found.entries()].map(([signature, levers]) => ({
    signature,
    levers,
    source,
    stats: statsFor(input, levers, reference),
  }));

  return orderCandidates(candidates).slice(0, MAX_CANDIDATES);
}

/**
 * The documented sort order (06 Engine Spec#Branch candidates):
 * goals whose date changes, then total months delayed, then saveMore, then
 * total shrink %, then the canonical lever-set string.
 *
 * Fewest disruptions first: a path that moves no dates reads as the gentlest.
 */
export function orderCandidates(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    const aDates = Object.keys(a.stats.goalDateChanges).length;
    const bDates = Object.keys(b.stats.goalDateChanges).length;
    return (
      aDates - bDates ||
      a.stats.totalMonthsDelayed - b.stats.totalMonthsDelayed ||
      a.stats.saveMore - b.stats.saveMore ||
      a.stats.totalShrinkPct - b.stats.totalShrinkPct ||
      (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0)
    );
  });
}

// ---------------------------------------------------------------------------
// Fallback names
// ---------------------------------------------------------------------------

/**
 * Template names, used when the agent is unavailable
 * (06 Engine Spec#Branch candidates, 07 Agent Spec#Deterministic fallbacks).
 *
 * `monthLabel` turns a plan-month index into something like "Mar 2029"; the
 * engine cannot do that itself, since it holds no calendar.
 */
export function templateName(
  levers: Levers,
  goals: readonly Goal[],
  monthLabel: (planMonth: number) => string
): string {
  const delays = Object.entries(levers.delays ?? {}).filter(([, v]) => v > 0);
  const shrinks = Object.entries(levers.shrinks ?? {}).filter(([, v]) => v > 0);
  const saveMore = levers.saveMore ?? 0;
  const titleOf = (goalId: string) => goals.find(g => g.id === goalId)?.id ?? goalId;

  const kinds = [delays.length > 0, shrinks.length > 0, saveMore > 0].filter(Boolean).length;
  if (kinds > 1) return 'Balanced';

  if (delays.length === 1) {
    const [goalId, months] = delays[0]!;
    const goal = goals.find(g => g.id === goalId);
    const newMonth = (goal?.targetMonth ?? 0) + months;
    return `Move ${titleOf(goalId)} to ${monthLabel(newMonth)}`;
  }
  if (delays.length > 1) return 'Balanced';
  if (shrinks.length >= 1) return `Smaller ${titleOf(shrinks[0]![0])}`;
  if (saveMore > 0) return `Save $${saveMore} more a month`;
  return 'Keep the plan';
}

/** One- or two-sentence summary, projection language only (02 Ground Rules #2). */
export function templateSummary(stats: CandidateStats, goalTitle: (id: string) => string): string {
  const moves = Object.entries(stats.goalDateChanges);
  const parts: string[] = [];

  if (stats.saveMore > 0) parts.push(`saving $${stats.saveMore} more a month`);
  for (const [goalId, months] of moves) {
    parts.push(`${goalTitle(goalId)} ${months > 0 ? 'moves back' : 'moves up'} ${Math.abs(months)} months`);
  }

  const lead = parts.length === 0 ? 'With no changes' : `With ${joinWords(parts)}`;
  const outcome =
    stats.atRiskGoalIds.length === 0
      ? `the projection funds all ${stats.goalsTotal} goals`
      : `the projection still leaves ${stats.atRiskGoalIds.length} short`;
  const tight =
    stats.tightYears === 0
      ? 'with no tight years'
      : `with ${stats.tightYears} tight year${stats.tightYears === 1 ? '' : 's'}`;

  return `${lead}, ${outcome} ${tight}.`;
}

function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Bridges and the closest option
// ---------------------------------------------------------------------------

/** Candidates honouring every member's pin (08 Live Session Spec). */
export function generateBridges(
  input: SimulationInput,
  pins: readonly Constraint[],
  exclude: readonly string[] = []
): Candidate[] {
  return generateCandidates(input, { constraints: pins, exclude, source: 'bridge' });
}

/** saveMore above the normal cap, searched in $25 steps up to $2,000. */
export const CLOSEST_OPTION_MAX_SAVE_MORE = 2000;
export const CLOSEST_OPTION_STEP = 25;

export type ClosestOption = {
  /** The extra monthly saving that would honour all pins, or null. */
  saveMore: number | null;
  /** Per pinned goal, the smallest delay that makes a candidate possible. */
  delayByGoalId: Record<string, number | null>;
  /** True when neither statement has an answer in range. */
  nothingInRange: boolean;
};

/**
 * What it would take, when no candidate honours every pin
 * (06 Engine Spec#Branch candidates).
 *
 * Two deterministic statements, never an AI tiebreaker: the extra monthly
 * saving that would do it, and for each pin restricting a goal's date, the
 * smallest delay of that goal that makes a candidate possible.
 */
export function closestOption(
  input: SimulationInput,
  pins: readonly Constraint[]
): ClosestOption {
  // (a) saveMore above the normal 25%-of-flexible cap.
  let saveMore: number | null = null;
  for (let s = CLOSEST_OPTION_STEP; s <= CLOSEST_OPTION_MAX_SAVE_MORE; s += CLOSEST_OPTION_STEP) {
    const levers: Levers = { saveMore: s };
    if (!satisfiesConstraints(levers, pins)) continue;
    if (fixes(input, levers)) {
      saveMore = s;
      break;
    }
  }

  // (b) for each pin that holds a goal's date, the minimal delay of that goal.
  const delayByGoalId: Record<string, number | null> = {};
  for (const pin of pins) {
    if (pin.kind !== 'goalOnTime') continue;
    const goal = input.goals.find(g => g.id === pin.goalId);
    if (!goal) continue;
    // Deliberately searched *without* this pin: the statement is "if you let
    // this move, here is the least it would have to move".
    const others = pins.filter(p => p !== pin);
    delayByGoalId[pin.goalId] = minimalDelayUnder(input, goal, others);
  }

  const nothingInRange =
    saveMore === null && Object.values(delayByGoalId).every(v => v === null);

  return { saveMore, delayByGoalId, nothingInRange };
}

/** Re-exported so the module can clamp slider values without its own copy. */
export { delayDomain, shrinkDomain, saveMoreDomain, minimalDelay, minimalShrink, minimalSaveMore };
