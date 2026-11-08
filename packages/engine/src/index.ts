/**
 * @branches/engine — pure TypeScript. No I/O, no Date.now(), no randomness.
 *
 * Imported by the SpacetimeDB module (so every plan number is computed inside a
 * reducer) and directly by scripts/verify. See 02 Ground Rules and 06 Engine Spec.
 *
 * The AI never computes numbers; everything a user sees originates here.
 */

export { toCents, toIntegerCents, fromIntegerCents } from './money.ts';

export {
  monthlyRate,
  f1SavingsNoInterest,
  f2SinkingFund,
  f3FutureValueOfSeries,
  f4LoanPayment,
  f5Inflate,
  inflateRaw,
  requiredPaymentRaw,
} from './formulas.ts';

export { DEFAULT_ASSUMPTIONS, emergencyFloor, sumByMember } from './assumptions.ts';

export {
  EVENT_TEMPLATES,
  BABY_COSTS,
  CAR_LOAN_MONTHS,
  compileEvents,
  emptyEffects,
  askedParams,
  type TemplateSpec,
} from './events.ts';

export {
  inferBaseline,
  isRecurring,
  followUpForGapAnswer,
  baselineFromItems,
  gapQuestionId,
  INFERENCE_WINDOW_MONTHS,
  RECURRING_MIN_OCCURRENCES,
  RECURRING_MIN_DISTINCT_MONTHS,
  RECURRING_AMOUNT_TOLERANCE,
  FLEXIBLE_LABEL,
  BROKERAGE_CHOICES,
  BALANCE_RANGES,
  LIQUID_SAVINGS_RANGES,
  liquidSavingsFromRange,
  liquidSavingsGapQuestion,
  isLiquidSavingsQuestion,
} from './inference.ts';

export { simulate } from './simulate.ts';
export { computeImpact, type ImpactOutput } from './impact.ts';
export { describeEventEffects, type EffectLine } from './explain-events.ts';
export { checkAffordability, type AffordabilityOutput } from './affordability.ts';

export {
  DELAY_MIN_MONTHS,
  DELAY_MAX_MONTHS,
  SHRINK_MIN_PCT,
  SHRINK_MAX_PCT,
  SAVE_MORE_STEP,
  SAVE_MORE_CAP_FRACTION,
  saveMoreCap,
  delayDomain,
  shrinkDomain,
  saveMoreDomain,
  fixesPlan,
  mergeLevers,
  minimalDelay,
  minimalShrink,
  minimalSaveMore,
} from './levers.ts';

export {
  TEST_HOUSEHOLD_A,
  TEST_HOUSEHOLD_A_BASELINE,
  TEST_HOUSEHOLD_A_GOALS,
  TEST_HOUSEHOLD_A_SURPLUS,
  E5_BABY_EVENT,
  E4_MEDICAL_BILL_EVENT,
} from './fixtures.ts';

export {
  WINDOW_MONTHS,
  type Assumptions,
  type Baseline,
  type EffectLedgerEntry,
  type EventEffects,
  type Goal,
  type GoalResult,
  type Levers,
  type LifeEvent,
  type LifeEventTemplateId,
  type MemberId,
  type MonthSample,
  type CounterpartyType,
  type GapAnswerType,
  type GapQuestion,
  type InferenceOutput,
  type InferredItem,
  type InferredKind,
  type Priority,
  type Transaction,
  type Provenance,
  type ProvenanceRecord,
  type SimulationInput,
  type SimulationOutput,
} from './types.ts';

/** Build marker, so a reducer can prove it really called into the engine. */
export const ENGINE_VERSION = '0.1.0-stage1';
