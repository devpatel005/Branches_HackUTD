---
tags: [branches, stage]
status: complete-except-live-nemotron
---
# Stage 6 — Agent

**Goal:** Nemotron joins as the third participant: it interprets life events from chat, selects and names branches, translates feedback into constraints, and explains results, all validated, with fallbacks.

## Starting point
Stage 5 complete: the full flow works with forms and fallback names.

## Read first
[[07 Agent Spec]] (all of it) · [[02 Ground Rules#1. The AI never computes numbers]] · [[02 Ground Rules#3. Privacy by architecture]] · [[04 Architecture#Message bus pattern]] · [[12 Verification#V5 Agent contract]]

## Build
1. `chat_message` and `agent_job` tables; `sendMessage`; agent-only reducers with role checks.
2. Agent service: subscribe to queued jobs, claim, progress, complete/fail; one job at a time per household.
3. The single context builder with the allowlist; development prompt logging.
4. Tasks: `interpret_event`, `select_branches`, `translate_feedback`, `affordability`, `explain`, `general_chat`.
5. Validation: Zod schemas, numbers whitelist, language filter, length limits; retry once, then failover tiers.
6. Chat UI: messages with author colors, follow-up chips, progress indicator, impact and affordability cards.
7. `verify:agent` in recorded and live modes.

## Out of scope
Live session multi-user behaviors (Stage 7).

## Done when
- [x] **PASS** — `verify:agent:e2e` E6-E13 with the real service over the real bus: classified as `baby`, follow-up chips posted by the agent, and once answered the engine finds Japan at risk with the golden **2,183.97** shortfall.
- [x] **PASS** — `verify:agent:e2e` N1-N7: all three renamed by the agent, `nameSource: agent`, within the 30/200 character limits, no advice language, and every one still pointing at a real engine candidate. Numbers are enforced by the whitelist (A3).
- [x] **PASS** — `translate_feedback` turns it into `goalOnTime` plus `saveMoreAtMost`, recorded as *the member's* lock rather than the agent's, then rerolls. Exercised through the mock; the lock shapes are validated against the engine's own list.
- [x] **PASS** — nothing in the app waits on the agent. A queued job with no service simply sits there; the Stage 4 and 5 forms remain the primary path and `verify:agent` A5 asserts every task has a model-free fallback whose copy itself passes the language and numbers gates.
- [x] **A1-A7 PASS** — 53/53 recorded, 67/67 with real HTTP. Canaries checked against both the built context and the prompts that actually went over the wire. **A8 is PENDING**: thinking-off against the live endpoint cannot be settled without a key, and is reported as pending rather than silently passing.

## Verification
`verify:agent` (recorded + live); manual chat run-through.

## Build Log

### 2026-11-08 — Stage 6 built

**Decisions taken before building** (asked up front):
- **Env-driven provider tiers plus a bundled mock.** Nemotron stays tier 1 by
  default, but `AGENT_BASE_URL` / `AGENT_MODEL` / `AGENT_API_KEY` point tier 1 at
  any OpenAI-compatible endpoint. The mock means the entire path is runnable and
  verifiable today with no key.
- **A shared secret guards the `agent` role.** Without it any client could claim
  the role and author agent messages, and "the agent proposes; humans decide"
  (02 Ground Rules #4) would rest on nothing.
- **Strict numbers whitelist, with engine-derived integers allowed.** Counts and
  durations the engine emitted pass; anything else must be traceable.

**Built**
- **Module** — `agent_job`; `sendMessage` now queues a job; agent-only reducers
  `registerAgent`, `claimJob`, `setJobProgress`, `completeJob`, `failJob`,
  `postAgentMessage`, `nameBranches`, `applyEventInterpretation`,
  `applyConstraintTranslation`, plus `requestBranchNaming` for humans.
- **Service** (`services/agent`) — `providers.ts` (tiers, forced tool calls,
  Nemotron quirks), `context.ts` (the single allowlist + prompt logging),
  `validate.ts` (four gates), `tasks.ts` (retry-then-failover), `tools.ts`,
  `fallbacks.ts`, `mock-server.ts`, and the job loop in `index.ts`.
- **App** — Chat shows live progress text, agent-authored messages in the agent
  colour, tap-able follow-up chips that answer an event parameter, and copy that
  changes depending on whether an agent is registered.
- **Verification** — `verify:agent` (A1-A7, two modes) and `verify:agent:e2e`
  (the real service over the real bus).

**Verification**

| Suite | Result |
|---|---|
| `verify:agent` — recorded | **53/53 PASS** |
| `verify:agent` — mock mode, real HTTP | **67/67 PASS** |
| `verify:agent:e2e` — real service, real bus | **27/27 PASS** |
| `verify:engine` / `flow` / `math` / `purity` / `inference` | 66/66 · 158/158 · 18/18 · 14/14 · 28/28 |
| `npm run verify` | **8/8 suites behaved as expected** |
| `npm run typecheck` | clean — now including `services/agent` **and** `scripts/verify` |
| Metro bundle | web, iOS and Android all compile (1006 / 1524 / 1521 modules) |

**Decisions and notes**

1. **The whitelist is only as tight as the data behind it.** Passing the raw
   `computeImpact` output into the model context whitelists every month index
   from 0 to 119, because the 120-month series contains them — so "pushes Japan
   back 47 months" would have sailed through. The module already strips the two
   projections before storing (Stage 4) and the service sends the stripped shape;
   `verify:agent` A3j/A3k now assert the series is **absent** from the context,
   so the gate cannot be quietly defeated later.
2. **Thinking-off is treated as a tier failure, not a validation failure.**
   Reasoning content or `finish_reason: length` means the budget was eaten before
   the tool arguments, so there is nothing to correct — retrying the same tier
   would waste a call. It fails over instead.
3. **Thinking-off is only sent to NVIDIA endpoints.** `chat_template_kwargs` is
   a Nemotron parameter; sending it to OpenAI would be noise at best.
4. **Constraints the agent reads out of a sentence are recorded as the
   *member's*.** The lock belongs to whoever said it; the agent only translated.
5. **An event the agent creates starts as `draft`** while follow-ups are
   outstanding, so an impact is never computed from half-known parameters.
6. **`select_branches` failing is invisible to the couple**, by design: the
   engine already named the branches with templates when it generated them, so
   the fallback is literally "leave what is on screen".
7. **The service keeps its identity across restarts** via `AGENT_TOKEN`, and
   prints the token on first connect.
8. **`scripts/verify` and `services/agent` are now typechecked.** Neither had a
   tsconfig, so neither was in `npm run typecheck` — and both contained real type
   errors, including a wrong `onError` arity that had been copied into three
   files.

**Problems solved along the way**

- **A reducer's `onError` takes one argument**, not two; the error arrives on the
  context. Three files had the two-argument form, silently un-typechecked.
- **A no-arg reducer's binding still expects an argument** (`{}`), so
  `runInference()` had to become `runInference({})`.
- **The agent served the wrong household.** Picking the *first* household serves
  the oldest leftover on a dev database; picking the newest *without an agent*
  makes the service hop forever, because registering gives that household an
  agent and the next leftover becomes the target. It now takes the newest
  household overall and only ever moves to one strictly newer.
- **An agent identity may move households; a human may not.** One service
  serving whichever household exists is normal in development, but letting a
  human do it would let someone walk out of their own plan.
- **Two stray service processes were fighting over the role**, each deleting the
  other's member row. Worth remembering when the demo machine has been running a
  while: `pkill -f "src/index.ts"`.
- **Nothing promoted an event from `draft` to `active`**, which made the status
  decorative. Answering the last outstanding follow-up now activates it.
- **Two mock-mode checks were passing for the wrong reason.** The mock could not
  find the candidates (nested under `engineData`) and so returned no tool call at
  all — a rejection, but not the one being tested. The checks now assert the
  **gate** rather than a boolean, which is what exposed it; and the mock's
  prompt parsing is brace-balanced and correction-aware, since `runTask` appends
  a correction after the JSON on a retry.
- **Reusing one port for successive mocks is a race**: the dying server can still
  answer while its replacement fails to bind, invisibly. Each mock now gets a
  fresh port.

**Open**

- **A8 — thinking off against the live endpoint.** The only thing a mock cannot
  settle, along with whether `nvidia/nemotron-3.5-bolt-e4b` is a live model name.
  One command when a key exists: `npm run -w @branches/agent smoke`.
- **OPEN(OD-19): the agent shared secret is a module constant** committed to the
  repo. It stops a casual client from claiming the role but is not secret from
  anyone who can read the source. A real deployment wants it injected at build
  time. Proportionate while all data is mock and the repo is private.
- `explain` and `general_chat` job kinds are specified but unused — nothing
  currently queues them. The handler switch falls through to a fallback.
- **Maincloud is five schemas behind.**
- Visual checks unrun: progress text appearing on both screens, chips answering,
  agent-coloured messages.

