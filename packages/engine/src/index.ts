/**
 * @branches/engine — pure TypeScript. No I/O, no Date.now(), no randomness.
 * Imported by the SpacetimeDB module (so plan math runs inside reducers) and
 * directly by scripts/verify. See 02 Ground Rules and 06 Engine Spec.
 */
export { toCents, toIntegerCents, fromIntegerCents } from './money.ts';
export { monthlyRate, f1SavingsNoInterest } from './formulas.ts';

/** Build marker, so a reducer can prove it really called into the engine. */
export const ENGINE_VERSION = '0.0.0-stage0';
