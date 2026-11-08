---
tags: [branches, stage]
status: complete
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
- [x] **PASS** — `verify:flow` S4-S12, read back out of `plan_projection` after two clients added the goals through reducers. Japan **211.43**, House **689.30**, free to plan **1,899.28**, emergency fund **4.29 months**.
- [x] **PASS (scripted)** — `verify:flow` S1-S3, S23, S27: a goal added by B reaches A, an edit by A reaches B, a removal reaches both. The pulse is implemented and renders in the author's colour; seeing it is a manual check (OD-18).
- [x] **PASS** — every tappable number resolves a provenance path; `verify:flow` S16-S18 assert provenance travels with the projection and carries readable text, and `verify:engine` P1/P2 assert coverage by walking the output.
- [x] **PASS** — `verify:flow` S20-S22: the savings rate bumps the projection version, lowers the required monthly, and an absurd rate is rejected.
- [x] **PASS by construction** — `shouldShowLoading` only shows a loading state when there are no rows **and** the table is not ready, and the route gate never redirects on empty-but-not-ready tables. Visual confirmation is a manual check.

## Verification
`verify:flow` steps 1 (see [[12 Verification#V4 Data flow]]); V6 checklist items for goals.

## Build Log

### 2026-11-07 — Stage 3 built

**Decisions taken before building** (asked up front):
- **The chart plots total savings** — the emergency fund plus every unsettled
  goal balance — not the emergency fund alone. It rises as money accumulates and
  visibly **drops** when a goal is paid for, which is what makes a goal marker
  on the line mean something.
- **Goals can be added from Timeline**, not only during onboarding.
  [[10 Screens]] puts the picker in onboarding and shows no way back, which
  would freeze the plan the moment onboarding ended.
- **Liquid savings is asked as a range gap question.** It drives the
  emergency-fund stat on Home and cannot be inferred from a transaction stream,
  so leaving it seeded meant a prominent number nobody ever gave us.

A fourth question answered itself: the full `SimulationOutput` for Test
Household A is **13.6 KB** including the 120-month series and all provenance, so
`plan_projection` stores one JSON blob rather than splitting across columns.

**Built**
- **Engine** — `MonthSample.totalSavings` (the chart's single series),
  `LIQUID_SAVINGS_RANGES` with midpoints, `liquidSavingsGapQuestion` and
  `liquidSavingsFromRange`.
- **Module** — `goal` and `plan_projection` tables; `addGoal`, `editGoal`,
  `removeGoal`, `setAssumptions`; and `recomputeProjection`, which runs the
  **engine inside the reducer** and stores the result. `recomputeBaseline` now
  chains into it, so every existing plan-changing reducer recomputes for free.
  `reseedHousehold` clears goals and the projection too.
- **App** — the scrubbable `ProjectionChart` (`react-native-svg` +
  `PanResponder`), `Pulse`, the `Sheet` / `ShowTheMath` / `GoalDetailSheet` /
  `AssumptionsSheet` family, the shared `AddGoalSheet` goal picker, a rebuilt
  **Home** (hero, chart, stat row, goal list), a rebuilt **Timeline** (ten years,
  goals at their target months, tight years tinted), and the **goals** step of
  onboarding.
- **Verification** — `verify:flow` gained 28 Stage 3 checks (S1-S28).

**Verification**

| Suite | Result |
|---|---|
| `verify:flow` — now covers Stage 2 **and** Stage 3 | **76/76 PASS** |
| `verify:engine` / `verify:math` / `verify:purity` / `verify:inference` | 41/41 · 18/18 · 14/14 · 28/28 |
| `npm run verify` | **7/7 suites behaved as expected** |
| `npm run typecheck` | clean |
| Metro bundle | web, iOS and Android all compile (966 / 1484 / 1481 modules) |

The Stage 3 goldens now come **out of a reducer** rather than out of a script,
which is the part that matters: E1-E3 survive the round trip through integer
cents, basis points, JSON and two clients.

**Decisions and notes**

1. **The engine runs inside the reducer, and the app does no plan arithmetic.**
   `useProjection` parses what the reducer stored; `recomputeProjection` converts
   integer cents and basis points into the engine's dollars and rates and stores
   what comes back. There is no plan arithmetic in `apps/mobile` to get wrong,
   which is how 02 Ground Rules #1 stays true rather than aspirational.
2. **`plan_projection.version` is the cache key and the pulse trigger.** Parsing
   13 KB of JSON on every render would be wasteful, and `version` changes on
   exactly the events that matter. `lastChangedBy` rides along so the UI can
   pulse in the actor's colour.
3. **The pulse never fires for your own edit, and never on first render.**
   Pulsing your own change feels like the app arguing with you, and pulsing on
   mount would flash the whole screen on load. Built on React Native's
   `Animated` rather than Reanimated — a one-shot fade needs nothing more, and it
   keeps the dependency list to what Expo Go ships.
4. **Liquid savings is asked per member and summed.** Each partner knows their
   own accounts. Both answering "$5-10K" sums to exactly **$15,000**, which is
   Test Household A's documented starting balance, so the fixture and the
   question agree.
5. **The liquid-savings question is deliberately *not* part of `inferBaseline`'s
   output.** Inference reports gaps it *found* in the transactions; an account
   balance never appears in a transaction stream. Keeping it separate is also
   what lets [[11 Mock Data#Expected inference output]] keep expecting exactly
   **2** inferred gap questions — `verify:inference` I3 still passes untouched.
6. **"By year N" means the end of plan year N**, so a target year maps to month
   `N x 12`. Picking a year rather than a month is far fewer taps, and the
   projection only needs the month index.
7. **An assumption above 50% is rejected.** 0% is legitimate — 06 Engine Spec
   defines the `r = 0` behaviour — but a fat-fingered 90% would quietly produce
   nonsense projections rather than an error.
8. **A member with no confirmed income is still placed in the income map.**
   Otherwise the simulation silently drops their fun money and their income
   override slot, which would matter the moment Stage 4 applies a `job_loss`.

**Problems solved along the way**

- **`verify:flow` asserted B's state after waiting only for A's.** Two checks
  failed intermittently. Waiting on **B** before asserting B both fixes it and
  strengthens the assertion: it now proves the partner's device actually
  converged, rather than that A's did.
- **Shared tables accumulate across runs on a local database.** `goal`,
  `plan_projection` and `baseline` have no row-level security, so reading them
  unscoped picked up three earlier runs' goals and the run timed out waiting for
  "exactly 2". The script now scopes every shared-table read to its own
  household. Worth remembering for every later stage's flow checks.
- **RN 0.88's generated types expose `StyleSheet.absoluteFill`, not
  `absoluteFillObject`.**
- **TypeScript will not carry an early-return narrowing into a hoisted function
  declaration**, since it could in principle be called later.

**Open**

- **Maincloud is now two schemas behind.** Still a destructive republish, still
  needs a person. Command in the Stage 2 Build Log.
- **The visual checks are unrun**: the pulse actually pulsing, the chart
  actually scrubbing, and "no loading flashes" are all implemented and
  bundle-verified but need eyes (OD-18).
- **`emergencyMonthsNow` vs `emergencyMonthsMin` on Home.** Home shows the
  *minimum* across ten years, since that is the honest health indicator;
  06 Engine Spec lists both. Worth confirming which the stat row should lead with.
- OD-17 (negative rounding ties) still parked, and more derived numbers now
  inherit it.

