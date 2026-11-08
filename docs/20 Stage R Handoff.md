---
tags: [branches, handoff, stage-r]
status: active
---
# 20 Stage R Handoff

Written 2026-11-08, before a context compaction, at the point where **Stage R is
planned and approved but no code has been written**.

> **Superseded in part, 2026-11-08: R1 is built and verified.** §3 below is now
> a record of what was done rather than what to do; the build log in
> [[stages/Stage R - Branches Remediation]] has the delta, including the one
> decision taken beyond the plan (`applyEventInterpretation` gained a
> `memberId` parameter). §5's repo state is stale. Next action is **R2**.

Read in this order: [[CLAUDE]] → this file → [[19 Stage R Plan]] →
[[stages/Stage R - Branches Remediation]]. §1 and §6 are the two sections that
would otherwise have to be rediscovered.

---

## 1. Where things stand in one paragraph

Stages 0–8 pass 1 are built and verified. Stage R is a **remediation**: the
product as built is not the product in the vision. The audit found the reason,
and it is much smaller than it looked — the free-text → LLM → structured-event
path is *already built end to end*, as is every piece of the Branches session.
The chain simply **stops twice, both times in the client**, so the session never
opens by itself and the second partner is never pulled in. [[19 Stage R Plan]]
has the full plan; R1–R3 are the spine and the only phases that must land. The
plan is **approved with three decisions settled** (§4). Next action is to build
R1.

---

## 2. The audit result, so it is never re-derived

This already works, with no changes needed:

```
sendMessage(text)                                 server/spacetime/src/index.ts:1273
  └─ queueJob 'interpret_event'                   index.ts:1297
       (or 'translate_feedback' when a session is open)
       └─ agent service                           services/agent/src/index.ts:402
            └─ applyEventInterpretation           index.ts:2566
                 templateId + parsed params + follow-up chips
                 └─ answerEventParam              index.ts:1091   chips → draft becomes active
                      └─ computeImpact            index.ts:1137   impact row
```

Also already built and verified: branch generation and ordering
(`generateCandidates` `index.ts:1687`), rerolls that exclude what was shown
(`reroll:1709`), locks and one-pin-per-member (`addConstraint:1739`), bridge
branches and deterministic closest-option statements (`requestBridge:1791`),
live tuning (`tuneLever:1850`), presence, selections, reactions, the
hold-to-confirm ready check (`setReady:2129`, `src/ready-ring.tsx`), the
idempotent commit, and the event being marked `applied` (`index.ts:1977`).

**The four real gaps:**

1. **The chain stops twice.** `computeImpact` is fired by a `useEffect` *on the
   Chat screen* (`apps/mobile/app/(tabs)/chat.tsx:95`) — if nobody is looking at
   Chat, nothing computes. `startSession` is fired by a **button**
   (`apps/mobile/src/impact-card.tsx:133`). The Branches match never starts on
   its own.
2. **The digest is invisible.** The agent parses the sentence, then posts either
   a follow-up question or the bare template label. Nobody sees what the model
   understood, and there is no way to correct it.
3. **Only one partner is in it.** The banner (`src/invite-banner.tsx`, mounted in
   `(tabs)/_layout.tsx:21`) works, but only appears after the first partner taps
   through — and it **hides once joined, with no route back**. A partner who
   closes a session is stranded. There is no "Decision waiting" anywhere; the
   string has zero hits in the repo.
4. **Money values cannot be typed.** `PinSheet` in `app/session.tsx` is a
   hardcoded option list ending in a literal `Save at most $100/mo`.

Two stale artefacts to clean up while passing through:

- `app/(tabs)/index.tsx:184` still reads **"Life events and branches arrive in
  the next stage."** — a Stage-3 placeholder sitting where Home's primary action
  belongs.
- `app/(tabs)/timeline.tsx`'s doc comment claims "applied life events as
  markers (Stage 4)". There is no such code.

---

## 3. Start here: R1 in concrete terms

Extract the bodies of three reducers into plain internal functions that take
`ctx` and do **no authorisation of their own**:

```
computeImpactFor(ctx, event)           ← from computeImpact       index.ts:1137
openSessionFor(ctx, household, event)  ← from startSession        index.ts:1633
generateFor(ctx, sessionRow)           ← from generateCandidates  index.ts:1687
```

The existing public reducers keep their `requireHuman(ctx)` and become thin
wrappers, so the permission model does not change. Then add one internal
function:

