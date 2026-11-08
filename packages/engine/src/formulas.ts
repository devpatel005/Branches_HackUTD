import { toCents } from './money.ts';

/**
 * Formulas F1-F5 from 06 Engine Spec. Pure, deterministic, no wall-clock time.
 *
 * Stage 0 ships F1 only (proving packages/engine is importable from the
 * SpacetimeDB module). F2-F5 land in Stage 1 against goldens V1.
 */

/** Monthly periodic rate from a nominal annual rate. 06 Engine Spec: r = rate / 12. */
export function monthlyRate(annualRate: number): number {
  return annualRate / 12;
}

/**
 * F1 — Savings with no interest: PMT = FV / n
 * Golden: FV 12,000, n 24 -> 500.00
 */
export function f1SavingsNoInterest(futureValue: number, months: number): number {
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error(`f1SavingsNoInterest: months must be a positive integer, got ${months}`);
  }
  return toCents(futureValue / months);
}
