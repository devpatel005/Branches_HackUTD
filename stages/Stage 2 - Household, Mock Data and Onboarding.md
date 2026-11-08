---
tags: [branches, stage]
status: not-started
---
# Stage 2 — Household, Mock Data and Onboarding

**Goal:** two people join one household from two devices, and each confirms an inferred baseline in a few taps, in parallel.

## Starting point
Stage 1 complete: engine passes goldens.

## Read first
[[05 Data Model]] · [[11 Mock Data]] · [[06 Engine Spec#Baseline inference]] · [[03 User Journey#2. Onboarding]] · [[10 Screens#Welcome]] · [[10 Screens#Onboarding]] · [[02 Ground Rules#3. Privacy by architecture]]

## Build
1. Tables and reducers for household, member, assumption, transaction, inferred_item, gap_question, baseline, fun_money; presence via connect/disconnect.
2. `packages/mock-data`: deterministic generator for Test Household A (and demo names), plus the device-local private purchases list.
3. Inference in the engine; reducer `runInference` writes `inferred_item` rows and gap questions.
4. Screens: Welcome (start/join with code, live "waiting for partner"), Confirm what we found, Fill the gaps, Fun money, with each partner's progress visible to the other.
5. Device-local store for private purchases; client computes fun-money status and calls `setFunMoneyStatus`.
6. Dev-only "Load demo household" button and a reseed command.
7. `verify:inference`.

## Out of scope
Goals UI (Stage 3), Home content beyond a placeholder.

## Done when
- [ ] Phone and laptop join the same household by code; avatars appear live on both.
- [ ] Each partner sees only their own items to confirm, and sees the other's progress update live.
- [ ] Confirmed items produce the Test Household A baseline (income 8,800; fixed 3,000; debt 500; flexible 1,500; retirement 400).
- [ ] Private purchases exist only in device-local storage; nothing about them appears in any SpacetimeDB table.
- [ ] `verify:inference` PASS.

## Verification
`verify:inference`; manual two-device check of join + parallel onboarding; inspect database tables for absence of private purchases.

## Build Log
*(append entries here)*
