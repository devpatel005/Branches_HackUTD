import { toCents } from './money.ts';

/**
 * Formulas F1-F5 from 06 Engine Spec#Formulas. Pure and deterministic: no
 * wall-clock time, no randomness.
 *
 * Each function returns a value rounded to cents, because each is a displayed
 * number in its own right. The simulation deliberately does NOT use these for
 * its inner loop — it carries unrounded dollars and rounds once at output, so
 * rounding never accumulates (02 Ground Rules #5).
 */

/** Monthly periodic rate from a nominal annual rate: r = rate / 12. */
export function monthlyRate(annualRate: number): number {
  return annualRate / 12;
}

function requirePositiveInt(name: string, n: number): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got ${n}`);
  }
}

/**
 * F1 - Savings with no interest: `PMT = FV / n`
 * Golden: FV 12,000, n 24 -> 500.00
 */
export function f1SavingsNoInterest(futureValue: number, months: number): number {
  requirePositiveInt('months', months);
  return toCents(futureValue / months);
}

/**
 * F2 - Sinking fund: `PMT = FV * r / ((1+r)^n - 1)`
 * Golden: FV 20,000, n 36, 4% -> 523.81
 *
 * When r = 0 this degenerates to F1 (06 Engine Spec), because the limit of
 * r / ((1+r)^n - 1) as r -> 0 is 1/n.
 */
export function f2SinkingFund(futureValue: number, months: number, annualRate: number): number {
  requirePositiveInt('months', months);
  const r = monthlyRate(annualRate);
  if (r === 0) return f1SavingsNoInterest(futureValue, months);
  return toCents((futureValue * r) / (Math.pow(1 + r, months) - 1));
}

/**
 * F3 - Future value of a present sum plus a series:
 * `FV = PV(1+r)^n + PMT((1+r)^n - 1)/r`
 * Golden: PV 5,000, PMT 300, n 60, 4% -> 25,994.68
 *
 * An ordinary annuity: deposits land at the end of each month, so the last
 * deposit earns no interest.
 */
export function f3FutureValueOfSeries(
  presentValue: number,
  payment: number,
  months: number,
  annualRate: number
): number {
  requirePositiveInt('months', months);
  const r = monthlyRate(annualRate);
  if (r === 0) return toCents(presentValue + payment * months);
  const growth = Math.pow(1 + r, months);
  return toCents(presentValue * growth + (payment * (growth - 1)) / r);
}

/**
 * F4 - Loan payment: `M = P * r(1+r)^n / ((1+r)^n - 1)`
 * Golden: P 350,000, n 360, 6.25% -> 2,155.01
 *
 * When r = 0 this becomes `P / n` (06 Engine Spec).
 */
export function f4LoanPayment(principal: number, months: number, annualRate: number): number {
  requirePositiveInt('months', months);
  const r = monthlyRate(annualRate);
  if (r === 0) return toCents(principal / months);
  const growth = Math.pow(1 + r, months);
  return toCents((principal * r * growth) / (growth - 1));
}

/**
 * F5 - Inflation: `C_t = C_0 (1+i)^(months/12)`
 * Golden: C0 5,000, 60 months, 2.7% -> 5,712.45
 */
export function f5Inflate(costToday: number, months: number, annualInflation: number): number {
  if (months < 0) throw new Error(`months must be >= 0, got ${months}`);
  return toCents(inflateRaw(costToday, months, annualInflation));
}

/**
 * The unrounded inflation factor, for use inside the simulation where rounding
 * must not accumulate. `f5Inflate` is this, rounded.
 */
export function inflateRaw(costToday: number, months: number, annualInflation: number): number {
  return costToday * Math.pow(1 + annualInflation, months / 12);
}

/**
 * The unrounded sinking-fund payment needed to reach `futureValue` in `months`,
 * starting from a balance that will itself have grown to `balanceAtSettlement`.
 * This is the simulation's inner `required` calculation.
 */
export function requiredPaymentRaw(
  futureValue: number,
  balanceAtSettlement: number,
  months: number,
  monthlyR: number
): number {
  if (months <= 0) return 0;
  const gap = futureValue - balanceAtSettlement;
  if (monthlyR === 0) return Math.max(0, gap / months);
  return Math.max(0, (gap * monthlyR) / (Math.pow(1 + monthlyR, months) - 1));
}
