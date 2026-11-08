---
tags: [branches, stage]
status: not-started
---
# Stage 7 — Live Planning Session

**Goal:** the core experience: two people deciding together in real time, with the agent as the third participant, ending in a simultaneous ready check.

## Starting point
Stage 6 complete: agent-driven branches for one user.

## Read first
[[08 Live Session Spec]] (all of it) · [[03 User Journey#Example session]] · [[10 Screens#Session]] · [[12 Verification#V6 Real-time checklist]] · [[12 Verification#V7 Ready check cases]]

## Build
1. Tables `session`, `session_member`, `reaction`; reducers per [[05 Data Model#Reducer groups]].
2. In-app invite banner on every screen.
3. Session screen: presence header, cards arriving one at a time, selections with avatars, reactions, disagreement banner and pin flow, shared sliders with "Tuned by…", shared locks and rerolls, feedback text box.
4. Hold-to-confirm ring with per-member segments, 1.5s client hold, server commit rule, idempotency, ready reset on any change.
5. Post-commit view and agent summary.
6. Replace Stage 5's temporary single-user confirm with the ready check.

## Done when
- [ ] Every item in the V6 checklist passes with one phone and one laptop.
- [ ] Ready check cases R1–R6 behave as specified.
- [ ] The example session in [[03 User Journey]] can be performed end to end.

## Verification
V6 checklist, V7 cases, `verify:flow` step 4 using the real ready check.

## Build Log
*(append entries here)*
