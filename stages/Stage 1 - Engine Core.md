---
tags: [branches, stage]
status: complete
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
- [x] **PASS** — 18/18.
- [x] **PASS** — 41/41, including provenance and series checks.
- [x] **PASS** — enforced by walking the output, not a hand-kept list.
- [x] **PASS** — `verify:purity`, 14/14; also zero runtime dependencies.

## Verification
`verify:math`, `verify:engine`.

## Notes for Claude Code
If a golden fails, re-read [[06 Engine Spec#Monthly simulation]] step by step (order of interest, payment, settlement, and emergency update matters) before changing anything.

## Build Log

### 2026-11-07 — Stage 1 built

**Decisions taken before building** (asked up front):
- **Provenance is a flat keyed map** on the output (`provenance['goals.japan.requiredMonthlyAtStart']`),
  not co-located with each value. Keeps the goldens comparing plain numbers, and
  makes "every number has provenance" a walkable invariant rather than a promise.
- **`series` carries all 120 months plus derived yearly samples.** Ten points is
  too coarse for the scrubbable chart in [[09 Design System]]; monthly is a few
  KB of JSON.
- **If a golden would not reproduce**, proceed with the most faithful reading and
  flag it. Never needed — see below.

**Every golden reproduced on the first attempt.** Before writing the real engine
I prototyped the monthly simulation in a throwaway script and checked it against
E1-E5. All matched exactly, including E6, E7 and E9 (Stage 5 scope), which means
the reading of the `baby` template and of the allocation order is right. No
interpretation call was needed and no golden is in doubt.

**Built**
- `types.ts` — `Baseline`, `Goal`, `Levers`, `LifeEvent`, `EventEffects`,
  `SimulationInput/Output`, `Provenance`. Money is floating-point dollars
  throughout; cents happen only at output.
- `formulas.ts` — F1-F5 with `r = 0` handling (F2 degenerates to F1, F4 to
  `P/n`), plus unrounded `inflateRaw` and `requiredPaymentRaw` for the inner
  loop, so rounding never accumulates across 120 months.
- `assumptions.ts` — defaults (4.00% savings `// OPEN(OD-7)`, 2.70% inflation,
  6.25% / 7.00% loan rates) and `emergencyFloor` `// OPEN(OD-8)`.
- `events.ts` — all six templates as **data** with parameter specs, bounds and
  `asked` flags, plus `compileEvents` flattening them to per-month arrays. Every
  cost is marked `// OPEN(OD-2)`; nothing outside this file hard-codes one.
- `simulate.ts` — the monthly simulation exactly as specified: allocation order,
  per-month recomputation of `required`, settlement with excess rolling into the
  emergency fund, the tight-month rule, and the full output surface.
- `impact.ts` — `computeImpact`, with-event versus without, distinguishing
  **newly** at-risk goals from ones already at risk so the UI doesn't blame the
  event for a pre-existing problem.
- `levers.ts` — lever domains and the minimal-lever search (see the scope note
  below).
- `affordability.ts` — `checkAffordability`, answering in time as well as dollars.
- `fixtures.ts` — Test Household A and the E4/E5 events.
- `scripts/verify/engine.ts` and `scripts/verify/purity.ts`; `math.ts` extended
  to the full F1-F5 set.

**Verification**

| Suite | Result |
|---|---|
| `verify:math` — F1-F5, `r = 0` cases, money rounding | **18/18 PASS** |
| `verify:engine` — E1-E5, E10, provenance, series | **41/41 PASS** |
| `verify:purity` — no time, randomness or I/O in the engine | **14/14 PASS** |
| `verify:stdb` — Stage 0 data path, still green | **8/8 PASS** |
| `npm run verify` | **5/5 suites behaved as expected** |
| `npm run typecheck` | clean |

Golden-by-golden: E1a/E1b (5,273.65 / 45,699.58), E2a/E2b (211.43 / 689.30),
E3a-E3g (no risk, no tight months, freeToPlan 1,899.28, floor 10,500,
4.29 months of runway, allocation order `[house, japan]`), E4a-E4d (no impact),
E5a-E5j (Japan at risk with a **2,183.97** shortfall, House funded, tight months
**9-23**, tight years [1, 2]), E10 across five scenarios.

**Done when**
- [x] `verify:math`: F1-F5 and `r = 0` cases PASS.
- [x] `verify:engine`: E1-E5 and E10 PASS.
- [x] Every number in the output has a provenance record — enforced by walking
      the output (`P1`/`P2`), not by a hand-maintained list, so a new output
      field cannot ship without provenance.
- [x] Engine has no imports of I/O, time or randomness — enforced statically by
      `verify:purity`, which also asserts the engine has **zero** runtime
      dependencies and imports nothing outside itself.

**Decisions and notes**

1. **The minimal-lever search landed in Stage 1, not Stage 5.** Stage 1 requires
   the affordability check, and [[06 Engine Spec#Affordability check]] requires
   it to report "the minimal delay for each affected goal and the minimal
   `saveMore`" so answers can be phrased in time. That needs the lever search.
   It lives in its own `levers.ts` with the domains from
   [[06 Engine Spec#Levers]]. **Candidate generation, ordering and naming remain
   Stage 5** (OPEN(OD-3)) — this is only the search those rules sit on.
2. **Allocation order is worth internalising**: must-have first, so the House
   (month 60, must) is funded ahead of Japan (month 24, flexible). That is
   exactly why E5 puts *Japan* at risk and why delaying the House is what
   rescues it. The order is a documented comparator, not an accident of
   insertion.
3. **An affordability purchase is modelled as a `medical_bill`-shaped one-time
   cost at month 0.** Reusing `windfall` with a negative sign would have been
   clever and unreadable.
4. **Impact separates newly-at-risk from already-at-risk.** The spec asks for
   "newly at-risk goals"; carrying both means Stage 4's impact card can avoid
   attributing a pre-existing shortfall to the event.
5. **`emergencyMonthsNow` and `emergencyMonthsMin` are rounded to 2 decimals,
   not to cents.** They are months of runway, not money.
6. **E10 is stronger than "run it twice".** It also swaps `Date.now` for a fixed
   value mid-run and asserts the output is byte-identical, so a future accidental
   clock read fails loudly. `verify:purity` catches the import before that.
7. **`ENGINE_VERSION` moved to `0.1.0-stage1`**, so the Stage 0 module was
   rebuilt and republished. `verify:stdb` D3/D4 now compare against the engine's
   own values rather than literals, which turns that check into a **stale-publish
   detector**: if the published module and the local engine disagree, D4 fails.

**Problem solved along the way**

`spacetime login` (run by the team between stages) changed the CLI's active
identity, and the local `branches` database had been created by the earlier
server-local identity. Publishing then failed with `403 Forbidden: not
authorized to ... update database`, and `spacetime delete` failed the same way.
Resolved with `spacetime server clear` plus a server restart — the data dir is
deleted on disk but a running server keeps its state in memory, so the restart
is required. Contents were checked first and were only the Stage 0 counter.
Worth knowing before the demo: **logging in after creating a local database
orphans it.** Recorded in [[16 Dev Environment]].

**Open**

- OD-17 (negative rounding ties) is still parked, and Stage 1's goldens now
  inherit the current choice. No golden distinguishes the two options — see
  [[15 Money and Rounding]].
- E6-E9 report as **PENDING** in `verify:engine`, per this stage's scope. The
  prototype confirmed all three expected values, so Stage 5 should reproduce
  them: `delay(japan)` null, `shrink(japan)` null, `delay(house)` 18,
  `saveMore` 175, and the balanced pair `delay(house, 9) + saveMore(75)`.
- `packages/mock-data` is still an empty placeholder until
  [[Stage 2 - Household, Mock Data and Onboarding]]. Stage 1's Test Household A
  fixture lives in `packages/engine/src/fixtures.ts`, as this stage specified;
  Stage 2 may want to move it.

