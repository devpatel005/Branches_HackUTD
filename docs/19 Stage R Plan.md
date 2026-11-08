---
tags: [branches, stage, remediation, plan]
status: proposed
---
# 19 Stage R Plan

The plan for [[stages/Stage R - Branches Remediation]], written after the Step 0
alignment audit. Read that stage file first for the intent; this file is only
*how*.

For where the build stands, what is running, and the gotchas, see
[[20 Stage R Handoff]].

## The one-sentence version

The flow the product is supposed to have is **already built end to end** — it is
just not **chained**, not **visible**, and not **shared**. Stage R is mostly
wiring and emphasis, not new machinery.

## What the audit found

The thing I expected to be the big build — free text in, structured event out —
is **done and shipping**:

```
sendMessage(text)                        index.ts:1273
  └─ queueJob 'interpret_event'          index.ts:1297   (or 'translate_feedback' if a session is open)
       └─ agent service                  services/agent/src/index.ts:402
            └─ applyEventInterpretation   index.ts:2566   templateId + parsed params + follow-up chips
                 └─ answerEventParam      index.ts:1091   chips answered; draft → active
                      └─ computeImpact    index.ts:1137   impact row
```

Branch generation, locks, rerolls, pins, bridge branches, closest-option
statements, live tuning, the ready check and the idempotent commit are all built
and verified. The engine is untouched by this stage except where noted in R5.

So the gap is four things:

1. **The chain stops twice.** `computeImpact` is fired by a `useEffect` that
   lives *on the Chat screen* (`chat.tsx:95`), and `startSession` is fired by a
   *button* (`impact-card.tsx:133`). If nobody is looking at Chat, nothing
   computes. If nobody taps, no session opens. The "Branches match" never
   starts by itself, which is the core of the complaint.
2. **The digest is invisible.** The agent parses the sentence into template and
   parameters, then posts either a follow-up question or the bare template
   label. Nobody ever sees *"I read that as: a baby, 7 months out, 3 months
   unpaid leave, daycare"* — and there is no way to correct it.
3. **Only one partner is in it.** The partner gets an invite banner, but only
   after the first partner taps through, and the banner hides once joined with
   no way back (no **Decision waiting**).
4. **"What you'd prioritise, and for how much money" is half-built.** Pins exist
   and bridges honour them, but the options are a hardcoded list — including a
   literal `Save at most $100/mo` (`session.tsx` `PinSheet`). No money value can
   be typed.

## Build order

Each phase ends with something demonstrable on two devices. R1–R3 are the spine
and are the only phases that must land; R4–R8 are the ones that make it *read*
as the product.

---

### R1 — Chain the whole thing server-side

**The problem.** Three client effects, each guarded by its own `useRef`
at-most-once set, standing in for what should be one server transaction.

**The work.** Extract the bodies of `computeImpact`, `startSession` and
`generateCandidates` into plain internal functions that take `ctx` and the rows
they need, and do **no** authorisation of their own:

```
computeImpactFor(ctx, event)        ← from computeImpact       index.ts:1137
openSessionFor(ctx, household, event) ← from startSession      index.ts:1633
generateFor(ctx, sessionRow)        ← from generateCandidates  index.ts:1687
```

The existing public reducers keep their `requireHuman(ctx)` and become thin
wrappers, so nothing about the current permission model changes.

Then add **one** internal function, called from the two places an event becomes
ready, and from nowhere else:

```
advanceEvent(ctx, event)
  if event.status !== 'active'            → return      (still asking follow-ups)
  if no goals in household                → post a system message, return
  impact = computeImpactFor(ctx, event)
  if impact.noImpact                      → post the "nothing changes" card, return
  session = openSessionFor(ctx, household, event)
  generateFor(ctx, session)
  requestBranchNaming-equivalent: queueJob 'select_branches'
```

Call sites: the tail of `answerEventParam` (`index.ts:1091`), the tail of
`applyEventInterpretation` when there are no follow-ups (`index.ts:2566`), and
the tail of `createEvent` (`index.ts:1054`) so the form path behaves identically.

