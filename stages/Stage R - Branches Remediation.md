---
tags: [branches, stage, remediation]
status: not-started
---
# Stage R — Branches Remediation

**Goal:** the Branches session is the center of the product. Every life event leads **both partners** into one shared, live Branches session where they choose a path forward together. Everything else supports that moment.

## Read first
[[08 Live Session Spec]] · [[06 Engine Spec#Levers]] · [[06 Engine Spec#Branch candidates]] · [[06 Engine Spec#Golden scenarios]] · [[09 Design System#Signature components]] · [[10 Screens#Session]] · [[03 User Journey#Example session]]

## The experience we need
1. **Something changed.** A prominent button on Home and Timeline opens an event picker (Baby, House, Job loss, Medical bill, Car, Raise/Windfall). Each event asks only 2–3 fields (when, how much, any key choice like leave length). Submit takes under 20 seconds.
2. **Impact, for both.** The engine shows what no longer fits ("Japan and the house no longer fit; 2029 gets tight") on both partners' screens.
3. **Both are pulled in.** Submitting opens the Branches session for the creator. The partner sees a banner on any screen: "Maya needs you: Baby on the way" → tap to join. Until the session commits, Home shows **Decision waiting** with a button back into the session.
4. **Three branches appear**, one at a time, as cards with stats (goal date changes, extra monthly saving, emergency-fund months, tight years).
5. **They shape it together, live:** pick (avatar on the chosen card), react, tune sliders, lock and reroll, pin a non-negotiable when they disagree and get bridge branches.
6. **Both commit** with a simultaneous press-and-hold. The plan, timeline, and Home update for both, and the event is marked applied.

Chat is optional: a secondary way to describe an event or ask for different branches. The full flow works without it.

## Step 0 — Alignment (before writing code)
Read the codebase and post a table mapping each requirement below to the existing code: **exists / partial / missing**, with file paths and what you'll reuse. Wait for the team's go-ahead.

## Build order
Each phase must work end to end on two devices (phone + laptop) before starting the next.

### Phase 1 — Event entry and impact
- **Needed:** "Something changed" button; event picker; per-template parameter form; `createEvent` → `computeImpact`; impact card visible to both members live.
- **Done when:** the E5 baby event on Test Household A shows Japan at risk ($2,183.97 shortfall) on both devices within ~1s.

### Phase 2 — Branch generation
- **Needed:** lever search, candidate generation and ordering, fallback selection and template names, all in SpacetimeDB reducers.
- **Done when:** E6–E8 pass and the three fallback branches are stored for the event.

### Phase 3 — Session shell
- **Needed:** `startSession` triggered automatically by event submission; invite banner on every screen; join; presence header with both avatars; **Decision waiting** state on Home; resume an open session.
- **Done when:** submitting on the phone shows the banner on the laptop; joining shows both avatars present on both devices.

### Phase 4 — Branch cards, picks, reactions
- **Needed:** cards arrive one at a time with stats; each member's selection shown with their avatar and color; reactions; "You've picked different branches" banner on disagreement.
- **Done when:** a pick or reaction on one device appears on the other within ~1s.

### Phase 5 — Shared tuning
- **Needed:** card detail with sliders (delay, shrink, save more); `tuneLever` recomputes stats in SpacetimeDB; "Tuned by {name}" in that member's color; throttled updates with the final value on release.
- **Done when:** dragging on one device moves the slider and recalculates stats on the other.

### Phase 6 — Locks, rerolls, pins, bridges
- **Needed:** lock chips; reroll honoring locks and excluding shown branches; pin flow on disagreement; bridge branches honoring both pins; closest-option statements when none exist.
- **Done when:** locking "House on time" then rerolling never shows a house delay; two conflicting pins produce bridge branches or closest-option statements.

### Phase 7 — Ready check and commit
- **Needed:** hold-to-confirm ring with a segment per member; 1.5s hold; server commit only when all members are ready on the same branch; idempotent; any change clears readiness; commit applies levers, marks the event applied, recomputes the plan.
- **Done when:** R1–R6 in [[12 Verification#V7 Ready check cases]] pass and E9 matches after commit.

### Phase 8 — Agent as an enhancer
- **Needed:** the agent names and summarizes the three branches (validated, with fallback names); optional "None of these fit? Tell us what you want" box that becomes locks; optional natural-language event entry that pre-fills the event form.
- **Done when:** with the agent service stopped, Phases 1–7 still work end to end.

### Phase 9 — Navigation and emphasis
- **Needed:** the Branches session is the visual hero (full screen, signature components from [[09 Design System]]); "Something changed" is the primary action on Home; chat moves to a secondary entry point.
- **Done when:** a first-time user reaches a Branches session from Home in two taps.

## Verification
- `verify:engine` E1–E10 and `verify:flow` all PASS.
- [[12 Verification#V6 Real-time checklist]] passes with one phone and one laptop.
- The [[03 User Journey#Example session]] can be performed end to end using the event form, without chat.

## Notes for Claude Code
- Reuse the engine and its golden checks as they are.
- Keep existing chat code; move it behind the optional entry point instead of deleting it.
- Report progress per phase in the Build Log.

## Build Log

### 2026-11-08 — Step 0 alignment, plan written
Audit done, plan in [[19 Stage R Plan]], handoff in [[20 Stage R Handoff]]. Headline: the free-text → LLM →
structured-event path is **already built** (`sendMessage` → `interpret_event`
job → `applyEventInterpretation` → `answerEventParam` → `computeImpact`), as are
branch generation, locks, rerolls, pins, bridges, closest-option statements,
live tuning, the ready check and the commit.

The chain stops twice, both times in the client: `computeImpact` fires from a
`useEffect` on the Chat screen, and `startSession` fires from a button on the
impact card. So the session never opens by itself and the partner is never
pulled in — which is the whole of the complaint.

Phases R1–R3 (server-side chain, visible digest, pull both partners in) are the
spine and the only ones that must land. Three decisions settled before code: one
shared projection chart rather than per-branch curves; banner for the partner,
auto-route for the creator; impact folded into the session header. Awaiting
go-ahead to build.


### 2026-11-08 — R1 built: the chain joins up on the server
The spine is in. A typed sentence now reaches three branches with no client in
the loop.

**The split.** Three reducer bodies became plain internal functions that
authorise nothing — `computeImpactFor`, `startSessionFor`, `generateFor` — plus
`queueBranchNaming` for the naming job. `computeImpact`, `startSession`,
`generateCandidates` and `requestBranchNaming` are now thin wrappers that keep
their `requireHuman(ctx)`, so the permission model is unchanged. This split was
the whole blocker: `applyEventInterpretation` runs as the **agent**, and both
`computeImpact` and `startSession` begin with `requireHuman`.

**The new function.** `advanceEvent(ctx, event, actorId?)` does impact →
session → candidates → naming job in one transaction, and is called from
exactly three tails: `createEvent`, `answerEventParam` and
`applyEventInterpretation`. It **returns** rather than throws for the four
ordinary "not yet" cases (still a draft, already on the table, no goals,
`noImpact`), because a throw would roll back the agent's parse and the couple
would see nothing at all.

**One decision beyond the plan.** `applyEventInterpretation` gained a
`memberId` parameter — the partner who typed the sentence, which the agent
already had in the job input and was discarding. Without it the event was
attributed to the agent and `startedBy` would have been an identity with no
screen, so "the creator is auto-routed, the partner gets a banner" had nobody
to route. The module resolves the id against its own human member rows, so a
missing or bogus value degrades to the old behaviour instead of trusting it.
`verify:flow` V3 and SR2b both pin the attribution.

**Deleted, so there is one source of truth.** The `computeImpact` effect and
its `attempted` ref in `chat.tsx`, and the `generated` ref and effect in
`session.tsx`. The "No branches" retry button stays — that one is deliberate
(V9 S6).

**Verification.** All ten suites pass. `verify:flow` is 200/200 including 24 new
checks, SR2a–SR4d, documented in [[12 Verification#V4 Data flow]]. They sit
before section 10's commit on purpose; after it every event honestly reports
`noImpact` and the group would pass vacuously, which SR2c2 guards against.

Still open, carried to R2/R3: the Home placeholder at `(tabs)/index.tsx:184`,
the invite banner with no route back, "Decision waiting", and the stale Timeline
doc comment.
