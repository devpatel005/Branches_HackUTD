---
tags: [branches, stage]
status: not-started
---
# Stage 3 — Goals and Timeline

**Goal:** the couple builds a 10-year plan together and sees whether it works, with every number explainable.

## Starting point
Stage 2 complete: household with a confirmed baseline.

## Read first
[[06 Engine Spec#Monthly simulation]] · [[06 Engine Spec#Outputs]] · [[10 Screens#Home]] · [[10 Screens#Timeline]] · [[10 Screens#Sheets]] · [[09 Design System]]

## Build
1. Goal tables/reducers (`addGoal`, `editGoal`, `removeGoal`) and `setAssumptions`; every change triggers `recomputeProjection` (engine runs in the reducer) and writes `plan_projection`.
2. Goals step of onboarding (shared goal picker).
3. Home: hero "Free to plan," scrubbable projection chart, stat row, goal list.
4. Timeline: years, goals at target months, tight years tinted.
5. Sheets: Goal Detail, Show the Math (from provenance), Assumptions.
6. Live pulses: changes made by the other member pulse in their color.

## Out of scope
Life events and branches.

## Done when
- [ ] Adding Test Household A's two goals produces E1–E3 values in `plan_projection` and on screen (Japan $211.43/mo, House $689.30/mo, free to plan $1,899.28).
- [ ] A goal added on the phone appears on the laptop within ~1s, pulsing in the author's color.
- [ ] Every number on Home, Timeline, and Goal Detail opens a "Show the Math" sheet with formula, inputs, and assumptions.
- [ ] Changing an assumption recomputes the plan live on both devices.
- [ ] No loading flashes during edits.

## Verification
`verify:flow` steps 1 (see [[12 Verification#V4 Data flow]]); V6 checklist items for goals.

## Build Log
*(append entries here)*
