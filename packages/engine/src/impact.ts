import { describeEventEffects, type EffectLine } from './explain-events.ts';
import { simulate } from './simulate.ts';
import { toCents } from './money.ts';
import type {
  LifeEvent,
  Provenance,
  SimulationInput,
  SimulationOutput,
} from './types.ts';

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
  /**
   * What the event actually does to the plan, month by month — the "why it
   * changed" half of an impact's "Show the Math".
   */
  effects: EffectLine[];
  /**
   * Provenance for the impact's own numbers, under an `impact.` namespace.
   *
   * A delta is not covered by either projection's provenance: "after minus
   * before" is its own piece of arithmetic. These records make every number on
   * the impact card explainable, same as everywhere else.
   */
  provenance: Provenance;
  before: SimulationOutput;
  after: SimulationOutput;
};

export function computeImpact(
  input: SimulationInput,
  event: LifeEvent | readonly LifeEvent[],
  /** Member display names, so the effect lines read naturally. */
  memberNames: Readonly<Record<string, string>> = {}
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

  const effects = describeEventEffects(events, input.baseline, input.assumptions, memberNames);
  const provenance = buildImpactProvenance({
    before,
    after,
    newlyAtRiskGoalIds,
    shortfallsByGoalId,
    effects,
  });

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
    effects,
    provenance,
    before,
    after,
  };
}

/** The effect lines, as provenance inputs: one entry per line, in order. */
function effectInputs(effects: readonly EffectLine[]): Record<string, string> {
  const out: Record<string, string> = {};
  effects.forEach((line, index) => {
    out[`effect${index + 1}`] = line.label;
  });
  return out;
}

function buildImpactProvenance(a: {
  before: SimulationOutput;
  after: SimulationOutput;
  newlyAtRiskGoalIds: string[];
  shortfallsByGoalId: Readonly<Record<string, number>>;
  effects: readonly EffectLine[];
}): Provenance {
  const p: Provenance = {};
  const why = effectInputs(a.effects);

  p['impact.freeToPlan'] = {
    formula: 'impactDelta',
    formulaText:
      "What the event does to the money left unspoken for each month: the plan's free-to-plan figure before the event, minus the same figure after it.",
    inputs: { before: a.before.freeToPlan, after: a.after.freeToPlan, ...why },
    assumptions: {},
    result: toCents(a.after.freeToPlan - a.before.freeToPlan),
  };

  p['impact.emergencyMonthsMin'] = {
    formula: 'impactDelta',
    formulaText:
      'What the event does to the lowest the emergency fund reaches across the ten years, in months of bills it would cover.',
    inputs: {
      before: a.before.emergencyMonthsMin.months,
      after: a.after.emergencyMonthsMin.months,
      lowestMonthBefore: a.before.emergencyMonthsMin.month,
      lowestMonthAfter: a.after.emergencyMonthsMin.month,
      ...why,
    },
    assumptions: {},
    result: Math.round((a.after.emergencyMonthsMin.months - a.before.emergencyMonthsMin.months) * 100) / 100,
  };

  p['impact.tightYears'] = {
    formula: 'impactDelta',
    formulaText:
      'How many more plan years contain a tight month because of this event. A year is tight when the emergency fund dips below its floor, or a goal cannot be paid in full.',
    inputs: {
      before: a.before.tightYears.length,
      after: a.after.tightYears.length,
      yearsBefore: a.before.tightYears,
      yearsAfter: a.after.tightYears,
      ...why,
    },
    assumptions: {},
    result: a.after.tightYears.length - a.before.tightYears.length,
  };

  p['impact.goalsAtRisk'] = {
    formula: 'impactDelta',
    formulaText:
      "How many goals stop fitting because of this event. Goals that already didn't fit are counted separately, so the event isn't blamed for them.",
    inputs: {
      newlyAtRisk: a.newlyAtRiskGoalIds.length,
      alreadyAtRisk: a.before.atRiskGoalIds.length,
      ...why,
    },
    assumptions: {},
    result: a.newlyAtRiskGoalIds.length,
  };

  // One record per newly at-risk goal, so the shortfall on the card is tappable.
  for (const goalId of a.newlyAtRiskGoalIds) {
    const goal = a.after.goals.find(g => g.id === goalId);
    p[`impact.shortfall.${goalId}`] = {
      formula: 'settlement',
      formulaText:
        "What this goal still needed when its target month arrived: the cost at that date, minus everything set aside for it. Before the event it was funded; these are the changes that broke it.",
      inputs: {
        inflatedCost: goal?.inflatedCost ?? 0,
        setAsideByThen: toCents((goal?.inflatedCost ?? 0) - (a.shortfallsByGoalId[goalId] ?? 0)),
        settleMonth: goal?.settleMonth ?? 0,
        ...why,
      },
      assumptions: {},
      result: a.shortfallsByGoalId[goalId] ?? 0,
    };
  }

  return p;
}
