---
tags: [branches, stage]
status: complete
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
- [x] **PASS (scripted)** — `verify:flow` F1-F9: two independent clients, one household, avatars and names propagate live. Phone deferred by OD-18 ([[16 Dev Environment]]); two browser tabs stand in.
- [x] **PASS** — `verify:flow` P1-P11. Enforced by **row-level security**, not by the UI: A receives 8 of the 16 items and **zero** of B's transactions. Progress still shows, from a counts-only view.
- [x] **PASS** — `verify:flow` B1-B6, and `verify:inference` B9-B11 additionally prove the inferred baseline reproduces Stage 1's E2/E3 goldens.
- [x] **PASS** — `verify:flow` C1-C2 greps every row any client can read for the canary merchant names. Also architectural: `src/private-purchases.ts` has no SpacetimeDB import at all.
- [x] **PASS** — 28/28.

## Verification
`verify:inference`; manual two-device check of join + parallel onboarding; inspect database tables for absence of private purchases.

## Build Log

### 2026-11-07 — Stage 2 built

**Decisions taken before building** (asked up front):
- **Row-level security, plus a counts-only progress view.** 05 Data Model says to
  use per-client filtering if it exists, and Stage 0 found it does.
- **2 gap questions; the balance range only if the answer is "Investing".** This
  resolves the conflict between 11 Mock Data (expects exactly 2) and
  03 User Journey ("no balance needed in v1") — see below.
- **Screens styled to the design system, without motion.** Stage 8 owns pulses,
  number rolling and haptics.