```
advanceEvent(ctx, event)
  if event.status !== 'active'   → return    (follow-ups still outstanding)
  if the household has no goals  → post a system message, return
  impact = computeImpactFor(ctx, event)
  if impact.noImpact             → post the "nothing changes" card, return
  session = openSessionFor(ctx, household, event)
  generateFor(ctx, session)
  queueJob 'select_branches'
```

Called from exactly three places and nowhere else: the tail of
`answerEventParam` (`:1091`), the tail of `applyEventInterpretation` when there
are no follow-ups (`:2566`), and the tail of `createEvent` (`:1054`) so the form
path behaves identically to the typed path.

**The gotcha that is the whole reason this was never wired.**
`applyEventInterpretation` is called by the **agent**, and both `computeImpact`
and `startSession` begin with `requireHuman(ctx)`. The helper split above is
what makes the chain legal: the agent may *advance* an event it just
interpreted, every number still comes from the engine inside a reducer
([[02 Ground Rules]] #1 and #7), and the agent still cannot commit a plan.

**Then delete the client-side duplicates**, or there will be two sources of
truth: the `computeImpact` effect and its `attempted` ref in `chat.tsx:95`, and
the `generated` ref and its effect in `app/session.tsx:103`.

**Risk, and the agreed mitigation.** R1 puts interpretation, impact, session
creation and candidate generation in one transaction, so a throw halfway rolls
back the agent's parse too. `advanceEvent` must therefore **return early rather
than throw** for the three non-exceptional cases above. Only genuine engine
failures should roll back.

---

## 4. Decisions settled — do not re-litigate

Taken 2026-11-08, before any code.

| Decision | Settled | Why |
|---|---|---|
| Projection display | **One shared chart** (R4a) | The impact becomes the session header, rendering the already-persisted `impact.seriesAfter` (`src/events.ts:38`) through the existing `ProjectionChart` (`src/chart.tsx`). Pure layout |
| — rejected | Per-branch curves (R4b) | Needs a new series field on `CandidateStats` (`packages/engine/src/branches.ts:100` has none), re-pinning E6–E8, and three 120-month series on the wire for every reroll and every `tuneLever` call — a path already throttled to ~10/s. Degrades a signature moment to decorate a comparison the stat chips already make. **Sparklines are a stretch goal, not Stage R** |
| Partner routing | **Banner only** for the partner; creator auto-routed | The partner joining should be a decision, not something that happens to their screen |
| The impact step | **Folded into the session header** | R1 opens the session the instant the event is understood, so a separate impact screen reintroduces the manual tap R1 exists to delete. The standalone card stays in Chat as a historical record |

The third resolves a genuine tension in the stage file itself: step 2 ("Impact,
for both") versus step 3 ("Submitting opens the session"). Resolved toward step
3. The impact is still shown to both partners simultaneously — it is just not a
screen of its own.

**R5 turned out to be free of engine work.** `saveMoreAtMost` already carries an
`amount`, `addConstraint` validates the constraint *kind* and not the number
(`index.ts:1748`), and `generateBridgesWithEngine` / `closestOptionWithEngine`
already search against whatever amount they are given. The hardcoded
`$100/mo` is purely a missing input field.

**R6 is the phase to cut** if time runs short: it is the only one that touches
agent prompts and tool schemas, which forces a re-run of A1–A9.

---

## 5. Repo state

Branch `main`, last commit `eef9474`. **Uncommitted** — all of this is the
previous session's agent-targeting work plus the Stage R documents:

```
 M apps/mobile/app/(tabs)/menu.tsx          "Bring the agent here" button
 M docs/10 Screens.md                       Menu section rewritten
 M docs/12 Verification.md                  manual agent-request checks
 M packages/bindings/src/{index,types,types/reducers}.ts
 M server/spacetime/src/index.ts            requestAgent reducer :2349
 M server/spacetime/src/schema.ts           agent_request table :498
 M services/agent/.env.example              AGENT_REQUEST_WINDOW_MS
 M services/agent/src/index.ts              three-rule household targeting
?? packages/bindings/src/agent_request_table.ts
?? packages/bindings/src/request_agent_reducer.ts
?? docs/19 Stage R Plan.md
?? stages/Stage R - Branches Remediation.md
```

Nothing has been committed or pushed because it was not asked for. **The
bindings are regenerated**, so anyone pulling this must run
`npm run stdb:publish:local` before the app will connect.

All ten verification suites passed after that work: `npm run verify`.

### What is running right now

| | |
|---|---|
| SpacetimeDB standalone | PID 86098, since Nov 7 21:05 |
| Agent service | PID 6918, since Nov 8 02:36, pinned to `KY4S9D`, logging to the session scratchpad |
| Expo web | PID 7258, `expo start --web` |

Household **KY4S9D is the live one** (id 19, members Maya and Jordan). The local
database holds ~24 accumulated development households, which is what caused the
wrong-household bug in the first place — `verify:flow` mints one per run and the
agent serves the newest. Pruning is destructive and was offered, not done.

---

## 6. Gotchas that cost time before

- **`spacetime` is not on the default PATH.** Every Bash call needs
  `export PATH="$HOME/.local/bin:$PATH"`.
- **`spacetime sql` without `--server local` hits Maincloud.** Always pass it.
- **`node --env-file-if-exists` does not override already-set env vars.** This
  is why `services/agent/src/env-file.ts` exists: it makes `.env` authoritative
  over the ambient shell. Do not remove it.
- **`~/.zshrc:20` still exports a stale, invalid `GEMINI_API_KEY`.** Branches is
  immune thanks to `env-file.ts`, but any other tool reading it from the shell
  gets the dead key. Deleting that line is still an open cleanup item.
- **`AGENT_TOKEN` is not set** in `services/agent/.env`, so the agent mints a new
  identity on every restart and leaves an orphan `role: 'agent'` member row
  behind. Nothing breaks — `registerAgent` deletes the stale agent row in the
  household it claims — it is cosmetic. To fix: start the agent, copy the
  `AGENT_TOKEN=…` line it prints into `services/agent/.env`, restart.
- **`ps aux | grep agent` does not find the agent service.** Its command line is
  `node --env-file-if-exists=.env … src/index.ts`, so grep the full command line
  (`ps -eo pid,lstart,command | grep 'src/index.ts'`), never a column slice.
  This produced a confidently wrong "the agent isn't running" diagnosis.
- **Additive table migrations are non-destructive** in SpacetimeDB. Adding
  `agent_request` preserved every existing row.
- **Timestamps in the generated bindings** are objects: `.microsSinceUnixEpoch`,
  a `bigint`.
- **`useMe()` returns *all* members including the agent; `useHouseholdMembers()`
  filters to `role === 'member'`.** The latter is correct for anything involving
  the ready check — the agent has no hands to hold a button with.

### Credentials — standing constraint

`Creds.md` at the vault root holds the Gemini API key. It is gitignored
(`.gitignore:60` → `**/Creds.md`), has **never** been committed, and its
contents must never be copied into any tracked file. `services/agent/.env` is
gitignored too (`.gitignore:2`). When printing or logging anything key-shaped,
mask to **prefix plus length only** — a previous session leaked a key into
terminal output because a masking regex failed to match the `AQ.` prefix.

---

## 7. Verification this stage adds

Additions to [[12 Verification]], not replacements. Full table in
[[19 Stage R Plan#Verification]].

| ID | Check |
|---|---|
| R-1 | `verify:engine` E1–E10, `verify:flow` R1–R9, `verify:agent` A1–A9 unchanged PASS — Stage R must not move the engine |
| R-2 | `applyEventInterpretation` with no follow-ups → impact, session and three branches all exist after one reducer call |
| R-3 | Same with follow-ups outstanding → event stays `draft`, **no** session; `answerEventParam` then completes it and the session appears |
| R-4 | `advanceEvent` with no goals → a system message, no session, no throw |
| R-5 | Pin with a typed amount → stored, and the bridge search honours it |
| R-6 | Agent service **stopped**, whole flow via the form → R1–R7 still work end to end |

Acceptance test for the stage: perform
[[03 User Journey#Example session]] end to end **by typing a sentence**.

Working agreement for this stage: fixes are batched into one full verification
pass after the spine (R1–R3) lands, not run between every phase, unless
something is critical.

---

## 8. Still open from Stage 8

Carried forward, none blocking Stage R:

- Design pass; demo profile (OD-1); judges' README and public repo.
- The connection-loss **banner** (the state exists; the banner does not).
- Manual V8 UI checklist; three-times demo run-through; backup recording.
- **OD-16**: the third Devpost track is unresolved.
- **Maincloud is seven-plus schemas behind** and now also missing
  `agent_request`. Needs a person and a destructive republish.
- The Menu tab lives behind `(tabs)`, so it is **not reachable mid-onboarding**.
  Clearing browser storage (`localStorage.clear(); sessionStorage.clear();
  location.href = '/'`) is still the only escape from a half-finished
  onboarding (OD-21: no way to leave a household). Deliberately not allowlisted
  in `RouteGate`, because that would also expose Home/Timeline/Chat before they
  have data.
