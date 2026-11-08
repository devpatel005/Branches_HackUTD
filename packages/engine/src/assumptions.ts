import type { Assumptions, Baseline } from './types.ts';

/**
 * Defaults from 06 Engine Spec#Assumptions. All are editable per household and
 * must be shown wherever they are used (02 Ground Rules #8) — the savings rate
 * in particular is an *assumed* rate, not a PNC rate.
 */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  // OPEN(OD-7): 4.00% labelled "assumed"; the PNC figure in the research is unverified.
  savingsRateAnnual: 0.04,
  inflationAnnual: 0.027,
  mortgageRateAnnual: 0.0625,
  carRateAnnual: 0.07,
};

/**
 * The emergency-fund floor: 3 x (fixed + debt payments) per month.
 *
 * OPEN(OD-8). 06 Engine Spec is explicit that this is computed from the
 * **pre-event** baseline, so an event that adds a loan payment (car_replacement)
 * raises the household's costs without moving the bar it is measured against.
 */
export function emergencyFloor(baseline: Baseline): number {
  return 3 * (baseline.fixed + baseline.debt);
}

/** Sum of a per-member money map, in a stable key order. */
export function sumByMember(map: Readonly<Record<string, number>>): number {
  return Object.keys(map)
    .sort()
    .reduce((total, key) => total + (map[key] ?? 0), 0);
}
