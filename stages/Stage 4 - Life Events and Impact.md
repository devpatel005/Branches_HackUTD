---
tags: [branches, stage]
status: complete
---
# Stage 4 — Life Events and Impact

**Goal:** entering a life event shows exactly what it does to the plan. No agent yet; a form drives it.

## Starting point
Stage 3 complete: plan with goals and projections, synced live.

## Read first
[[06 Engine Spec#Life event templates]] · [[06 Engine Spec#Impact]] · [[05 Data Model#Events, impact, branches]] · [[10 Screens#Chat]]

## Build
1. `life_event` and `impact` tables; reducers `createEvent`, `answerEventParam`, `computeImpact`, `dismissEvent`.
2. Event form (template picker + parameter fields). This is also the permanent fallback when the agent is unavailable.
3. Impact card in Chat: goals affected (with shortfalls), tight years before/after, emergency-fund change, free-to-plan change, and **Start planning session** (button can be inert until Stage 7).
4. "No impact" state: "This doesn't change your goals" + keep plan.
5. Affordability check form in Chat (amount + label) showing the engine result in time terms.

## Out of scope
Branches (Stage 5), agent (Stage 6), live session (Stage 7).

## Done when
- [x] **PASS** — `verify:flow` E5a-E5g, out of a reducer: Japan newly at risk, shortfall **2,183.97**, House funded, tight months **9-23**, tight years 0 -> 2.
- [x] **PASS** — `verify:flow` E4a-E4e: no impact, nothing at risk, no tight months, and a single effect line naming the amount and month.
- [x] **PASS (scripted)** — `verify:flow` V3, T2, D1: B creates the event and A receives it; the impact message reaches B; a dismissal reaches both. Seeing it on two screens is a manual check (OD-18).
- [x] **PASS** — `verify:flow` E5l-E5o. Impact deltas get their own `impact.*` provenance namespace, each shortfall its own record, and every record's inputs include the event's attributed effects.

## Verification
`verify:engine` E4–E5; `verify:flow` step 2.

## Build Log

### 2026-11-08 — Stage 4 built

**Decisions taken before building** (asked up front):
- **The thread exists now.** `chat_message` was pulled forward from Stage 6 so
  event entries, impact cards and affordability answers have somewhere to live
  and [[10 Screens#Chat]]'s thread is built once rather than twice. Stage 6 adds
  the agent as another author.
- **An impact sheet explains *why*, not only the arithmetic.** It lists the
  event's attributed effects alongside before/after, because a delta's
  interesting half is what caused it.
- **One active event at a time.** A new event supersedes the previous draft,
  which matches "a session is about one event" in [[08 Live Session Spec]].
  Applied and dismissed events stay as history.

**Built**
- **Engine** — `EventEffects.ledger`, written by `compileEvents` alongside the
  arrays it already produced, and `describeEventEffects` which turns it into
  readable lines. `computeImpact` now returns `effects` plus an `impact.*`
  provenance namespace for its own deltas.
- **Module** — `life_event`, `impact` and `chat_message` tables; `createEvent`,
  `answerEventParam`, `computeImpact`, `dismissEvent`, `checkAffordability` and
  `sendMessage`. `reseedHousehold` clears events, impacts and the thread.
- **App** — Chat rebuilt as a thread, the event form generated from the engine's
  own parameter specs, the impact card, the "Why the plan changed" sheet, and the
  affordability card.
- **Verification** — `verify:flow` gained 40 Stage 4 checks (E4/E5/V/T/A/D).

**Verification**

| Suite | Result |
|---|---|
| `verify:flow` — Stages 2, 3 **and** 4 | **116/116 PASS** |
| `verify:engine` / `math` / `purity` / `inference` | 41/41 · 18/18 · 14/14 · 28/28 |
| `npm run verify` | **7/7 suites behaved as expected** |
| `npm run typecheck` | clean |
| Metro bundle | web, iOS and Android all compile (978 / 1496 / 1493 modules) |

**Decisions and notes**

1. **The effect ledger is why the explanation can be trusted.** The arrays the
   simulation reads are *sums*: a baby's $800/mo and $1,200/mo daycare land in
   the same slot and read back as $2,000 — correct arithmetic, useless
   explanation. `compileEvents` now records each contribution as it writes one,
   so the description is attributed **and** still cannot drift from what the
   projection used. E5 produces exactly four lines: unpaid leave, the birth,
   raising a child, daycare.
2. **A big one-time purchase cannot put a goal at risk**, and that is correct.
   Goals are funded from the monthly surplus; a lump sum lands on the emergency
   fund. A $40,000 spend takes the fund to **-6.6 months** and creates 18 tight
   months while both goals still complete. [[06 Engine Spec]]'s own example
   answer is "no goal changes; emergency fund goes from 4.2 to 3.9 months", so
   the affordability card leads with the fund and tight months rather than with
   goals. My first two checks asserted the opposite and were **wrong, not the
   engine** — they now assert the real property.
3. **The baby event changes nothing about today.** `freeToPlan` is identical
   before and after, because the event starts in month 9. The card says so
   explicitly ("unchanged today — the cost starts later") rather than hiding a
   zero: the event doesn't cost them this month, it breaks a goal two years out.
4. **Impact is stored without its two projections.** The engine returns the full
   before and after (~13 KB each) and the card needs neither, so the reducer
   stores the deltas, the effects, the provenance, the post-event goals and the
   series. Keeps the row small enough to broadcast on every recompute.
5. **Impact is computed by an effect on the Chat screen, not chained onto the
   form.** A reducer returns nothing (05 Data Model), so the new event id only
   exists once the subscription delivers the row. The effect is at-most-once per
   event id, so a rejection cannot become a retry loop — and it is exactly the
   shape Stage 6 needs, where the agent fills parameters in over several turns.
6. **The event form is generated from the engine's parameter specs**, so a new
   template gets a form for free. This is the permanent fallback for an
   unavailable agent (07 Agent Spec#Deterministic fallbacks), not scaffolding.
7. **Engine cards have no author.** `authorMemberId` is absent for
   engine-produced messages — they are results, not anybody's opinion. The agent
   will author its own as a member with role `agent`.

**Problems solved along the way**

- **A reducer panic takes down the whole WASM instance.** `createEvent` passed a
  member id through a "numeric strings become numbers" coercion, so `"35"`
  became `35` and failed the engine's member check — which `throw`s a plain
  `Error`, which **panicked the module** and showed every client
  `InternalError: The instance encountered a fatal error`. Two fixes, both
  worth keeping:
  - Event parameters are now coerced using the **template's own spec**
    (`isMember` / `choices` / numeric) instead of guessing from the string shape.
  - Every engine call from a reducer goes through `viaEngine`, which converts a
    thrown `Error` into a `SenderError`. A user typing a bad value must never be
    able to take the database down. The engine cannot throw `SenderError` itself
    without a dependency `verify:purity` forbids, so the boundary is the right
    place for this.
- **The error message hid the problem.** It read
  `must be one of the household's members (34, 35), got 35` — against a list
  containing 35. It now names the type: `got number 35`.
- **`JSON.stringify` throws on `bigint`,** and row ids are `u64`. The shared
  `fmt`/`eq` helpers in `scripts/verify/table.ts` are now BigInt-safe, so any
  suite comparing an id fails rather than crashing.

**Open**

- **Maincloud is three schemas behind.** Still destructive, still needs a person.
- **Visual checks unrun**: the thread, the impact card and the "Why?" sheet are
  bundle-verified but need eyes (OD-18).
- **"Start planning session" is inert**, as this stage allows. Stage 5 can point
  it at branches; Stage 7 makes it real.
- Event costs are all **OPEN(OD-2) placeholders**. The baby numbers drive E5, so
  changing them means re-deriving that golden.
- `answerEventParam` exists and is validated but is unused by the UI — the form
  sends every parameter at once. Stage 6's chip follow-ups are its reason to exist.