**Built**
- `packages/engine/src/inference.ts` — the deterministic rules from
  [[06 Engine Spec#Baseline inference]], the recurring test, gap-question
  generation, and `baselineFromItems` to roll confirmed items into a baseline.
  No LLM anywhere near it.
- `packages/mock-data` — seeded generator for Test Household A plus the
  device-local private-purchase list. `mulberry32` PRNG, no runtime randomness.
- `server/spacetime` — eight tables (`household`, `member`, `assumption`,
  `transaction`, `inferred_item`, `gap_question`, `baseline`, `fun_money`),
  presence via connect/disconnect, three **row-level security policies**, an
  `onboarding_progress` view, and reducers: `createHousehold`, `joinHousehold`,
  `setDisplayName`, `seedMockData`, `runInference`, `confirmItem`, `editItem`,
  `rejectItem`, `confirmAllMyItems`, `answerGap`, `setFunMoney`,
  `setFunMoneyStatus`, `finishOnboarding`, `reseedHousehold`.
- `apps/mobile` — Welcome (start / join / waiting-for-partner with the code
  shown large), Confirm what we found, Fill the gaps, Your fun money, a route
  gate that sends each device to the right step, shared design-system
  primitives, and a Home placeholder showing the confirmed baseline.
- `apps/mobile/src/private-purchases.ts` — the entire lifetime of a private
  purchase, with **no SpacetimeDB import**.
- `scripts/verify/inference.ts` (V3) and `scripts/verify/flow.ts` (V4, Stage 2
  portion).

**Verification**

| Suite | Result |
|---|---|
| `verify:inference` — the expected table, gap questions, determinism, privacy | **28/28 PASS** |
| `verify:flow` — two clients end to end through onboarding | **47/47 PASS** |
| `verify:math` / `verify:engine` / `verify:purity` — still green | 18/18 · 41/41 · 14/14 |
| `verify:stdb` — Stage 0 path still green | 8/8 |
| `npm run verify` | **7/7 suites behaved as expected** |
| `npm run typecheck` | clean |
| Metro bundle | web, iOS and Android all compile (927 / 1357 / 1354 modules) |

Inference matched the expected table in [[11 Mock Data#Expected inference output]]
exactly — all 16 rows, in order, to the cent — on the first run.

**Decisions and notes**

1. **Row-level security is real, and `verify:flow` proves it with two clients.**
   `clientVisibilityFilter.sql('... WHERE owner_identity = :sender')` on
   `transaction`, `inferred_item` and `gap_question`. A receives 8 of the 16
   items and **zero** of B's transactions. This is stronger than the spec's
   fallback position ("acceptable because all data is mock") and it means the
   agent — an ordinary client — can never subscribe to a transaction at all.
   Rows carry `ownerIdentity` next to `ownerMemberId` so the filter can key on
   `:sender` directly.
2. **Partner progress comes from a separate `onboarding_progress` view** that
   returns counts, names and colours and nothing else. Deliberately a different
   surface from the filtered tables, so widening what the UI *shows* cannot
   accidentally widen what it can *read*. `verify:flow` P11 asserts the exact
   column set.
3. **Money columns are `i32` cents, not `i64`.** i32 tops out near $21.4M, far
   beyond any household plan, and it keeps money out of JavaScript `bigint` —
   which `JSON.stringify` refuses to serialize. That would have infected every
   projection payload from Stage 3 onward. Row ids stay `u64` because `autoInc`
   requires it, and `verify:flow` needed a BigInt replacer for exactly that
   reason. Assumptions are stored in basis points for the same reason.
4. **The gap-question conflict, resolved.** Each brokerage transfer asks one
   choice question. "Retirement" settles it — set aside, no balance needed in v1.
   "Investing" reclassifies the item as `external_account` (a kind
   [[05 Data Model]] already defines but nothing used) and *then* asks the
   balance range. Test Household A answers both "Retirement", so exactly 2
   questions appear, matching 11 Mock Data, while the spec's balance range still
   has a home.
5. **No merchant can ever look recurring, structurally.** The generator uses a
   30-name pool at 5 merchants a month over 12 months, so each name appears in
   exactly **2** distinct months and the recurring test needs 3. That is a
   guarantee rather than a hope about random amounts. `verify:inference` I6/I7
   assert it, so generator drift fails loudly.
6. **All merchant outflows route to flexible**, not only non-recurring ones as
   the spec words it. Leaving a group unclassified would silently drop money out
   of the baseline, and a wrong baseline is far harder to spot than a wrong
   category. Since I6/I7 prove no merchant recurs, the two behaviours coincide
   today — this is belt-and-braces, not a divergence in effect.
7. **Nothing new is seeded in `init`.** Stage 1's Maincloud publish showed that
   `init` never re-runs on a module update, so anything seeded there goes stale
   silently ([[14 Research Notes]]). Baselines are built by `recomputeBaseline`
   on every change, and demo data comes from the explicit `seedMockData`.
8. **`reseedHousehold` keeps the household, both members and the join code**, and
   keeps the transactions so inference can re-run. Two devices stay paired across
   a reset, which is what makes it usable between demo runs (R1-R7).
9. **The module does its own date arithmetic instead of using `new Date`.** The
   SpacetimeDB guide says stdlib clocks are unavailable in modules, and a build
   cannot catch it. `currentMonthFrom` converts `ctx.timestamp` with integer
   maths, checked against `Date` across 4,286 dates spanning 82 years with zero
   mismatches.
10. **The route gate never redirects on empty-but-not-ready tables.** Doing so
    would bounce a user to Welcome for a frame on every reload *and* on every
    reducer call, because of the `isReady` flashing bug
    ([[14 Research Notes#SpacetimeDB]]).

**Problems solved along the way**

- **A view's accessor name collides with its row type.** Naming the row type
  `OnboardingProgress` next to an `onboarding_progress` view fails schema
  inspection with "name is used for multiple types". Renamed to `MemberProgress`.
  The SpacetimeDB guide warns about this; it is easy to walk into anyway.
- **Reducers take a single object argument**, not positional ones —
  `confirmItem({ itemId })`, not `confirmItem(itemId)`. Stage 0's only reducer
  took no arguments, so this surfaced here.
- **`verify:flow` initially grabbed an arbitrary household**, because the table
  accumulates rows across runs. It now finds its own via its own member row,
  which makes it repeatable regardless of leftovers.

**Open**

- **Maincloud is one schema behind.** The local server has Stage 2; Maincloud
  still has the Stage 0 schema. Republishing is a breaking change that wipes the
  remote test data, and `npm run stdb:publish` deliberately does **not**
  auto-approve destructive prompts, so this needs a person:
  `spacetime publish --module-path server/spacetime --server maincloud --delete-data=on-conflict --yes=remote,migrate,break-clients,delete-data branches`
- **Two-device check** is still scripted rather than run on a phone (OD-18).
- Goals, the real Home and "show the math" are
  [[Stage 3 - Goals and Timeline]]. Onboarding's step 4 (the shared goal picker)
  belongs there too, per the stage split.
- `liquidSavings` has no onboarding question; it is seeded from the fixture.
  03 User Journey asks for a balance *range* for external accounts only, so this
  is consistent with v1 — worth confirming before the demo.

