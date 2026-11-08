---
tags: [branches, spec, rules]
---
# 02 Ground Rules

These apply to every stage. A stage is not done if it breaks one.

## 1. The AI never computes numbers
- All numbers come from `packages/engine`, run inside SpacetimeDB reducers (or verification scripts).
- The agent receives engine output as data and may only **select, name, and explain** it.
- Every number in agent-written text must exactly match a number in the engine output it was given (after normalizing formatting like `$1,200` vs `1200`). Otherwise the text is discarded and a template sentence is used. See [[07 Agent Spec#Validation]].
- Team research found Nemotron models score under 10% on a banking-calculation benchmark. This rule is a feature; mention it in the pitch.

## 2. Projections, not advice
- Allowed: "If you push Japan to 2029, the projection shows both goals funded."
- Not allowed: "You should push Japan." / "We recommend…" / "The best option is…"
- Every projection shows its assumptions (savings rate, inflation) and can be edited in the Assumptions sheet.
- No claims to be a financial advisor anywhere in the UI.

## 3. Privacy by architecture
- **Fun-money purchases never leave the owner's device.** They are not stored in SpacetimeDB and are never passed to the agent.
- Shared: each member's fun-money **amount** and a monthly **status** (`within` / `over`).
- Overspending is self-contained: an overage reduces that member's next month of fun money. The shared plan never changes because of it, so the other partner is never notified.
- The agent's context is built by **one function** that uses an allowlist of fields (see [[07 Agent Spec#Context builder]]). Nothing else may send data to the LLM.
- Mock data only. No real financial data in this build.

## 4. The agent proposes; humans decide
- The agent may write: chat messages, event interpretations, branch selections/names/summaries, constraint translations, job progress.
- The agent may **not** change goals, assumptions, or the committed plan.
- Only the ready check (all members holding at once) commits a branch. See [[08 Live Session Spec#Ready check]].

## 5. Determinism
- Engine functions are pure: same inputs → byte-identical JSON output.
- No randomness, no wall-clock time inside engine logic. "Now" is passed in as month 0.
- Every list has a defined, stable sort order (documented in [[06 Engine Spec]]).
- Money is stored as integer cents in the database; the engine computes in floating-point dollars and rounds to cents only at output.

## 6. Runs everywhere we demo
- Expo Go on iPhone/Android **and** Expo web in a laptop browser, from one codebase.
- No custom native modules (Expo Go can't load them). If a library needs one, don't use it.
- Haptics and other phone-only features must no-op gracefully on web.

## 7. Core logic in SpacetimeDB
- Simulation, impact, lever search, candidate generation, and session state transitions run in the SpacetimeDB module.
- The agent service is a client of SpacetimeDB like the app. It does not hold plan state.

## 8. Honest UI
- Never show a number without being able to show its math.
- Label assumptions as assumptions. The default savings rate is an *assumed* rate, not a PNC rate (see [[14 Research Notes]]).
- Don't use PNC trademarks (Money Bar, Danger Day) or ℠/™ symbols for our own terms.

## 9. Open decisions stay open
- If you reach an item in [[13 Open Decisions]], use its default, mark it `// OPEN(OD-x)`, and log it. Don't finalize it.
