/**
 * Engine types. Money is floating-point **dollars** everywhere in here; it
 * becomes cents only at output, through `toCents` (02 Ground Rules #5).
 * Tables store integer cents — convert at the reducer boundary.
 */

/** 06 Engine Spec#Assumptions: the plan window is 120 months, month 0 = now. */
export const WINDOW_MONTHS = 120;

export type Priority = 'must' | 'flex';

export type MemberId = string;

export type Assumptions = {
  /** Nominal annual, compounded monthly. Default 4.00% — an *assumed* rate. OPEN(OD-7) */
  savingsRateAnnual: number;
  /** Annual. Applied to goal costs only. Default 2.70%. */
  inflationAnnual: number;
  /** Used by templates that create a mortgage. Default 6.25%. */
  mortgageRateAnnual: number;
  /** Used by templates that create a car loan. Default 7.00%. */
  carRateAnnual: number;
};

export type Baseline = {
  /** Monthly take-home per member. */
  incomeByMember: Readonly<Record<MemberId, number>>;
  fixed: number;
  debt: number;
  flexible: number;
  /** Each member's monthly allowance. Amount only — purchases never reach here. */
  funMoneyByMember: Readonly<Record<MemberId, number>>;
  /** Set aside, not available for goals. */
  retirement: number;
  /** Starting emergency fund. */
  liquidSavings: number;
};

export type Goal = {
  id: string;
  /** Today's dollars, before inflation and before any shrink lever. */
  costToday: number;
  /** T, in plan months, 1..120. The goal settles at the end of month T-1. */
  targetMonth: number;
  priority: Priority;
};

/** 06 Engine Spec#Levers. Absent entries mean "no lever of that kind". */
export type Levers = {
  /** goalId -> months of delay, 1..36, with T + d <= 120. */
  delays?: Readonly<Record<string, number>>;
  /** goalId -> percent of today's cost removed, 1..30. Flexible goals only. */
  shrinks?: Readonly<Record<string, number>>;
  /** Dollars per month moved out of flexible spending, in $25 steps. */
  saveMore?: number;
};

export type LifeEventTemplateId =
  | 'baby'
  | 'job_loss'
  | 'medical_bill'
  | 'car_replacement'
  | 'raise'
  | 'windfall';

export type LifeEvent = {
  templateId: LifeEventTemplateId;
  /** Template-specific. Validated and defaulted by `compileEvent`. */
  params: Readonly<Record<string, unknown>>;
};

/**
 * An event flattened to per-month arrays, which is the only form the simulation
 * understands. Every array has length WINDOW_MONTHS.
 *
 * Event costs and income changes are in today's dollars and are **not**
 * inflated (06 Engine Spec#Monthly simulation).
 */
export type EventEffects = {
  /** Positive = a cost in that month. Negative = money in (a windfall). */
  oneTimeCosts: number[];
  /** Positive = an ongoing monthly cost from that month. */
  recurringCosts: number[];
  /** memberId -> month -> absolute income, or null to keep the baseline. */
  incomeOverrideByMember: Record<MemberId, (number | null)[]>;
  /** memberId -> month -> amount added to income (a raise). */
  incomeDeltaByMember: Record<MemberId, number[]>;
};

/** One traceable number: what formula produced it, from what, under what assumptions. */
export type ProvenanceRecord = {
  /** Formula id from 06 Engine Spec (F1..F5), or a named rule. */
  formula: string;
  /** Plain-language form, for the "Show the Math" sheet (10 Screens#Sheets). */
  formulaText: string;
  /** Unrounded inputs, so the arithmetic can be re-walked by hand. */
  inputs: Readonly<Record<string, number | string | readonly number[]>>;
  /** Only the assumptions this number actually used. */
  assumptions: Readonly<Record<string, number>>;
  /** The rounded value as displayed. */
  result: number;
};

/**
 * Flat map keyed by a stable path into the output, e.g. `freeToPlan` or
 * `goals.japan.requiredMonthlyAtStart`. The UI looks up `provenance[path]`.
 */
export type Provenance = Record<string, ProvenanceRecord>;

export type GoalResult = {
  id: string;
  /** Target month after any delay lever. */
  targetMonth: number;
  /** Cost after shrink and inflation. */
  inflatedCost: number;
  /** The `required` payment at month 0. */
  requiredMonthlyAtStart: number;
  funded: boolean;
  /** 0 when funded. */
  shortfall: number;
  /** The month the goal settled, i.e. targetMonth - 1. */
  settleMonth: number;
};

export type MonthSample = {
  month: number;
  /** End-of-month emergency fund. */
  emergency: number;
  /** goalId -> end-of-month balance. Settled goals drop out. */
  goalBalances: Readonly<Record<string, number>>;
  /** Surplus for the month; may be negative. */
  surplus: number;
};

export type SimulationOutput = {
  goals: GoalResult[];
  /** Goals with a shortfall > 0.005, in allocation order. */
  atRiskGoalIds: string[];
  /** Sorted month indexes. */
  tightMonths: number[];
  /** Sorted 1-based plan years containing a tight month. Months 0-11 = year 1. */
  tightYears: number[];
  /** Surplus at month 0 minus the sum of required payments. May be negative. */
  freeToPlan: number;
  /** Starting emergency / (fixed + debt). */
  emergencyMonthsNow: number;
  /** The lowest end-of-month emergency / (fixed + debt), and when it happens. */
  emergencyMonthsMin: { months: number; month: number };
  goalsOnTrack: { funded: number; total: number };
  /** The emergency-fund floor this run was measured against. */
  emergencyFloor: number;
  series: {
    /** All 120 months, for the scrubbable chart (09 Design System). */
    monthly: MonthSample[];
    /** End-of-plan-year samples, for the Timeline screen. */
    yearly: MonthSample[];
  };
  provenance: Provenance;
};

export type SimulationInput = {
  baseline: Baseline;
  goals: readonly Goal[];
  assumptions: Assumptions;
  /** At most one event in Stage 1-5; the array keeps multi-event open. */
  events?: readonly LifeEvent[];
  levers?: Levers;
};
