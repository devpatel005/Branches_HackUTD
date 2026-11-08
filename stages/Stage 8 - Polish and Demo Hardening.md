---
tags: [branches, stage]
status: in-progress
---
# Stage 8 — Polish and Demo Hardening

**Goal:** it looks like a real product and cannot break on stage.

## Starting point
Stage 7 complete: full journey works.

## Read first
[[09 Design System]] · [[10 Screens#States every screen needs]] · [[12 Verification#V8 UI checklist]] · [[12 Verification#Demo run-through]]

## Build
1. Full design pass against the design system: typography, spacing, number rolling, card arrival, pulses, haptics.
2. Every state on every screen: loading (no flashing), empty, reconnecting, error with retry, agent unavailable.
3. Demo profile (OD-1, once decided) and a one-command reset.
4. Agent failover and fallbacks exercised; timeouts tuned so the demo never waits more than a few seconds.
5. Wide-screen web layout (centered column; branch cards in a row).
6. README for judges: what it is, tracks, how to run, architecture diagram.

## Done when
- [ ] V8 checklist passes.
- [ ] Demo run-through passes three times in a row, including once with the agent service stopped.
- [ ] Backup recording exists.
- [ ] Public GitHub repo ready (SpacetimeDB track requirement).

## Build Log

### Pass 1 — Gemini, robustness, never-stuck, reducer hardening (2026-11-08)

Scope chosen by the team: **functionality over presentation.** The design pass,
the demo profile (OD-1), the one-command reset, the wide-screen layout and the
judges' README are all still open — see "Not done" below. Planned in
[[17 Stage 8 Handoff]].

#### 1. Gemini replaces Nemotron

`@google/genai` 3.0.0, Interactions API, per the rewritten [[07 Agent Spec]].
Every shape in the spec checked out against the installed SDK; the findings that
were **not** in the spec are in [[14 Research Notes#Gemini]].

`providers.ts` was rewritten around a provider interface rather than a request
builder with flags. Both adapters return one normalised result:

```ts
{ status: 'completed' | 'requires_action' | 'incomplete' | 'failed' | 'unknown',
  rawStatus, toolCall: { id, name, arguments } | null, text, reasoning }
```

That is the load-bearing decision. `tasks.ts`, `validate.ts`, `context.ts` and
`fallbacks.ts` never learn which provider answered, so the four validation gates
and the retry policy cannot drift apart per provider. `context.ts`,
`validate.ts` and `fallbacks.ts` needed **no change at all**, which is the
return on having had a single context builder.

- `ToolSpec` is now Gemini's flat `{ type, name, description, parameters }`.
  Gemini is the primary, so it is the canonical form; the OpenAI adapter nests
  it at call time.
- Tiers: `gemini-3.8-flash` at `thinking_level: "low"`, then
  `gemini-3.5-flash-lite` at `"minimal"`. Provider selection is
  `AGENT_PROVIDER` → `AGENT_BASE_URL` (the OpenAI escape hatch, kept) → Gemini.
- Nemotron tiers removed. **This forfeits the NVIDIA track** — OD-16 reopened.

Three things cost real time and are now pinned by tests rather than by comment:

1. **`interactions.create` ignores constructor-level retry config.** Neither
   `new GoogleGenAI({ retries })` nor `httpOptions.retryOptions` reaches it; it
   silently makes *five* backed-off attempts on a 429. Our failover never got a
   turn. Retries have to be disabled **per request**. `verify:agent` M15 times a
   429 and fails if it takes more than 5 seconds, so a regression here is loud.
2. **`error.message` hides the reason.** A rejected key arrives as
   `400 API error occurred: {"httpMeta":{...}}`; the explanation is in
   `error.body`. `messageOf` unwraps it — which is the only reason the live
   failure below was diagnosable in one step instead of several.
3. **`GEMINI_BASE_URL` is an origin, not a URL with a path.** The SDK appends
   `/v1/interactions`. Handing it a `/v1` base is a 404 that reads as a model
   failure.

#### 2. The mock speaks Gemini

`mock-server.ts` now serves **both** `POST /v1/interactions` and
`POST /v1/chat/completions`. The Gemini route matters more than it looks: the
keyless verification now drives the real `@google/genai` adapter — request body,
`status` handling, `steps` parsing — rather than a code path the demo never
takes. New knobs: `MOCK_STATUS`, `MOCK_TRUNCATE`, `MOCK_DELAY_MS`.

`MOCK_TRUNCATE` is the sharp one. It returns `status: incomplete` *together with
a plausible tool call*, which is what hitting the output budget mid-arguments
actually looks like. The status has to win, or the outcome depends on which field
the code happens to read first.

#### 3. Agent robustness

- **`incomplete` / `failed` / `unknown` are tier failures**, not answers. For
  `incomplete` the next tier is the right move rather than a retry: retrying the
  same tier hits the same ceiling, and the next tier thinks less.
- **A wall-clock budget per task** (`AGENT_TASK_BUDGET_MS`, 60s). Attempts alone
  are not a bound — two tiers × two attempts × a 20s timeout is 80 seconds of
  spinner. A tier whose timeout cannot fit in what is left is not started.
- **A job can no longer wedge in `running`.** This was the worst of the lot: if
  the service died between `claimJob` and `completeJob`, the row stayed `running`
  forever, and because `claimJob` refuses while anything in the household is
  running, that household's agent was dead **permanently**. Fixed in three
  places:
  - `agent_job` gained `claimedAt`, and `setJobProgress` refreshes it — so
    progress doubles as a heartbeat and a slow job is never stolen from a live
    instance.
  - `reclaimStaleJobs` requeues anything `running` past 120s, or fails it once
    it has had `MAX_JOB_ATTEMPTS` (3). Unbounded requeuing would be a loop: a
    job that crashes the service will crash it again. Failing it hands the user
    the deterministic fallback, which is what that fallback is for.
  - It runs **inside `claimJob`** as well as standalone, so a restarted service
    recovers without needing to know it crashed. The service also sweeps on
    start-up and every 30s, for jobs abandoned by an instance that is now gone.
  - Exposed as `reclaimJobs`, agent-only like every other job reducer. `R5` in
    `verify:agent:e2e` asserts a human cannot call it; `E14` asserts a finished
    job keeps no claim stamp, so the sweep can never "recover" delivered work.

#### 4. Never-stuck audit → a verification suite

Rather than read every screen once, the invariants are now asserted:
`npm run verify:screens` (**V9 Never-stuck**, 18 checks). These regressions are
all one line long and invisible in development, where the server is always up
and the data always arrives; the failure only shows up on stage.

Found and fixed:

- **`Loading` had no escape.** Six screens short-circuit to it, and every one
  spun indefinitely when the server was down, the module unpublished or the host
  wrong — none of which resolve by waiting. It now reveals an explanation after
  8s and offers a reload. Fixing the one component fixed all six, and a screen
  added later inherits the floor.
- **A connect error only reached `console.warn`** — perfect for whoever is
  running the dev server, useless to anyone looking at the app. The provider now
  exposes it as state (`useConnectionTrouble`) and `Loading` names it.
- **A registered agent is not a live agent.** If the service dies mid-job the
  row stops changing, so no subscription event ever arrives and "Thinking…" sits
  there. `useAgentActivity` gained `stalled`, driven by an interval — without a
  clock there is nothing to re-render when the thing being detected is the
  *absence* of change. The interval only runs while work is outstanding. Both
  screens that show progress now offer the way around it. In the session that
  way around is honest: the cards already carry the engine's own template names,
  so a quiet assistant costs the naming and nothing else.
- **The waiting room was a trap.** `createHousehold` refuses once you are
  already a member, so a user who landed there with a typo in their name, or
  alone with one laptop, had no action on screen and no way back. It now explains
  why two people are needed, lets the name be fixed in place, and points at
  `?device=b`.
- **`onboarding/goals.tsx` rendered a blank page** (`if (!household) return
  null`) mid-onboarding. Now `Loading`.
- **An empty branch list offered only waiting.** Branch cards normally arrive
  with template names the moment candidates are generated, so an empty list means
  generation produced nothing — which waiting will not fix. Now a retry and a way
  back.

S1 (no screen bails out to a blank page) is scoped to the **default export**, not
by indentation: `if (!branch) return null` in a closed sheet is correct, and an
indentation rule reports it as if it were a blank page. The check was confirmed
to bite by reintroducing the `goals.tsx` defect and watching it fail.

#### 5. Reducer hardening

The reducers were already careful about *who* and *which enum*. They were not
careful about *how big*: an argument goes straight into a row, and `household`,
`member`, `goal` and `chat_message` are public — so an unbounded string is not
one client's problem, it is a row every subscriber downloads, forever.

A guard block near the top of the module, applied across every reducer that
takes free text or money. **Two deliberately different policies:**

- **Free text is truncated** (`cap`, `capTrim`). A clipped name is recoverable
  and never interrupts what someone was doing.
- **Numbers are rejected** (`requireMoneyCents`). Silently clamping somebody's
  money to a different figure is worse than refusing it, because the plan would
  then be built on a number they never typed.

`MAX_MONEY_CENTS` is $1,000,000 — below `i32` max ($21,474,836) with room, so
nothing that passes can overflow its column, and 120 months of compounding on it
stays finite. That last part matters: an infinite intermediate makes `toCents`
throw deep inside the engine, where the only remaining signal is a reducer-wide
failure.

`safeParams` bounds event parameter lists before `parseParams` sees them.
`parseParams` validates *meaning*; it has no reason to also defend against a
thousand entries. Unknown keys are still left to it, so the error names the
parameter.

18 checks (`H1`–`H18`) in `verify:flow` cover money at the ceiling, truncation
that still succeeds, unknown ids on six reducers, a stale session, an oversized
message, an unknown template and profile, and 500 event parameters.

#### 6. `.env` was never being read

`cp services/agent/.env.example services/agent/.env` has been in [[CLAUDE]]
since Stage 0, and **nothing loaded it** — no dotenv, no `--env-file`. A key set
there was silently ignored. The agent scripts now use Node's
`--env-file-if-exists=.env`.

### Verification

| Suite | Before | After |
|---|---|---|
| V1 Math | 18/18 | 18/18 |
| V2 Engine | 66/66 | 66/66 |
| Engine purity | 14/14 | 14/14 |
| V3 Inference | 28/28 | 28/28 |
| Stage 0 data path | 8/8 | 8/8 |
| V4 Data flow | 158/158 | **176/176** (+18 hardening) |
| V5 Agent contract | 53/53 | **72/72** (+19: Gemini tiers, normalisation) |
| V5 mock mode | 67/67 | **94/94** (through the real Gemini adapter) |
| V5 end to end | 27/27 | **29/29** |
| V7 Ready check | 28/28 | 28/28 |
| **V9 Never-stuck** | — | **18/18** (new) |

`npm run verify` → all 10 suites behaved as expected. `npm run typecheck` clean
across all five workspaces. Metro bundles clean for web, iOS and Android.

The local module needed a **destructive republish** for the `claimedAt` column:
SpacetimeDB 2.14's TypeScript schema API has no default-value annotation, so
`spacetime publish --server local --delete-data=on-conflict` was the only path.
That wiped the local dev database, whose contents were accumulated verify runs.
Maincloud is untouched and now **seven** schemas behind.

### A8 — attempted live, and it failed for a reason worth recording

`npm run -w @branches/agent smoke` was rewritten for Gemini and run against the
real endpoint with the key from the vault `Creds.md`. Both tiers returned:

```
400 BadRequestError: API key not valid. Please pass a valid API key.
```

This is **not** a request-shape problem — a bare call with no tools, no
`thinking_level` and no `tool_choice` fails identically, so the request never got
as far as being judged. The credential itself is rejected.

The key was extracted faithfully and completely (verified against the raw line
length in `Creds.md`, without printing it). The likely cause is its format: it is
53 characters beginning `AQ.`, whereas an AI Studio API key is ~39 characters
beginning `AIza`. An `AQ.` credential is an ephemeral/session token, not an API
key — and would have expired regardless. It is also possible the key was revoked,
since it was printed in full in an earlier session's transcript when a masking
pattern failed to match that prefix.

**Superseded 2026-11-08 — A8 is SETTLED, 6/6 on both tiers.** The cause was a
stale `GEMINI_API_KEY` exported from `~/.zshrc`, which Node's
`--env-file-if-exists` will not override, so the valid key in
`services/agent/.env` was never used. Fixed by `services/agent/src/env-file.ts`,
which makes `.env` authoritative and names whatever it displaces. Full account:
[[18 Stage 8 Pass 1 Record]] §1. The paragraph below is left for the record and
is **wrong**.

~~So A8 remains PENDING, and it needs a person~~, not more code: create an API
key in AI Studio and put it in `services/agent/.env` as `GEMINI_API_KEY`. Then
`npm run -w @branches/agent smoke` prints `A8 SETTLED` or names exactly what the
model rejected. Everything around it is built and proven against the real SDK.

### Not done this pass (deliberately)

Out of scope by the team's instruction, and still open:

- The design pass: typography, spacing, number rolling, card arrival, pulses,
  haptics, wide-screen web layout.
- The demo profile (OD-1) and the one-command demo reset.
- The README for judges, and the public repo the SpacetimeDB track requires.
- Connection-loss / reconnect **banner**. Note what *was* done: a failed
  connection is now visible and recoverable from `Loading`. What is missing is
  the banner for a connection lost *after* a screen has data.
- The V8 UI checklist and the three-times demo run-through, which are manual.
- The backup recording.

### Left open, newly noticed

- **No way to leave a household.** `createHousehold` refuses once you are a
  member and there is no inverse, so an identity is bound to its household
  permanently. Mitigated in the waiting room (the name can be corrected in
  place), but a wrong *household* is still unrecoverable without clearing browser
  storage. A `leaveHousehold` reducer is a real decision about what to do with
  that member's transactions, items and goals, so it was not invented here.
- **`general_chat`** is specified but still never queued.
- **The flow suite's table renders 256-character columns.** Pre-existing and
  cosmetic; one check's value is that long and `printTable` pads every row to the
  widest. Not introduced by this pass.

