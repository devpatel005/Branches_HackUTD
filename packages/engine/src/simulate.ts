import { emergencyFloor, sumByMember } from './assumptions.ts';
import { compileEvents, emptyEffects } from './events.ts';
import { inflateRaw, monthlyRate, requiredPaymentRaw } from './formulas.ts';
import { toCents } from './money.ts';
import {
  WINDOW_MONTHS,
  type EventEffects,
  type GoalResult,
  type MonthSample,
  type Provenance,
  type SimulationInput,
  type SimulationOutput,
} from './types.ts';

/**
 * The monthly simulation from 06 Engine Spec#Monthly simulation. Every
 * projection, impact, lever and branch in Branches comes from this one function.
 *
 * Determinism (02 Ground Rules #5): pure, no wall-clock time, no randomness,
 * and every list sorted by a documented key. "Now" is month 0, passed in.
 *
 * Dollars are carried unrounded through the loop and rounded exactly once at
 * output, so rounding error never accumulates across 120 months.
 */

/** A tolerance of half a cent, used for every "did we make it" comparison. */
const EPSILON = 0.005;

type GoalState = {
  id: string;
  priority: 'must' | 'flex';
  /** Target month after any delay lever. */
  targetMonth: number;
  /** Inflated, shrunk cost. Unrounded. */
  cost: number;
  balance: number;
  settled: boolean;
  funded: boolean;
  shortfall: number;
  settleMonth: number;
  requiredAtStart: number;
  /** Retained for provenance. */
  costToday: number;
  shrinkPct: number;
  delayMonths: number;
};

/**
 * Allocation order (stable): must-have goals first, then flexible; within each,
 * by target month ascending, then by goal id ascending.
 *
 * This is why a must-have goal years away is funded ahead of a flexible goal
 * due sooner — and why delaying the house can be what rescues Japan.
 */
