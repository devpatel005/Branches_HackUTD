import { simulate } from './simulate.ts';
import { WINDOW_MONTHS, type Goal, type Levers, type SimulationInput } from './types.ts';

/**
 * Lever domains and the minimal-lever search from 06 Engine Spec#Levers.
 *
 * Stage 1 needs this because the affordability check must answer in *time*
 * ("pushes Japan back 3 months"), which requires a minimal delay and a minimal
 * saveMore. Branch *candidate generation, ordering and naming* stay in Stage 5
 * (OPEN(OD-3)) — this file is only the search those rules will sit on top of.
 */

export const DELAY_MIN_MONTHS = 1;
export const DELAY_MAX_MONTHS = 36;
export const SHRINK_MIN_PCT = 1;
export const SHRINK_MAX_PCT = 30;
export const SAVE_MORE_STEP = 25;
/** saveMore is capped at 25% of flexible spending. */
export const SAVE_MORE_CAP_FRACTION = 0.25;

/** The largest saveMore in range: 25% of flexible spending, rounded down to $25. */
export function saveMoreCap(flexible: number): number {
  return Math.floor((flexible * SAVE_MORE_CAP_FRACTION) / SAVE_MORE_STEP) * SAVE_MORE_STEP;
}

/** Delay values in range for a goal: T + d must stay inside the window. */
export function delayDomain(goal: Goal): number[] {
  const values: number[] = [];
  for (let d = DELAY_MIN_MONTHS; d <= DELAY_MAX_MONTHS; d++) {
    if (goal.targetMonth + d <= WINDOW_MONTHS) values.push(d);
  }
  return values;
}

/** Shrink values in range. Flexible goals only — a must-have is not negotiable in size. */
export function shrinkDomain(goal: Goal): number[] {
  if (goal.priority !== 'flex') return [];
  const values: number[] = [];
  for (let p = SHRINK_MIN_PCT; p <= SHRINK_MAX_PCT; p++) values.push(p);
  return values;
}

export function saveMoreDomain(flexible: number): number[] {
  const cap = saveMoreCap(flexible);
  const values: number[] = [];
  for (let s = SAVE_MORE_STEP; s <= cap; s += SAVE_MORE_STEP) values.push(s);
  return values;
}

/** True when a set of levers leaves no goal at risk. */
export function fixesPlan(input: SimulationInput, levers: Levers): boolean {
  return simulate({ ...input, levers: mergeLevers(input.levers, levers) }).atRiskGoalIds.length === 0;
}

/**
 * Combine already-active levers with the ones being tried. Later values win,
 * which is what lets a search layer a candidate on top of what is locked in.
 */
export function mergeLevers(base: Levers | undefined, extra: Levers): Levers {
  return {
    delays: { ...(base?.delays ?? {}), ...(extra.delays ?? {}) },
    shrinks: { ...(base?.shrinks ?? {}), ...(extra.shrinks ?? {}) },
    saveMore: extra.saveMore ?? base?.saveMore ?? 0,
  };
}

/**
 * The smallest delay for one goal that leaves no goal at risk, or null if no
 * value in range works.
 *
 * Note that a lever on one goal can fix a *different* goal: delaying the house
 * frees money that lets Japan complete.
 */
export function minimalDelay(input: SimulationInput, goalId: string): number | null {
  const goal = input.goals.find(g => g.id === goalId);
  if (!goal) return null;
  for (const d of delayDomain(goal)) {
    if (fixesPlan(input, { delays: { [goalId]: d } })) return d;
  }
  return null;
}

/** The smallest shrink percent for one flexible goal that fixes the plan. */
export function minimalShrink(input: SimulationInput, goalId: string): number | null {
  const goal = input.goals.find(g => g.id === goalId);
  if (!goal) return null;
  for (const p of shrinkDomain(goal)) {
    if (fixesPlan(input, { shrinks: { [goalId]: p } })) return p;
  }
  return null;
}

/** The smallest extra monthly saving, in $25 steps, that fixes the plan. */
export function minimalSaveMore(input: SimulationInput): number | null {
  for (const s of saveMoreDomain(input.baseline.flexible)) {
    if (fixesPlan(input, { saveMore: s })) return s;
  }
  return null;
}
