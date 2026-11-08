---
tags: [branches, stage]
status: not-started
---
# Stage 4 — Life Events and Impact

**Goal:** entering a life event shows exactly what it does to the plan. No agent yet; a form drives it.

## Starting point
Stage 3 complete: plan with goals and projections, synced live.

## Read first
[[06 Engine Spec#Life event templates]] · [[06 Engine Spec#Impact]] · [[05 Data Model#Events, impact, branches]] · [[10 Screens#Chat]]

## Build
1. `life_event` and `impact` tables; reducers `createEvent`, `answerEventParam`, `computeImpact`, `dismissEvent`.
2. Event form (template picker + parameter fields). This is also the permanent fallback when the agent is unavailable.
3. Impact card in Chat: goals affected (with shortfalls), tight years before/after, emergency-fund change, free-to-plan change, and **Start planning session** (button can be inert until Stage 7).
4. "No impact" state: "This doesn't change your goals" + keep plan.
5. Affordability check form in Chat (amount + label) showing the engine result in time terms.

## Out of scope
Branches (Stage 5), agent (Stage 6), live session (Stage 7).

## Done when
- [ ] Baby event on Test Household A (birth month 9, member B, 2 months leave, daycare) shows Japan at risk with shortfall $2,183.97, House funded, tight months 9–23 (E5).
- [ ] Medical bill $6,000 at month 3 shows no impact (E4).
- [ ] Impact appears on both devices live when either partner creates the event.
- [ ] Every impact number opens "Show the Math."

## Verification
`verify:engine` E4–E5; `verify:flow` step 2.

## Build Log
*(append entries here)*
