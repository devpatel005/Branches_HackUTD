---
tags: [branches, stage]
status: complete
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
- [x] **PASS** — `verify:engine` E8a/E8b and `verify:flow` S5b-S5e, out of a reducer. Order `m:175`, `d:house=9|m:75`, `d:house=18`; names "Save $175 more a month", "Balanced", "Move House to Mar 2031".
- [x] **PASS** — `verify:engine` E9a/E9b for all three, and `verify:flow` S5i/S5j confirm each shown branch funds every goal.
- [x] **PASS** — `verify:engine` C1-C5 and `verify:flow` L1-L6. Note that Test Household A has exactly **three** paths out of E5, so a reroll after the first batch correctly reports exhaustion in the documented words.
- [x] **PASS** — `verify:engine` B1-B3 and `verify:flow` P1b-P5b. Conflicting pins (Japan on time + no extra saving) yield the closest-option statements, deterministically and with no AI tiebreaker.
- [x] **PASS** — `verify:flow` T5-T10: tuning changes the stats, marks the branch `custom`, reaches the partner, clamps $99,999 to the $375 cap, and refuses a shrink on a must-have goal.
- [x] **PASS** — **66/66**, E1 through E10 with no stubs remaining.

## Verification
`verify:engine`, `verify:flow` steps 3–4.

## Notes for Claude Code
The candidate rules are v1 and expected to change (OD-3). Keep generation, ordering, and naming in separate, clearly named functions so the team can swap rules without touching the UI.

## Build Log

### 2026-11-08 — Stage 5 built

**Decisions taken before building** (asked up front):
- **The `session` table was pulled forward from Stage 7**, and the Session screen
  built single-user as this stage allows. Candidates, constraints and reroll
  exclusions hang off a real session id, so Stage 7 adds presence, selections,
  reactions and the ready check to an existing screen. Same reasoning as pulling
  `chat_message` forward for Stage 4, which paid off.
- **A committed `saveMore` is stored as a decision, not an edit to the
  baseline.** `plan_commitment` holds it, so the baseline keeps meaning "what
  your transactions show" while the plan carries "what we decided". Reversible,
  visible, and re-running inference cannot silently undo it.
- **A committed delay keeps the original target.** `goal.originalTargetMonth`
  stays behind so Timeline and Goal Detail can show the move, and so a later
  event's branches measure delays from the real original rather than an
  already-delayed date.

Measured before asking a fourth question: the full minimal-lever search for E5
takes **15 ms** and a single 120-month simulation ~0.1 ms, so generating
candidates inside a reducer needed no caching or limits.

**Built**
- **Engine** (`packages/engine/src/branches.ts`) — constraint shapes and
  `satisfiesConstraints`, constraint-aware minimal lever searches,
  `generateCandidates`, `orderCandidates`, `leverSetSignature`, `statsFor`,
  `templateName` / `templateSummary`, `generateBridges` and `closestOption`.
  Generation, ordering and naming are **separate exported functions**, per this
  stage's note, so OPEN(OD-3) can be swapped without touching the module or UI.
- **Module** — `session`, `branch_candidate`, `branch`, `constraint` and
  `plan_commitment` tables; `goal` gained `originalTargetMonth` and
  `committedShrinkPct`; reducers `startSession`, `generateCandidates`, `reroll`,
  `addConstraint`, `removeConstraint`, `requestBridge`, `tuneLever`,
  `commitBranch` and `closeSession`.
- **App** — the Session screen with branch cards, stat lines, selection, lock
  chips, reroll, the pin sheet, the adjust sheet with per-lever steppers, and the
  temporary single-user confirm. "Start planning session" on the impact card now
  opens it.
- **Verification** — `verify:engine` E6-E9 unstubbed plus C1-C6 and B1-B3;
  `verify:flow` gained 42 Stage 5 checks.

**Verification**

| Suite | Result |
|---|---|
| `verify:engine` — **all of E1-E10**, plus constraints and bridges | **66/66 PASS** |
| `verify:flow` — Stages 2, 3, 4 **and** 5 | **158/158 PASS** |
| `verify:math` / `purity` / `inference` | 18/18 · 14/14 · 28/28 |
| `npm run verify` | **7/7 suites behaved as expected** |
| `npm run typecheck` | clean |
| Metro bundle | web, iOS and Android all compile (995 / 1513 / 1510 modules) |

**Decisions and notes**

1. **Test Household A has exactly three paths out of E5**, and the first
   generation shows all three. So a reroll immediately reports "These are all
   the paths that fit what you've locked" — the documented exhaustion behaviour
   (OPEN(OD-5)), not a failure. My first version of the check waited for a new
   batch and timed out; it now asserts the real behaviour. Worth knowing for the
   demo: **the demo profile needs more candidates than the fixture** if rerolling
   is meant to be shown off (feeds OD-1).
2. **One input builder, used everywhere.** `recomputeProjection` had its own copy
   of the baseline/goals/assumptions assembly, which would have meant the
   committed `saveMore` applied to branch candidates but **not** to the plan they
   were measured against. Both now go through `simulationInputFor`.
3. **A committed shrink is folded into the effective cost**, not passed as a
   lever. If it were a lever, a *new* shrink on the same goal would replace it
   rather than compound; folding it in means the next lever applies on top. The
   stored `costTodayCents` stays the original, for the record.
4. **A deliberate goal edit re-aims the goal** — `originalTargetMonth` moves with
   it. Only a committed branch leaves the original behind, because only then is
   there a decision worth showing.
5. **Slider values clamp rather than reject.** A slider should never throw, so
   `tuneLever` rounds `saveMore` to $25 steps and clamps to the cap, and clamps
   delays and shrinks into the lever's domain. Shrinking a must-have goal is
   still refused outright, since its domain is empty by design.
6. **The adjust sheet uses steppers, not a drag track.** A real slider needs a
   gesture library for a decent feel, which is Stage 8's call; the reducer clamps
   regardless, so neither form can send an invalid value.
7. **The engine names branches by goal id**, since it holds no titles and no
   calendar. The module substitutes the real title and supplies a month label.
   That keeps `packages/engine` free of database concerns and `verify:purity`
   green.
8. **Branch summaries are checked for advice language.** `verify:flow` S5g
   asserts no summary contains "should", "recommend" or "best option"
   (02 Ground Rules #2) — worth having before the agent can write them in
   Stage 6.

**Open**

- **Maincloud is four schemas behind.** Destructive republish, needs a person.
- **Visual checks unrun** — branch cards, the adjust sheet, pin chips and the
  reroll exhaustion message are bundle-verified but need eyes.
- **The commit is a single tap**, as this stage specifies. Stage 7 replaces it
  with the press-and-hold ready check.
- **The demo fixture only yields three branches.** Fine for the goldens, thin for
  showing reroll on stage — relevant to OD-1's demo profile.
- Candidate rules remain **OPEN(OD-3)**; `generateCandidates`, `orderCandidates`
  and `templateName` are separate so they can be replaced independently.
- Reactions, presence and live selection are Stage 7; the session screen has
  placeholders for none of them yet, deliberately.

