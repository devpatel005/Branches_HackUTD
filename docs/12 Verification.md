---
tags: [branches, spec, testing]
---
# 12 Verification

We don't need a unit-test suite. We need **predictable outputs we can prove** for the parts that must be predictable: math, engine, inference, the agent contract, privacy, and real-time behavior.

## How verification works
- Scripts live in `scripts/verify/`, one per area, each runnable with one command (list them in `CLAUDE.md` → Commands).
- Each script prints a table: **ID · description · expected · actual · PASS/FAIL**, then a summary line, and exits non-zero on any FAIL.
- Money comparisons are exact to the cent. Lists compare exactly, including order.
- Manual checks (real-time, UI) are checklists the team runs with two devices; record results in the stage Build Log.

## V1 Math
Command: `verify:math`
The five formula goldens F1–F5 in [[06 Engine Spec#Formulas]], plus: `r = 0` edge cases (F2 falls back to F1; F4 = P/n).

## V2 Engine
Command: `verify:engine`
Scenarios E1–E10 in [[06 Engine Spec#Golden scenarios]]. E10 (determinism) runs every scenario twice and compares serialized JSON byte for byte.

## V3 Inference
Command: `verify:inference`
Generate Test Household A transactions, run inference, and compare to the expected table in [[11 Mock Data#Expected inference output]] (exact rows, order, amounts) and the 2 gap questions. Also: generating the household twice yields identical transactions.

## V4 Data flow
Command: `verify:flow` (against a local or dev SpacetimeDB)
1. Create a household, join a second identity, seed Test Household A, confirm all items, set fun money, add the two goals → `plan_projection` matches E1–E3.
2. Create the E5 baby event → stored impact matches E5.
3. Generate candidates → branch candidates match E6–E8 in order.
4. Commit candidate 1 via ready check from both identities → projection matches E9 for that candidate.
5. A non-agent identity calling an agent-only reducer is rejected; the agent identity calling a plan-changing reducer is rejected.

## V5 Agent contract
Command: `verify:agent`
Run in two modes: **recorded** (no network, deterministic) and **mock** (`BRANCHES_AGENT_MODE=mock`, real HTTP through the bundled mock). The mock speaks the **Gemini Interactions** shape, so mock mode exercises the real `@google/genai` adapter rather than a stand-in; a smaller group covers the OpenAI-compatible secondary path. `verify:agent:e2e` runs the real service over the real bus.
| ID | Check | Expected |
|---|---|---|
| A1 | `classify_life_event` on "we just found out we're pregnant" | templateId `baby`; follow-ups include leave and care |
| A2 | `select_branches` on E8 candidates | 3 distinct valid candidate ids; names ≤ 30 chars |
| A3 | Numbers whitelist | A summary with an invented number (e.g., "$999") is rejected; one using only engine numbers passes |
| A4 | Language filter | Text containing "you should" is rejected |
| A5 | Fallback | With the model forced to fail, fallback branches/names appear and the job ends `failed` gracefully |
| A6 | Failover | Simulated 429 on tier 1 → tier 2 used; `modelUsed` recorded |
| A7 | **Privacy canaries** | Every logged prompt from a full demo run contains **none** of the private-purchase merchant names, no transaction counterparties, and no raw transactions |
| A8 | **Live model — SETTLED 2026-11-08, 6/6** | Both model names resolve, `thinking_level` and `tool_choice.allowed_tools` are accepted as sent, and the interaction ends `requires_action` with a parsed function call. `npm run -w @branches/agent smoke`. Needs a key in `services/agent/.env`, which now wins over the shell — see [[18 Stage 8 Pass 1 Record#1. The Gemini API problem — SOLVED 2026-11-08]] |
| A9 | Provider normalisation | Both adapters reduce to the same four statuses; `incomplete` / `failed` / an unexpected status are never read as answers; a Gemini thought step is not reported as leaked reasoning while OpenAI `reasoning_content` is |

## V6 Real-time checklist
Manual, with one phone and one laptop.
Run with one member on a phone (Expo Go) and one on a laptop (web).
- [ ] Join: second member's avatar appears on the first screen within ~1s.
- [ ] Goal added on one device appears on the other within ~1s, pulsing in the author's color.
- [ ] Session invite banner appears on the other device.
- [ ] Branch cards appear one at a time on both devices with progress text.
- [ ] Selections and reactions show on both devices within ~1s.
- [ ] Slider drag on one device moves the slider and stats on the other.
- [ ] Locks and pins appear on both devices; reroll/bridge results appear on both.
- [ ] Disconnecting one device marks that member absent within ~5s and hides the ready check.
- [ ] No screen flashes to a loading state during edits (flashing-bug workaround works).

## V7 Ready check cases
Scripted in `verify:flow` where possible, otherwise manual.
| ID | Case | Expected |
|---|---|---|
| R1 | Both ready on the same branch | Commits exactly once |
| R2 | One ready, the other never | No commit |
| R3 | Release before 1.5s | `setReady(true)` never sent |
| R4 | Both ready, then one tunes a slider | All ready flags cleared; no commit |
| R5 | Both call `setReady(true)` simultaneously | One commit (idempotent) |
| R6 | Members selected different branches and both ready | No commit |

## V8 UI checklist
Manual.
- [ ] Every screen in [[10 Screens]] renders in Expo Go and on web.
- [ ] Every displayed number opens "Show the math."
- [ ] No agent text contains advice language.
- [ ] Design tokens match [[09 Design System]] (dark background, one accent, member colors only for people).
- [ ] The full demo works with the agent service stopped (fallbacks).

## V9 Never-stuck
Command: `verify:screens`. A static scan, because these regressions are each one line long and invisible in development — locally the server is always up and the data always arrives, so the failure only appears on stage.
| ID | Check | Expected |
|---|---|---|
| S1 | Blank pages | No screen component bails out to `return null` while data loads. Scoped to the **default export**: the same line inside a closed sheet is correct |
| S2 | `Loading` | Reveals an explanation after a timeout, names the connection problem if there is one, and offers a reload. One component is the floor under all six screens that use it |
| S3 | Connection errors | Reach the user as state, not only `console.warn`, and clear on a successful connect |
| S4 | Agent stalls | Every screen showing `progressText` also handles `stalled`, and the signal is driven by a clock — a wedged job's row never changes, so nothing else would re-render |
| S5 | The waiting room | Offers an action, lets the name be corrected in place, and points at `?device=b`. `createHousehold` refuses once you are a member, so this screen had no way back |
| S6 | No branches | Offers a retry and a way out rather than only waiting |
| S7 | Agent off | Chat detects whether an agent exists at all, and the form path is reachable regardless ([[07 Agent Spec#Deterministic fallbacks]]) |

What it cannot check is whether the copy is any good. That stays in V8 above.

## Demo run-through
- [ ] Reset demo data → full journey → commit → reset again, three times in a row without errors.
- [ ] Backup screen recording of a full successful run.
