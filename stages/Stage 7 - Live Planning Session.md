---
tags: [branches, stage]
status: complete-except-two-device-run
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
- [ ] **Scripted equivalents PASS; the two-device run is outstanding.** Every row of V6 that a reducer can decide is asserted from two live clients (`verify:ready` 28/28, `verify:flow` 158/158): join, selections crossing devices, presence going absent, tuning, locks, rerolls, bridges, the commit reaching both. What still needs eyes is the *visual* half — latency feeling instant, no loading flashes, the ring filling. See the checklist at the end of this log.
- [x] **R1, R2, R4, R5, R6 PASS** — `verify:ready`, two live clients. **R3 is a property of the control, not the reducer** (a release before the hold completes must send nothing), so it is reported as a manual check rather than silently passed.
- [x] **Every step exists and is exercised** — event from a sentence, impact, cards arriving one at a time with progress text, selections showing on both screens, reactions, pins producing bridges or closest-option statements, shared tuning marked "Tuned by …", and the simultaneous hold committing. Performing it as a scene on two devices is the outstanding manual run.

## Verification
V6 checklist, V7 cases, `verify:flow` step 4 using the real ready check.

## Build Log

### 2026-11-08 — Stage 7 built

**Decisions taken before building** (asked up front):
- **The agent names branches one at a time.** `nameBranch` takes a single pick
  plus a position, and the service calls it three times with progress text
  between, so "Building branch 2 of 3…" corresponds to a row actually landing
  and both partners watch the same sequence. A client-side reveal would have been
  theatre.
- **The single-user confirm is gone, with a dev-only override.** `setReady` is
  the only real path; `commitBranchSolo` refuses the moment a partner is present,
  so it cannot quietly replace the ready check.
- **The invite banner lives on the tabs, not in onboarding.** A partner still
  confirming their accounts has no plan to hold a session about.

**Built**
- **Module** — `session_member` and `reaction` tables; `branch.tunedBy`;
  `joinSession`, `leaveSession`, `selectBranch`, `react`, `setReady` (with the
  commit rule inside it), `commitBranchSolo`, and `nameBranch` replacing
  `nameBranches`. `applyBranch` became internal. `clearReady` is now called by
  every reducer that changes what is on the table, and `clientDisconnected`
  clears session presence.
- **Service** — branch naming one card at a time with a stagger, and the
  `explain` task that writes the post-commit summary.
- **App** — the session screen rebuilt with a presence header, live selections
  with avatars and reactions, the disagreement banner, pins and bridges, shared
  tuning marked "Tuned by …", the feedback box, the **hold-to-confirm ring**
  (SVG arcs per member, 1.5s hold, haptic ticks, success haptic), the post-commit
  view, and the invite banner above the tabs.
- **Verification** — `verify:ready` (V7, 28 checks from two live clients), and
  `verify:flow`'s Stage 5 commit rerouted through the ready check.

**Verification**

| Suite | Result |
|---|---|
| `verify:ready` — V7, two live clients | **28/28 PASS** |
| `verify:flow` — Stages 2-5, commit now via the ready check | **158/158 PASS** |
| `verify:agent` / `verify:agent:e2e` | 53/53 · 67/67 · 27/27 |
| `verify:engine` / `math` / `purity` / `inference` | 66/66 · 18/18 · 14/14 · 28/28 |
| `npm run verify` | **9/9 suites behaved as expected** |
| `npm run typecheck` | clean |
| Metro bundle | web, iOS and Android all compile (1018 / 1536 / 1531 modules) |

**Decisions and notes**

1. **The hold really is simultaneous.** `onReady(true)` fires only once the hold
   reaches 1.5s, and `onReady(false)` the instant the finger lifts — so both
   people are still holding when the server commits. Reading the spec quickly
   suggests "both pressed at some point"; it says the opposite, and the control
   implements the stricter reading.
2. **The server decides, not the ring.** The commit rule lives inside
   `setReady`: every household member present, every one ready, all for the same
   branch, in one transaction. A client's clock being wrong or its code being
   patched cannot produce a commit.