function allocationOrder(a: GoalState, b: GoalState): number {
  if (a.priority !== b.priority) return a.priority === 'must' ? -1 : 1;
  if (a.targetMonth !== b.targetMonth) return a.targetMonth - b.targetMonth;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function simulate(input: SimulationInput): SimulationOutput {
  const { baseline, assumptions } = input;
  const levers = input.levers ?? {};
  const r = monthlyRate(assumptions.savingsRateAnnual);
  const floor = emergencyFloor(baseline);
  const memberIds = Object.keys(baseline.incomeByMember).sort();

  const effects: EventEffects =
    input.events && input.events.length > 0
      ? compileEvents(input.events, baseline, assumptions)
      : emptyEffects(memberIds);

  const saveMore = levers.saveMore ?? 0;
  const funMoneyTotal = sumByMember(baseline.funMoneyByMember);

  // ---- Goal setup -------------------------------------------------------
  // C = costToday * (1 - shrinkPct/100) * (1+i)^(T/12), with T after any delay.
  // Goals start with a balance of 0. OPEN(OD-15): existing earmarked savings.
  const goals: GoalState[] = input.goals.map(goal => {
    const delayMonths = levers.delays?.[goal.id] ?? 0;
    const shrinkPct = levers.shrinks?.[goal.id] ?? 0;
    const targetMonth = goal.targetMonth + delayMonths;
    const shrunk = goal.costToday * (1 - shrinkPct / 100);
    return {
      id: goal.id,
      priority: goal.priority,
      targetMonth,
      cost: inflateRaw(shrunk, targetMonth, assumptions.inflationAnnual),
      balance: 0,
      settled: false,
      funded: false,
      shortfall: 0,
      settleMonth: targetMonth - 1,
      requiredAtStart: 0,
      costToday: goal.costToday,
      shrinkPct,
      delayMonths,
    };
  });
  goals.sort(allocationOrder);

  // ---- Month loop -------------------------------------------------------
  let emergency = baseline.liquidSavings;
  const tightMonths: number[] = [];
  const monthly: MonthSample[] = [];
  let minEmergency = Number.POSITIVE_INFINITY;
  let minEmergencyMonth = 0;
  let surplusAtMonthZero = 0;

  for (let m = 0; m < WINDOW_MONTHS; m++) {
    // 1. Surplus. Event changes apply only in the months the event specifies.
    //    May be negative.
    let income = 0;
    for (const id of memberIds) {
      const override = effects.incomeOverrideByMember[id]?.[m];
      const baseIncome = override ?? baseline.incomeByMember[id] ?? 0;
      income += baseIncome + (effects.incomeDeltaByMember[id]?.[m] ?? 0);
    }
    const surplus =
      income -
      baseline.fixed -
      baseline.debt -
      (baseline.flexible - saveMore) -
      funMoneyTotal -
      baseline.retirement -
      (effects.recurringCosts[m] ?? 0);

    if (m === 0) surplusAtMonthZero = surplus;

    // 2. Available is the part of the surplus goals can draw on.
    let available = Math.max(0, surplus);
    let underfunded = false;
    let excess = 0;

    // 3. Fund goals in allocation order.
    for (const goal of goals) {
      if (goal.settled) continue;

      goal.balance *= 1 + r;

      // Deposits remaining, including this one.
      const k = goal.targetMonth - m;
      if (k <= 0) continue;

      // Recomputed every month, so a month that could not pay in full is
      // caught up automatically as soon as money is available again.
      const balanceAtSettlement = goal.balance * Math.pow(1 + r, k - 1);
      const required = requiredPaymentRaw(goal.cost, balanceAtSettlement, k, r);
      if (m === 0) goal.requiredAtStart = required;

      const pay = Math.min(required, available);
      available -= pay;
      goal.balance += pay;
      if (pay < required - EPSILON) underfunded = true;

      // Settle at the end of month T-1.
      if (m === goal.targetMonth - 1) {
        goal.settled = true;
        goal.settleMonth = m;
        if (goal.balance >= goal.cost - EPSILON) {
          goal.funded = true;
          // Overshoot rolls into the emergency fund this month.
          excess += goal.balance - goal.cost;
        } else {
          goal.funded = false;
          goal.shortfall = goal.cost - goal.balance;
        }
        // Either way the balance is spent on the goal.
        goal.balance = 0;
      }
    }

    // 4. Emergency fund.
    emergency =
      emergency * (1 + r) +
      (surplus >= 0 ? available : surplus) -
      (effects.oneTimeCosts[m] ?? 0) +
      excess;

    if (emergency < minEmergency) {
      minEmergency = emergency;
      minEmergencyMonth = m;
    }

    // 5. Tight if the fund dipped below the floor, or any goal underpaid.
    if (emergency < floor - EPSILON || underfunded) tightMonths.push(m);

    const goalBalances: Record<string, number> = {};
    let unsettledBalances = 0;
    for (const goal of goals) {
      if (!goal.settled) {
        goalBalances[goal.id] = toCents(goal.balance);
        unsettledBalances += goal.balance;
      }
    }
    monthly.push({
      month: m,
      emergency: toCents(emergency),
      goalBalances,
      surplus: toCents(surplus),
      // Summed unrounded, then rounded once, so the chart's line never
      // disagrees with the parts by a cent.
      totalSavings: toCents(emergency + unsettledBalances),
    });
  }

  // ---- Outputs ----------------------------------------------------------
  const monthlyFixedAndDebt = baseline.fixed + baseline.debt;
  const emergencyMonthsNowRaw =
    monthlyFixedAndDebt > 0 ? baseline.liquidSavings / monthlyFixedAndDebt : 0;
  const emergencyMonthsMinRaw =
    monthlyFixedAndDebt > 0 ? minEmergency / monthlyFixedAndDebt : 0;

  // atRiskGoalIds stays in allocation order, which `goals` already is.
  const atRiskGoalIds = goals.filter(g => g.shortfall > EPSILON).map(g => g.id);

  const tightYears = [...new Set(tightMonths.map(m => Math.floor(m / 12) + 1))].sort(
    (a, b) => a - b
  );

  const totalRequiredAtStart = goals.reduce((sum, g) => sum + g.requiredAtStart, 0);
  const freeToPlan = surplusAtMonthZero - totalRequiredAtStart;

  const goalResults: GoalResult[] = goals.map(g => ({
    id: g.id,
    targetMonth: g.targetMonth,
    inflatedCost: toCents(g.cost),
    requiredMonthlyAtStart: toCents(g.requiredAtStart),
    funded: g.funded,
    shortfall: toCents(g.shortfall),
    settleMonth: g.settleMonth,
  }));

  const yearly: MonthSample[] = [];
  for (let year = 1; year * 12 <= WINDOW_MONTHS; year++) {
    const sample = monthly[year * 12 - 1];
    if (sample) yearly.push(sample);
  }

  const provenance = buildProvenance({
    goals,
    goalResults,
    assumptions,
    baseline,
    surplusAtMonthZero,
    totalRequiredAtStart,
    freeToPlan,
    emergencyMonthsNowRaw,
    emergencyMonthsMinRaw,
    minEmergency,
    minEmergencyMonth,
    monthlyFixedAndDebt,
    floor,
    tightMonths,
    tightYears,
    fundedCount: goals.filter(g => g.funded).length,
  });

  return {
    goals: goalResults,
    atRiskGoalIds,
    tightMonths,
    tightYears,
    freeToPlan: toCents(freeToPlan),
    emergencyMonthsNow: round2(emergencyMonthsNowRaw),
    emergencyMonthsMin: { months: round2(emergencyMonthsMinRaw), month: minEmergencyMonth },
    goalsOnTrack: { funded: goals.filter(g => g.funded).length, total: goals.length },
    emergencyFloor: toCents(floor),
    series: { monthly, yearly },
    provenance,
  };
}

/** Months of runway are displayed to one or two decimals, not as money. */
function round2(value: number): number {
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}

type ProvenanceArgs = {
  goals: GoalState[];
  goalResults: GoalResult[];
  assumptions: SimulationInput['assumptions'];
  baseline: SimulationInput['baseline'];
  surplusAtMonthZero: number;
  totalRequiredAtStart: number;
  freeToPlan: number;
  emergencyMonthsNowRaw: number;
  emergencyMonthsMinRaw: number;
  minEmergency: number;
  minEmergencyMonth: number;
  monthlyFixedAndDebt: number;
  floor: number;
  tightMonths: number[];
  tightYears: number[];
  fundedCount: number;
};

/**
 * Builds the flat provenance map that powers "Show the Math" (10 Screens#Sheets).
 *
 * Keys are stable paths into the output, so the UI can look up
 * `provenance['goals.japan.requiredMonthlyAtStart']` for the number it is about
 * to render. Inputs are deliberately **unrounded**, so a reader can re-walk the
 * arithmetic and land on the same displayed value.
 */
function buildProvenance(a: ProvenanceArgs): Provenance {
  const p: Provenance = {};
  const i = a.assumptions;

  for (const goal of a.goals) {
    const result = a.goalResults.find(g => g.id === goal.id)!;
    const shrunk = goal.costToday * (1 - goal.shrinkPct / 100);

    p[`goals.${goal.id}.inflatedCost`] = {
      formula: 'F5',
      formulaText:
        "Today's cost, reduced by any shrink, grown by inflation for the years until the target month.",
      inputs: {
        costToday: goal.costToday,
        shrinkPct: goal.shrinkPct,
        costAfterShrink: shrunk,
        targetMonth: goal.targetMonth,
        delayMonths: goal.delayMonths,
        years: goal.targetMonth / 12,
      },
      assumptions: { inflationAnnual: i.inflationAnnual },
      result: result.inflatedCost,
    };

    p[`goals.${goal.id}.requiredMonthlyAtStart`] = {
      formula: 'F2',
      formulaText:
        'The monthly amount that reaches the inflated cost by the target month, given the savings rate and the months remaining. Recomputed every month, so a missed month is caught up later.',
      inputs: {
        inflatedCost: goal.cost,
        startingBalance: 0,
        monthsRemaining: goal.targetMonth,
      },
      assumptions: { savingsRateAnnual: i.savingsRateAnnual },
      result: result.requiredMonthlyAtStart,
    };

    if (result.shortfall > 0) {
      p[`goals.${goal.id}.shortfall`] = {
        formula: 'settlement',
        formulaText:
          'What the goal still needed when its target month arrived: the inflated cost minus everything set aside for it.',
        inputs: {
          inflatedCost: goal.cost,
          balanceAtSettlement: goal.cost - goal.shortfall,
          settleMonth: goal.settleMonth,
        },
        assumptions: { savingsRateAnnual: i.savingsRateAnnual },
        result: result.shortfall,
      };
    }
  }

  p['freeToPlan'] = {
    formula: 'freeToPlan',
    formulaText:
      "This month's surplus, minus what every goal needs each month. What is genuinely unspoken for.",
    inputs: {
      surplusAtMonthZero: a.surplusAtMonthZero,
      totalRequiredAtStart: a.totalRequiredAtStart,
      perGoalRequired: a.goals.map(g => g.requiredAtStart),
    },
    assumptions: { savingsRateAnnual: i.savingsRateAnnual },
    result: toCents(a.freeToPlan),
  };

  p['emergencyMonthsNow'] = {
    formula: 'emergencyMonths',
    formulaText:
      'Months of bills the savings would cover today: liquid savings divided by monthly fixed costs plus debt payments.',
    inputs: {
      liquidSavings: a.baseline.liquidSavings,
      fixed: a.baseline.fixed,
      debt: a.baseline.debt,
      divisor: a.monthlyFixedAndDebt,
    },
    assumptions: {},
    result: round2(a.emergencyMonthsNowRaw),
  };

  p['emergencyMonthsMin'] = {
    formula: 'emergencyMonths',
    formulaText:
      'The lowest the emergency fund gets across the ten years, expressed as months of bills it would cover.',
    inputs: {
      lowestEmergencyFund: a.minEmergency,
      atMonth: a.minEmergencyMonth,
      divisor: a.monthlyFixedAndDebt,
    },
    assumptions: { savingsRateAnnual: i.savingsRateAnnual },
    result: round2(a.emergencyMonthsMinRaw),
  };

  p['emergencyFloor'] = {
    formula: 'emergencyFloor',
    formulaText:
      'The bar the emergency fund is measured against: three months of fixed costs plus debt payments, taken from the plan before any life event.',
    inputs: { fixed: a.baseline.fixed, debt: a.baseline.debt, multiplier: 3 },
    assumptions: {},
    result: toCents(a.floor),
  };

  p['tightMonths'] = {
    formula: 'tightMonth',
    formulaText:
      'A month is tight when the emergency fund sits below the floor, or when a goal could not be paid in full.',
    inputs: { count: a.tightMonths.length, floor: a.floor, months: a.tightMonths },
    assumptions: {},
    result: a.tightMonths.length,
  };

  p['tightYears'] = {
    formula: 'tightYear',
    formulaText: 'A plan year is tight when it contains at least one tight month.',
    inputs: { count: a.tightYears.length, years: a.tightYears },
    assumptions: {},
    result: a.tightYears.length,
  };

  p['goalsOnTrack'] = {
    formula: 'goalsOnTrack',
    formulaText: 'How many goals the projection funds in full by their target month.',
    inputs: { funded: a.fundedCount, total: a.goals.length },
    assumptions: {},
    result: a.fundedCount,
  };

  return p;
}
