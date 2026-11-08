---
tags: [branches, stage]
status: not-started
---
# Stage 5 — Levers and Branches

**Goal:** the engine produces branches: paths forward that fix the plan, shown as cards with stats, with locks, rerolls, pins, bridges, and sliders working (single user is fine in this stage).

## Starting point
Stage 4 complete: events produce stored impact.

## Read first
[[06 Engine Spec#Levers]] · [[06 Engine Spec#Branch candidates]] · [[06 Engine Spec#Golden scenarios]] · [[08 Live Session Spec#Live tuning]] · [[08 Live Session Spec#Locks and rerolls]] · [[08 Live Session Spec#Pins and bridge branches]] · [[09 Design System#Signature components]]

## Build
1. Minimal lever search, candidate generation, ordering, fallback selection and template names.
2. Tables `branch_candidate`, `branch`, `constraint`; reducers `generateCandidates`, `tuneLever`, `addConstraint`, `removeConstraint`, `reroll`, `requestBridge`.
3. Closest-option statements when no candidate honors pins.
4. Branch card UI with stats (the health indicators), detail view with sliders, lock chips, reroll button, pin chips.
5. Commit a branch with a temporary single-user confirm (replaced by the ready check in Stage 7): applies levers, marks the event applied, recomputes the plan.
6. Complete `verify:engine` E6–E9 and `verify:flow` steps 3–4 (step 4 may use the temporary confirm until Stage 7).

## Out of scope
Agent naming (Stage 6); multi-user session behaviors (Stage 7).

## Done when
- [ ] For E5, candidates appear in the order of E8 with fallback names ("Save $175 more a month", "Balanced", "Move House to {date}").
- [ ] Applying any of the three yields no at-risk goals and tight months [9, 10] (E9).
- [ ] Locking "House on time" and rerolling never shows a branch that delays the house, and never repeats a shown branch.
- [ ] Two conflicting pins produce bridge branches or closest-option statements.
- [ ] Dragging a slider updates stats immediately; values clamp to the lever domain.
- [ ] `verify:engine` all PASS (E1–E10).

## Verification
`verify:engine`, `verify:flow` steps 3–4.

## Notes for Claude Code
The candidate rules are v1 and expected to change (OD-3). Keep generation, ordering, and naming in separate, clearly named functions so the team can swap rules without touching the UI.

## Build Log
*(append entries here)*
