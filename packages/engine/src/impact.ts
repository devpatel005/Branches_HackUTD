import { simulate } from './simulate.ts';
import type { LifeEvent, SimulationInput, SimulationOutput } from './types.ts';

/**
 * 06 Engine Spec#Impact — what an event does to the plan, as the difference
 * between simulating with it and without it.
 *
 * Nothing here computes a number of its own; both sides come from `simulate`,
 * so impact inherits its determinism and its provenance.
 */

export type ImpactOutput = {
  /** Goals that are at risk *because of* the event, in allocation order. */
  newlyAtRiskGoalIds: string[];
  /** Shortfall per newly at-risk goal, keyed by goal id. */
  shortfallsByGoalId: Readonly<Record<string, number>>;
  /** Goals already at risk before the event, so the UI can avoid blaming it. */
  alreadyAtRiskGoalIds: string[];
  tightMonthsBefore: number[];
  tightMonthsAfter: number[];
  tightYearsBefore: number[];
  tightYearsAfter: number[];
  emergencyMonthsBefore: number;
  emergencyMonthsAfter: number;
  emergencyMonthsMinBefore: number;
  emergencyMonthsMinAfter: number;
  freeToPlanBefore: number;
  freeToPlanAfter: number;
  /** True when nothing became at risk: no branches needed, offer "keep plan". */
  noImpact: boolean;
  before: SimulationOutput;
  after: SimulationOutput;
};

export function computeImpact(
  input: SimulationInput,
  event: LifeEvent | readonly LifeEvent[]
): ImpactOutput {
  const events = Array.isArray(event) ? event : [event as LifeEvent];

  // Without the event, and with it. Levers carry across both sides so an
  // impact measured inside a session reflects what is already locked in.
  const before = simulate({ ...input, events: [] });
  const after = simulate({ ...input, events });

  const wasAtRisk = new Set(before.atRiskGoalIds);
  const newlyAtRiskGoalIds = after.atRiskGoalIds.filter(id => !wasAtRisk.has(id));
  const alreadyAtRiskGoalIds = after.atRiskGoalIds.filter(id => wasAtRisk.has(id));

  const shortfallsByGoalId: Record<string, number> = {};
  for (const id of newlyAtRiskGoalIds) {
    const goal = after.goals.find(g => g.id === id);
    if (goal) shortfallsByGoalId[id] = goal.shortfall;
  }

  return {
    newlyAtRiskGoalIds,
    shortfallsByGoalId,
    alreadyAtRiskGoalIds,
    tightMonthsBefore: before.tightMonths,
    tightMonthsAfter: after.tightMonths,
    tightYearsBefore: before.tightYears,
    tightYearsAfter: after.tightYears,
    emergencyMonthsBefore: before.emergencyMonthsNow,
    emergencyMonthsAfter: after.emergencyMonthsNow,
    emergencyMonthsMinBefore: before.emergencyMonthsMin.months,
    emergencyMonthsMinAfter: after.emergencyMonthsMin.months,
    freeToPlanBefore: before.freeToPlan,
    freeToPlanAfter: after.freeToPlan,
    noImpact: newlyAtRiskGoalIds.length === 0,
    before,
    after,
  };
}