3. **The agent is excluded from the ready check.** It is a `member` row with
   role `agent`, so counting every row would have made a commit impossible — the
   agent has no hands. `humanMembers` is used everywhere presence or readiness is
   counted, and `verify:flow` R4 now filters by role for the same reason.
4. **Commit requires everyone present, not merely everyone who happens to be
   here.** A decision this size should not be reachable while a partner is away.
5. **Disconnecting clears session presence**, not only `member.online`. Without
   that, a closed laptop would still count as present and the ready check could
   commit without them.
6. **`clearReady` is wired into everything that changes the table** — selection,
   tuning, locks, pins, reroll, generate, bridge, and a new card arriving.
   Otherwise two people could commit a branch that silently changed after they
   agreed to it.
7. **Idempotency comes from the session status, not from a lock.** `applyBranch`
   returns early when the session is no longer `open`, so two simultaneous
   `setReady` calls commit once (R5).
8. **Haptics are phone-only and no-op on web**, per 02 Ground Rules #6. The ring
   ticks at each quarter of the hold and fires a success notification on commit.

**Problems solved along the way**

- **`process.exit()` loses output when stdout is a pipe.** Every suite ended with
  `process.exit(...)`, which discards *buffered* stdout writes — so piping the
  runner into anything (`| tail`, a CI log collector, `run-all` itself)
  truncated a table mid-row and garbled the exit code, with no error and only
  when piped. Diagnosing it cost real time: the suite passed alone and failed
  inside `npm run verify`. Every script now ends through a shared `finish()` that
  sets `exitCode` and exits only once the stream drains.
- **Waiting on one client and asserting on the other.** `verify:flow`'s commit
  block waited for the commit to reach B, then read the result from A — whose
  cache had not caught up, so B saw `committed` while A still saw `open`. It read
  as a broken ready check. Exactly the trap Stage 3 hit with goal edits; the fix
  is the same, and it makes the assertion stronger because it proves *both*
  devices converge.
- **A live agent joins the household a test just created**, and may post into it
  mid-run. Correct behaviour, so the scripts tolerate it: `verify:flow` R4
  filters members by role and R9 ignores agent-authored text. Recorded in
  [[16 Dev Environment]], along with the fact that `pkill -f
  "services/agent/src/index.ts"` matches nothing — the service runs as
  `node ... src/index.ts`.
- **A plain `export const` breaks a SpacetimeDB module.** `export const
  READY_HOLD_MS` failed schema inspection with "exporting something that is not
  a spacetime export" — named runtime exports are reserved for registered
  values. Worth knowing: **`spacetime build` and `publish` both accepted it**;
  only `generate` caught it.

**The outstanding manual run (V6)**

Everything a reducer can decide is asserted. What needs two devices and a pair
of eyes:

- [ ] Both avatars appear within ~1s of joining, absent ones dimmed.
- [ ] A goal added on one device pulses in the author's colour on the other.
- [ ] The invite banner appears on the second device and opens the session.
- [ ] Branch cards arrive **one at a time** with "Building branch n of 3…".
- [ ] Selections and reactions cross within ~1s.
- [ ] A slider moved on one device moves the stats on the other, marked
      "Tuned by …".
- [ ] Locks and pins appear on both; reroll and bridge results appear on both.
- [ ] Disconnecting one device marks it absent within ~5s and hides the ring.
- [ ] No screen flashes to a loading state during edits.
- [ ] **R3**: releasing the ring before 1.5s sends nothing — no "ready" on the
      partner's screen.
- [ ] Both holding completes the ring and updates the timeline on both.

**Open**

- **Maincloud is six schemas behind.**
- **OPEN(OD-6)**: the 1.5s hold is unconfirmed by anyone actually holding it.
- The post-commit agent summary is wired but only exercised against the mock.
- Push notifications remain **OPEN(OD-10)**; the in-app banner is the shipped
  behaviour.

