/**
 * Money rounding. The engine computes in floating-point dollars and rounds to
 * cents only at output (02 Ground Rules #5).
 *
 * Why the toPrecision step: several goldens land on an exact half-cent tie that
 * IEEE-754 lands just *below*. 06 Engine Spec E1 expects Japan's inflated cost
 * to be 5273.65, where the exact value is 5000 * 1.027^2 = 5273.645 — but
 * Math.pow(1.027, 2) is 1.0547289999999998, so a naive Math.round(x * 100) / 100
 * yields 5273.64 and E1 FAILS. Normalising to 12 significant digits first
 * restores the true decimal tie, then half-up rounding gives 5273.65.
 *
 * 12 digits is comfortably inside f64's ~15-17 significant digits, so it only
 * ever removes accumulated binary error, never real precision at our magnitudes.
 *
 * Do NOT "simplify" this to Math.round(x * 100) / 100. 06 Engine Spec forbids
 * editing the goldens to match an implementation, so this helper is the fix.
 */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new Error(`toCents: not a finite number: ${dollars}`);
  }
  const scaled = Number((dollars * 100).toPrecision(12));
  // Half away from zero, NOT Math.round. Math.round breaks ties toward +Infinity,
  // so it rounds -2.345 to -2.34 while rounding 2.345 to 2.35. The engine rounds
  // negative money too (freeToPlan and monthly surplus may be negative per
  // 06 Engine Spec), and sign-dependent rounding would make the magnitude of a
  // shortfall differ from the magnitude of the same number as a surplus.
  // This keeps toCents(-x) === -toCents(x).
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  return rounded / 100;
}

/** Integer cents, for storage in SpacetimeDB tables (05 Data Model). */
export function toIntegerCents(dollars: number): number {
  return Math.round(toCents(dollars) * 100);
}

/** Integer cents from a table back into engine dollars. */
export function fromIntegerCents(cents: number): number {
  return cents / 100;
}
