---
tags: [branches, stage]
status: not-started
---
# Stage 1 — Engine Core

**Goal:** the deterministic math and simulation engine, proven correct by golden checks.

## Starting point
Stage 0 complete: monorepo, `packages/engine` importable from the SpacetimeDB module and scripts.

## Read first
[[06 Engine Spec]] (all of it) · [[11 Mock Data#Test Household A]] · [[12 Verification#V1 Math]] · [[12 Verification#V2 Engine]]

## Build
1. Formulas F1–F5 with `r = 0` handling.
2. Monthly simulation exactly as specified (allocation order, required-payment recomputation, settlement, emergency fund, tight months).
3. Outputs: goals, atRiskGoalIds, tightMonths, tightYears, freeToPlan, emergency-fund months (now, min), goalsOnTrack, yearly series, provenance records.
4. Event templates as data + an `applyEvents` step feeding the simulation.
5. Impact computation (with vs without an event).
6. Affordability check.
7. Test Household A baseline and goals as an engine fixture (the transaction generator comes in Stage 2).
8. `verify:math` and `verify:engine` (E1–E5, E10). E6–E9 can be stubbed as "pending Stage 5."

## Out of scope
Levers and branches (Stage 5), database tables, UI.

## Done when
- [ ] `verify:math`: F1–F5 and `r = 0` cases PASS.
- [ ] `verify:engine`: E1–E5 and E10 PASS.
- [ ] Every number in the output has a provenance record (formula id, inputs, assumptions).
- [ ] Engine has no imports of I/O, time, or randomness.

## Verification
`verify:math`, `verify:engine`.

## Notes for Claude Code
If a golden fails, re-read [[06 Engine Spec#Monthly simulation]] step by step (order of interest, payment, settlement, and emergency update matters) before changing anything.

## Build Log
*(append entries here)*