**Watch out.** `applyEventInterpretation` is called by the **agent**, and today
`computeImpact` and `startSession` both begin with `requireHuman(ctx)`. That is
exactly why the chain was never joined up. The helper split above is what makes
it legal — the agent is allowed to *advance* an event it just interpreted,
because every number still comes from the engine inside a reducer
([[02 Ground Rules]] #1 and #7) and the agent still cannot commit a plan.

**Then delete** the `computeImpact` effect and the `attempted` ref from
`chat.tsx`, and the `generated` ref and its effect from `session.tsx:103`. They
become dead weight and a second source of truth.

**Done when.** With both devices on Home, one partner types "we're having a
baby in 7 months" into Chat, answers the follow-up chips, and a session with
three named branches opens on **both** screens with no other taps.

---

### R2 — Make the digest visible and correctable

**The problem.** The LLM's reading of the sentence is the moment the product
earns trust, and right now it is silent.

**The work.**

- Add a `kind: 'digest'` chat message, written by `applyEventInterpretation`
  alongside the event, carrying the template label and the parsed parameters as
  its `payload`.
- A `DigestCard` in `src/impact-card.tsx` (it already owns the card idiom):
  *"I read that as"* → the template, then one row per parameter using the
  existing `FIELD_LABELS` and `choiceLabel` from `events.ts:180`, then a quiet
  **Not quite — fix it** button that opens the existing `EventFormSheet`
  pre-filled with those values.
- No new reducer for the correction path: the form already calls `createEvent`,
  and `applyEventInterpretation` already dismisses a superseded active event
  (`index.ts:2578`), so re-submitting supersedes cleanly.

**Done when.** The sentence produces a readback both partners can see, and
tapping "fix it" lands in a form already filled with what the model guessed.

---

### R3 — Pull both partners in, and keep a way back

**Settled: the creator is auto-routed, the partner gets the banner.**
Hijacking a partner's screen mid-tap is worse than a banner they can see and
act on, and it makes the join a decision rather than something that happened
to them.

**The work.**

- **Auto-route the creator.** The impact card's `startSession` + `router.push`
  button goes away (R1 opens the session server-side). Instead, a small hook —
  `useSessionAutoRoute()` in `src/session.ts`, mounted once in
  `(tabs)/_layout.tsx` — pushes `/session` when a session opens that *this
  member started*. The partner is deliberately **not** auto-routed: yanking
  someone's screen is worse than a banner.
- **Banner stays** as-is (`invite-banner.tsx` already works on all tabs).
- **Decision waiting.** A new `DecisionWaiting` strip on Home and Timeline, from
  `useOpenSession()`: *"A decision is waiting · Baby on the way"* with a button
  into `/session`. This is also the fix for the stranding bug — today a partner
  who closes a session has no route back, because the banner hides once they
  have joined.

**Done when.** Submitting on the phone opens the session there and shows the
banner on the laptop; closing it on either device leaves a visible way back on
Home.

---

### R4 — Show the projection the engine made

**Settled: one shared chart.** The impact becomes the session's header, not a
screen you pass through.

**The problem.** Both partners are supposed to *see the projection the engine
made*. Branch cards show stat chips only, and the impact card's chart data is
stranded in Chat where nobody is looking during a session.

**The work.** Put the impact at the top of the session, reusing `ImpactCard`'s
rows, and render the already-stored `impact.seriesAfter` through the existing
`ProjectionChart` (`src/chart.tsx`). `StoredImpact.seriesAfter` is already
persisted (`events.ts:38`), so this is layout, not engine work. Branch cards
keep their stat chips, which carry the per-branch *deltas* — the comparison the
couple is actually making.

```
SESSION
─────────────────────────────
Japan no longer fits  −$2,183.97

  ╭─╮        ← one curve: what
 ╱   ╰──╮      the event did to us
╱        ╰──╮

Tight years  0 → 2
Safety net   4.1 → 2.3 mo
─────────────────────────────
[ Move Japan    +6mo   $0/mo ]
[ Smaller Japan −12%   $0/mo ]
[ Save more      $0mo +$340  ]
```

**Rejected: a curve per branch.** It needs a new series field on
`CandidateStats` (`packages/engine/src/branches.ts:100` has none today), which
means re-pinning the E6–E8 goldens, and it puts three 120-month series on the
wire for every reroll and every `tuneLever` call — a path already throttled to
~10/s. Risks degrading live tuning, which is a signature moment, to decorate a
comparison the stat chips already make. Sparklines are a stretch goal, not
Stage R.

### R5 — Priorities with money values attached

**The problem.** `PinSheet` in `session.tsx` is a hardcoded option list ending
in a literal `Save at most $100/mo`. The product promise is choosing *what you
protect and what it is worth*.

**The work.**

- `PinSheet` gets an amount field for the two money-shaped constraints. The
  engine already accepts the value: `saveMoreAtMost` carries `amount`
  (`addConstraint` validates the kind at `index.ts:1748`, not the number), so
  this is UI plus a `requireMoneyCents`-style bound.
- Same treatment for the lock chips on each card, so "keep the house on time"
  and "I can find at most $250 a month" are the same gesture.
- Pin copy becomes two lines: the thing, and the number — *"House on time"* /
  *"At most $250/mo extra"*.
- **No engine change.** `generateBridgesWithEngine` and
  `closestOptionWithEngine` (`index.ts:1791`) already search against whatever
  amount the constraint carries.

**Done when.** Two partners pin conflicting money values, tap **Find a path that
honours both**, and get either bridge branches or a closest-option statement
quoting their own numbers.

---

### R6 — Text that is not one of the six templates

**The problem.** "We need a new couch" is the literal thing you typed, and it
dead-ends. It is an affordability question, not a life event, and the
`interpret_event` fallback (`services/agent/src/fallbacks.ts:19`) only offers
the form.

**The work.** Let `interpret_event` return an affordability interpretation
instead of a template — amount plus label — routed to the existing
`checkAffordability` reducer (`index.ts:1225`) and its built
`AffordabilityCard`. When the model can extract neither, the fallback message
should say *which* two things it can do rather than only pointing at the form.

**Done when.** "We need a new couch, about $1,200" returns an affordability
answer; "we need a new couch" asks how much.

---

### R7 — Entry points and emphasis

- Replace the stale placeholder at `(tabs)/index.tsx:184` — it still reads
  *"Life events and branches arrive in the next stage."* — with **Something
  changed** as Home's primary button, opening straight to the free-text field
  with the template chips underneath it.
- Same button on Timeline; applied life events as markers there, which
  `timeline.tsx`'s own doc comment already claims.
- Chat keeps everything it has and stops being the only door.

**Done when.** Home → two taps → a session.

---

### R8 — The session as the hero

Lowest priority, and explicitly *after* R1–R5 work. Full-bleed layout, the
branch cards as the visual centre, and the bridge/closest-option output rendered
**in the session** instead of posted to Chat where nobody is looking
(`index.ts:1835` posts via `postMessage` today — the one place the session is
silent about work it just did).

---

## Verification

Additions to [[12 Verification]], not replacements:

| ID | Check | Expected |
|---|---|---|
| R-1 | `verify:engine` E1–E10, `verify:flow` R1–R9, `verify:agent` A1–A9 | unchanged PASS — this stage must not move the engine |
| R-2 | New `verify:flow` step: `applyEventInterpretation` with no follow-ups | impact, session and three branches all exist after one reducer call |
| R-3 | Same, with follow-ups outstanding | event stays `draft`; **no** session; then `answerEventParam` completes it and the session appears |
| R-4 | `advanceEvent` with no goals in the household | a system message, no session, no throw |
| R-5 | Pin with a typed amount | constraint stores the amount; bridge search honours it |
| R-6 | Agent service stopped, whole flow via the form | R1–R7 still work end to end ([[07 Agent Spec#Deterministic fallbacks]]) |

[[12 Verification#V6 Real-time checklist]] re-run on two devices, and the
[[03 User Journey#Example session]] performed **by typing a sentence**, which is
the acceptance test for this stage.

## Risks

- **R1 is one transaction doing a lot.** Interpretation, impact, session and
  candidate generation in one reducer call. If it throws halfway the whole thing
  rolls back, which is the correct behaviour but means the agent's parse is lost
  too. Mitigation: `advanceEvent` returns early rather than throwing for the
  known non-exceptional cases (no goals, no impact, still-draft).
- **R4b is a trap.** Per-branch series looks like a small addition and is an
  engine change plus a payload increase on the throttled tuning path.
- **Scope.** R6 touches agent prompts and tool schemas, which means re-running
  A1–A9. Cheapest phase to cut if time runs short.

## Decisions settled

Taken 2026-11-08, before any code:

| Decision | Settled | Why |
|---|---|---|
| Projection display | **One shared chart** (R4a) | The per-branch curve is an engine change plus a payload increase on the throttled tuning path, to decorate a comparison the stat chips already make |
| Partner routing | **Banner only**; creator auto-routed | The partner joining should be a decision, not something that happens to their screen |
| The impact step | **Folded into the session header** | R1 opens the session the instant the event is understood, so a separate impact screen would reintroduce the manual tap R1 exists to delete. The standalone card stays in Chat as a historical record |

The third of these is the one that changes the stage file's own wording: step 2
("Impact, for both") and step 3 ("Submitting opens the session") are in tension,
and this resolves it toward step 3. The impact is still shown to both partners,
simultaneously, in the first thing they see — it just is not a screen of its
own.

## Build Log

*(append entries here)*
