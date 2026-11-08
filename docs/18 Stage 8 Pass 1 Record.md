---
tags: [branches, handoff, stage8, record]
---
# 18 Stage 8 Pass 1 — Full Record

Everything changed in the Stage 8 pass of **2026-11-08**, in detail, written to
be read *after* this session's context is gone.

Commit `f3df189` — "Stage 8 pass 1: Gemini, robustness, never-stuck, reducer
hardening". 36 files, +2826 / −506. Pushed to `main`.

**§1 was rewritten on 2026-11-08**: the Gemini API problem is **solved** and
A8 is settled. Read it for the cause and the fix — not as an open issue.

Related: [[Stage 8 - Polish and Demo Hardening]] (the Build Log, which is the
canonical narrative) · [[17 Stage 8 Handoff]] (the plan this pass worked from,
now superseded) · [[14 Research Notes#Gemini]] (SDK facts) · [[07 Agent Spec]].

---

## 1. The Gemini API problem — SOLVED 2026-11-08

**A8 is SETTLED.** The live model works: `6/6 passed`, both tiers, forced tool
call parsed and in schema. Nothing here is outstanding.

```
PASS  t1 gemini-3.8-flash: a forced tool call came back             classify_life_event
PASS  t1 gemini-3.8-flash: not truncated (status is not incomplete) requires_action
PASS  t1 gemini-3.8-flash: arguments match the schema               baby
PASS  t2 gemini-3.5-flash-lite: a forced tool call came back        classify_life_event
PASS  t2 gemini-3.5-flash-lite: not truncated                       requires_action
PASS  t2 gemini-3.5-flash-lite: arguments match the schema          baby
```

### The cause: a stale key in `~/.zshrc` shadowed the real one

`~/.zshrc:20` exported a **different, invalid** `GEMINI_API_KEY` (an `AIza…`
value, 39 chars) left over from earlier work. Node's `--env-file-if-exists`
**deliberately does not override variables already set in `process.env`**, so
the shell's dead key won and the valid key sitting in `services/agent/.env`
was never used. Every call came back:

```
400 BadRequestError: API key not valid. Please pass a valid API key.
```

which reads exactly like "the key in `.env` is bad" when the key in `.env` was
fine the whole time.

### How it was isolated

Curling the REST endpoint directly, same body, same header, one variable
changed at a time:

| API version | Key | Result |
|---|---|---|
| `/v1/interactions` | `.env` (the real one) | **HTTP 200** |
| `/v1/interactions` | `~/.zshrc` | HTTP 400 `API_KEY_INVALID` |
| `/v1beta/interactions` | `~/.zshrc` | HTTP 400 `API_KEY_INVALID` |

The key is the only variable that changes the outcome; the API version is not
implicated. Then a fetch-instrumented SDK probe printed
`env GEMINI_API_KEY: prefix=AIza len=39` — proving which value the process had
actually received, which is the fact every earlier guess was missing.

### The fix, so it cannot recur

`services/agent/src/env-file.ts` (new) makes `.env` **authoritative over the
ambient shell** and names anything it displaces:

```
.env overrides GEMINI_API_KEY from the environment:
    .env         AQ.A…(53 chars)
    environment  AIza…(39 chars)   <- ignored (check ~/.zshrc)
```

Credentials are masked to prefix + length — enough to tell two keys apart,
never enough to leak one. Imported for its side effect as the **first** import
in `src/index.ts` and `src/smoke.ts`, ahead of anything that reads
`process.env`. A service directory's own config file should beat whatever
happens to be exported in the terminal that started it.

Verified by running `npm run -w @branches/agent smoke` with the stale export
still in place: 6/6, with the warning above.

### Recommended cleanup (optional, your call — it is your dotfile)

Delete or fix `~/.zshrc:20`. The project no longer needs it removed, but any
*other* tool reading `GEMINI_API_KEY` from your shell — the Gemini CLI, a
scratch script — is still getting the dead key.

### What this corrects

An earlier draft of this section concluded the key in `Creds.md` was an
invalid `AQ.`-prefixed **ephemeral session token** and told you to replace it.
**That was wrong, and the reasoning is worth knowing because it is a trap.**
The `AQ.` prefix and 53-char length genuinely do match Gemini's documented
ephemeral-token format, and the SDK itself warns that ephemeral tokens are
`v1alpha`-only. The inference was plausible, internally consistent, and
confirmed by a bare request that failed identically — and still false, because
every one of those observations is about a key the process **was not using**.
The lesson: when a credential is rejected, print what the process actually
received before reasoning about what it should have received.

`Creds.md` is correct as it stands. Do not replace the key in it.

### Facts established along the way

- Both spec'd model names are real and available: `gemini-3.8-flash` and
  `gemini-3.5-flash-lite` both appear in `v1beta/models` for this key.
- The SDK is the right one and current: `@google/genai` **3.0.0** is the latest
  published version, and `interactions.create` is present with the exact
  parameter shapes used in `providers.ts`.
- The SDK POSTs to `https://generativelanguage.googleapis.com/v1/interactions`
  with the key in an `x-goog-api-key` header.
- **Rate limits are per Google Cloud *project*, not per key.** Give each
  developer their own project and keep a separate one for the demo, or testing
  will exhaust the demo's quota.

---

## 2. The Gemini integration

### 2.1 Why this was an adapter rewrite, not a config change

Nemotron was OpenAI-compatible, so Stage 6's provider layer was one request
builder with a `nemotron: boolean` flag. Gemini's Interactions API shares no
shape with it: one `input` string instead of a message array,
`system_instruction` instead of a system turn, a flat tool declaration, a
response with `status` + `steps` instead of `choices[].message`, and errors
*thrown* as typed exceptions instead of returned as responses.

### 2.2 The normalised result — the load-bearing decision

`services/agent/src/providers.ts` now holds two adapters behind one shape:

```ts
export type NormalisedResult = {
  status: 'completed' | 'requires_action' | 'incomplete' | 'failed' | 'unknown';
  rawStatus: string;                                       // the provider's own word
  toolCall: { id: string; name: string; arguments: unknown } | null;  // ALREADY PARSED
  text: string;
  reasoning: string | null;   // OpenAI leaked chain-of-thought; always null for Gemini
};
```

Why it matters: `tasks.ts`, `validate.ts`, `context.ts` and `fallbacks.ts` never
learn which provider answered. The four validation gates and the retry policy
therefore **cannot drift apart per provider**.

The proof that this worked: **`context.ts`, `validate.ts` and `fallbacks.ts`
needed no change at all.** That is the return on Stage 6's single context
builder.

`toolCall.arguments` is a parsed object for both providers. Gemini hands back an
object; the OpenAI adapter does the `JSON.parse` itself, so a malformed argument
string is a provider concern rather than every task's concern (it surfaces as
`status: 'failed'`, which `tasks.ts` already knows how to handle).

### 2.3 Tiers and provider selection

```
tier 1   gemini-3.8-flash        thinking_level: "low"       (GEMINI_MODEL)
tier 2   gemini-3.5-flash-lite   thinking_level: "minimal"   (GEMINI_FALLBACK_MODEL)
tier 3   optional OpenAI-compatible, only if FALLBACK_LLM_* is set
```

Selection order in `tiersFromEnv`:

1. `AGENT_PROVIDER=gemini|openai` — explicit, wins.
2. `AGENT_BASE_URL` set → `openai`. The escape hatch for trying any endpoint
   without touching code; deliberately kept.
3. Otherwise Gemini.

A tier with no key is dropped, **except** against `127.0.0.1` / `localhost`,
which is what makes the whole path runnable with no key. Tier numbers are
renumbered after filtering, so a failure message can never name a tier that is
not in the chain (`A6o`).

Nemotron tiers are gone. **This forfeits the NVIDIA track** — OD-16 is reopened
in [[13 Open Decisions]], and [[CLAUDE]] now says the third track is open.

### 2.4 Three SDK findings that are not in the spec

These cost real time. Each is now pinned by a test rather than only a comment,
and all three are in [[14 Research Notes#Gemini]].

**(a) `interactions.create` ignores constructor-level retry configuration.**
Neither `new GoogleGenAI({ retries })` nor `httpOptions.retryOptions` reaches
it. Left at the default it makes **five** backed-off attempts on a 429 or 5xx.
On a free-tier rate limit that is tens of seconds burned per tier, and our own
failover never gets a turn. Retries must be disabled **per request**:

```ts
await client.interactions.create(params, {
  retries: { strategy: 'none' },
  timeout_ms: timeoutMs(),
});
```

`verify:agent` **M15** times a 429 and fails if it takes over 5 seconds, so a
regression here is loud rather than merely slow.

**(b) `error.message` hides the reason.** A rejected key arrives as
`400 API error occurred: {"httpMeta":{"response":{},"request":{}}}`. Google's
actual explanation is only in `error.body`. `messageOf` + `googleErrorMessage`
in `providers.ts` unwrap it — which is the only reason §1's failure was
diagnosable in one step instead of several. The body is sometimes an *array* of
envelopes rather than one object, which the parser handles.

**(c) `GEMINI_BASE_URL` is an origin, with no path.** The SDK appends
`/v1/interactions` itself. Handing it a `/v1` base is a 404 that reads as a
model failure — this actually happened mid-session when a stale mock was still
listening on the port.

Also confirmed, and matching the spec: `ThinkingLevel` is
`"minimal" | "low" | "medium" | "high"`; `tool_choice.allowed_tools` is
`{ mode, tools: string[] }`; a function tool is the flat
`{ type: "function", name, description, parameters }`; a `function_call` step
carries `{ type, id, name, arguments }` with `arguments` already parsed;
timeouts raise `APIConnectionTimeoutError` with **no** `.status`.

### 2.5 The mock now speaks Gemini — and what that does and does not prove

`services/agent/src/mock-server.ts` serves **both**:

```
POST /v1/interactions      Gemini Interactions  → GEMINI_BASE_URL=http://127.0.0.1:8099
POST /v1/chat/completions  OpenAI-compatible    → AGENT_BASE_URL=http://127.0.0.1:8099/v1
```

Because the SDK POSTs its body verbatim, pointing `GEMINI_BASE_URL` at the mock
means the keyless verification drives the **real `@google/genai` adapter** —
request construction, `status` handling, `steps` parsing, error classes — rather
than a code path the demo never takes.

**It proves:** our request shape is built correctly; every response status is
interpreted correctly; retry, failover, truncation handling, the four gates and
prompt logging all work over real HTTP.

**It cannot prove:** that the model names exist, or that Google accepts
`thinking_level` and `tool_choice` as sent. That is precisely and only A8.

New behaviour knobs:

| Knob | Effect |
|---|---|
| `MOCK_FAIL_STATUS=429` | That HTTP status, with the **Google** error envelope on the Gemini route and the OpenAI one on the other — the SDK parses them differently |
| `MOCK_STATUS=incomplete\|failed` | End the interaction with that status |
| `MOCK_TRUNCATE=1` | `status: incomplete` **together with a plausible tool call** |
| `MOCK_DELAY_MS=30000` | Answer slowly, for timeout and budget tests |
| `MOCK_INVENT_NUMBER=1` | A number no engine data contains (numbers gate) |
| `MOCK_ADVICE=1` | Advice language (language gate) |
| `MOCK_THINKING=1` | `reasoning_content`, OpenAI shape only |

`MOCK_TRUNCATE` is the sharp one. Hitting the output budget mid-arguments looks
exactly like that: a usable-looking function call *and* `incomplete`. The status
has to win, or the outcome depends on which field the code happens to read
first.

### 2.6 Tool declarations flattened

`services/agent/src/tools.ts` — all four tools moved from OpenAI's nested
`{ type, function: { name, description, parameters } }` to Gemini's flat
`{ type, name, description, parameters }`. Gemini is the primary, so its shape is
the canonical one; the OpenAI adapter nests it at call time. `SYSTEM_PROMPT` is
unchanged.

---

## 3. Agent robustness

### 3.1 `incomplete` / `failed` / `unknown` are tier failures, never answers

`services/agent/src/tasks.ts`, function `unusable()`. A 200 OK with
`status: incomplete` means the output budget was hit — and that budget
**includes thinking tokens** — so text or arguments are truncated. Trusting it
puts half a sentence on screen.

The response is the *next tier*, not a retry: retrying the same tier hits the
same ceiling, while tier 2 thinks less (`minimal` vs `low`) and may not.

`unknown` covers `in_progress`, `queued`, `requires_continuation`. We never ask
for streaming or background work, so seeing one of those means an assumption
broke — it is reported rather than silently treated as success.

### 3.2 A wall-clock budget per task

`AGENT_TASK_BUDGET_MS`, default 60000, in `tasks.ts`.

Attempts alone are not a bound: 2 tiers × 2 attempts × a 20s timeout is **80
seconds**, during which the job sits `running` and the couple watches a spinner.
A tier whose timeout cannot fit in the remaining budget is **not started** —
beginning a call that cannot finish only delays the fallback the user actually
needs.

`A9l` / `A9m` assert the budget exists and exceeds one call timeout.

### 3.3 A job can no longer wedge in `running` — the worst bug found

**The failure:** the service dies between `claimJob` and `completeJob` (crash,
Ctrl-C, laptop sleep). The row stays `running` forever. Because `claimJob`
refuses while *anything* in the household is running, that household's agent is
dead **permanently** — and both partners watch a spinner that will never stop.

Fixed in four places:

1. **`agent_job.claimedAt`** — new `t.option(t.timestamp())` column in
   `server/spacetime/src/schema.ts`. Set by `claimJob`, cleared by
   `completeJob` / `failJob`.
2. **`setJobProgress` refreshes it.** Progress doubles as a heartbeat, which is
   what distinguishes a job that is *slow* from one whose service has *died*. A
   live instance never has work stolen from under it.
3. **`reclaimStaleJobs(ctx, householdId)`** in `server/spacetime/src/index.ts`
   requeues anything `running` past `STALE_JOB_MICROS` (120s — comfortably
   longer than the 60s task budget), or **fails** it once it has had
   `MAX_JOB_ATTEMPTS` (3). Unbounded requeuing would be a loop: a job that
   crashes the service will crash it again. Failing it hands the user the
   deterministic fallback, which is what that fallback is for.
   A row written before the column existed has no claim time and is treated as
   stale rather than immortal.
4. **It runs inside `claimJob` as well as standalone**, so a restarted service
   recovers without needing to know it crashed. `claimJob` then **re-reads** the
   job, because the sweep may have just requeued or failed the very row it was
   asked about.

Exposed as reducer **`reclaimJobs`** — agent-only, like every other job reducer,
so this is not a route for one partner to disturb the other's in-flight work.
The service calls it on start-up and every `AGENT_RECLAIM_MS` (30s), for jobs
abandoned by an instance that is now gone.

Asserted in `verify:agent:e2e`: **R5** a human cannot call `reclaimJobs`;
**E14** a finished job carries no claim stamp, so the sweep can never "recover"
work that was already delivered.

### 3.4 Transport failures

`CallResult` gained `retryable`. A transport, quota or rate-limit failure is not
the model's fault, so there is nothing to correct — the next tier is the only
useful move, and no retry is spent on the current one.

---

## 4. Never-stuck audit → a verification suite

Rather than read every screen once, the invariants are asserted:
`npm run verify:screens` → **V9 Never-stuck**, 18 checks, new file
`scripts/verify/screens.ts`, wired into `run-all.ts` and both `package.json`s.

It is a static scan **deliberately**. These regressions are each one line long
and invisible in development, because locally the server is always up and the
data always arrives. The failure only appears on stage, which is the one place
nobody can fix it.

### 4.1 What was found and fixed

**`Loading` had no escape** — `apps/mobile/src/components.tsx`.
Six screens short-circuit to it. Every one spun indefinitely when the server was
down, the module unpublished, or the host wrong — **none of which resolve by
waiting**. After `SLOW_MS` (8s) it now reveals an explanation, names the
connection problem if there is one, and offers a reload (web) or "close and
reopen" (native). Fixing the one component fixed all six, and any screen added
later inherits the floor for free.

**Connection errors only reached `console.warn`** —
`apps/mobile/src/spacetime.tsx`. Perfect for whoever is running the dev server,
useless to anyone looking at the app. The provider now exposes the error as
state via a new `useConnectionTrouble()` hook, and clears it on a successful
connect so a recovered connection stops nagging. `Loading` reads it.

**A registered agent is not a live agent** — `apps/mobile/src/events.ts`.
If the service dies mid-job, the `agent_job` row simply stops changing, so **no
subscription event ever arrives** and "Thinking…" sits there. `useAgentActivity`
gained:

```ts
stalled: boolean        // outstanding work quiet for > AGENT_QUIET_MS (20s)
quietSeconds: number
```

driven by a `setInterval` — because without a clock there is nothing to
re-render when the thing being detected is the **absence** of change. The
interval only runs while work is outstanding, so it is not a permanent
re-render tax. It measures from `claimedAt` for running work and `createdAt` for
work never picked up: a job nobody ever claims is just as stuck as one abandoned
halfway.

20s is shorter than the 60s task budget and the 120s module threshold **on
purpose**: it is an offer of the form while the job keeps trying, not a
declaration that it failed. Being early costs nothing because the deterministic
path is always available.

Both screens that show progress now surface it. In the session the message is
honest in a specific way: the cards already carry the engine's own template
names, so a quiet assistant costs the *naming* and nothing else — the paths are
safe to choose.

**The waiting room was a trap** — `apps/mobile/app/welcome.tsx`.
`WaitingForPartner` had no action of any kind. `createHousehold` refuses once
you are already a member, so someone who landed there with a typo in their name,
or alone with one laptop, had nothing on screen and no way back. It now:
explains why two people are needed (the shared baseline requires both); lets the
display name be corrected in place; and on web points at `/?device=b`, which is
the documented way to get a second identity in one browser, since AsyncStorage
on web *is* localStorage and is per-origin rather than per-tab.

**`onboarding/goals.tsx` rendered a blank page** — `if (!household) return
null` mid-onboarding: nothing to read, nothing to tap. Now `Loading`.

**An empty branch list offered only waiting** — `apps/mobile/app/session.tsx`.
Branch cards normally arrive with engine template names the moment candidates
are generated, so an empty list means generation produced nothing or never ran —
which waiting will not fix. Now a "Try again" (regenerate + request naming) and
"Back to Chat", plus a notice explaining that the engine needs at least one path
fitting every constraint.

### 4.2 One design note on the suite itself

**S1 is scoped to the default export, not by indentation.** A guarded
`return null` means different things in two places: in the screen component it
is a blank page, while `if (!branch) return null` in a sheet that is not open is
correct. An indentation rule reported the second as if it were the first — it
actually did, on `session.tsx:585`, on the first run.

I confirmed the check **bites** by reintroducing the `goals.tsx` defect and
watching S1 fail, then restoring it. A static check that cannot fail is worse
than no check.

### 4.3 What V9 cannot check

Whether the copy is any good. That stays in the manual V8 UI checklist.

---

## 5. Reducer hardening

### 5.1 The gap

The reducers were already careful about **who** (`requireMember`,
`requireHuman`, `requireAgent`, ownership checks) and **which enum**
(`priority`, `kind`, emoji whitelists, template ids). They were not careful
about **how big**.

That matters more than it sounds: a reducer argument goes straight into a row,
and `household`, `member`, `goal` and `chat_message` are **public tables**. So
an unbounded string is not one client's problem — it is a row that every
subscriber in the household downloads, forever.

### 5.2 Two deliberately different policies

In the new "Input limits" block at the top of `server/spacetime/src/index.ts`:

- **Free text is truncated** (`cap`, `capTrim`). A clipped name is recoverable
  and never interrupts what someone was doing.
- **Numbers are rejected** (`requireMoneyCents`). Silently clamping somebody's
  money to a different figure is worse than refusing it, because the plan would
  then be built on a number they never typed.

### 5.3 The limits

| Constant | Value | Applies to |
|---|---|---|
| `MAX_DISPLAY_NAME` | 40 | `createHousehold`, `joinHousehold`, `setDisplayName` |
| `MAX_GOAL_TITLE` | 60 | `addGoal`, `editGoal` |
| `MAX_ICON` | 8 | `addGoal` |
| `MAX_LABEL` | 80 | `checkAffordability` |
| `MAX_GAP_ANSWER` | 200 | `answerGap` free-text answers |
| `MAX_PARAM_VALUE` | 120 | event parameter keys and values |
| `MAX_PARAM_ENTRIES` | 24 | event parameter list length |
| `MAX_CONSTRAINT_JSON` | 2000 | `addConstraint`, `applyConstraintTranslation` — checked **before** `JSON.parse` |
| `MAX_JOIN_CODE` | 16 | `joinHousehold` lookup |
| `MAX_MONEY_CENTS` | 100,000,000 ($1,000,000) | every money argument |

**Why $1,000,000:** below `i32` max ($21,474,836) with room, so nothing that
passes can overflow the column it is stored in — *and* 120 months of compounding
on it stays finite. That second part is the real reason. An infinite intermediate
makes `toCents` throw deep inside the engine, where the only remaining signal is
a reducer-wide failure with no useful message.

`requireMoneyCents` also checks `Number.isFinite` / `Number.isInteger`. Not
redundant: `t.i32()` constrains the wire format, but the helper is reachable from
values the engine or a JSON payload produced, where `NaN` would otherwise pass
every `<` comparison silently.

### 5.4 `safeParams`

Bounds event parameter lists before `parseParams` sees them, on both the human
path (`createEvent`) and the agent path (`applyEventInterpretation`).
`parseParams` validates **meaning**; it has no reason to also defend against a
thousand entries or a megabyte value. Unknown keys are still left to it, so the
error a user sees still names the parameter.

### 5.5 Verification — `H1`–`H18` in `verify:flow`

Money at the ceiling (goal cost, fun money both floor and ceiling, affordability,
item edit); truncation that still **succeeds** rather than erroring at the user;
unknown ids on six reducers; a stale session id; an oversized message; an unknown
template and an unknown seed profile; an empty name; and 500 event parameters.

The hardening section creates **its own goal** rather than using the Japan/House
fixture, because section 14's reseed deletes every goal before it runs — the
first version crashed on exactly that.

---

## 6. Smaller things that were still real

### 6.1 `smoke.ts` rewritten

Now walks **every** tier, labels each run LIVE or mock/keyless, and reports: the
call succeeded (a wrong model name shows up here as 404/`NOT_FOUND`); a forced
tool call came back; the status is not `incomplete`/`failed`/`unknown`; and the
arguments match the Zod schema. Prints `A8 SETTLED` only on a live run with
everything passing — a mock run says explicitly that it proves shape, not model.

### 6.2 Module schema change required a destructive local republish

`claimedAt` is a new column, and SpacetimeDB 2.14's **TypeScript** schema API has
no default-value annotation (I checked `spacetimedb/dist/*.d.ts`; there is none).
`publish` therefore refused:

```
Reordering table agent_job requires a manual migration
Adding a column claimed_at to table agent_job requires a default value annotation
```

The only path was:

```bash
spacetime publish --module-path server/spacetime --server local \
  --delete-data=on-conflict --yes=migrate,break-clients,delete-data branches
```

**This wiped the local dev database.** Its contents were accumulated verify runs,
which the suites recreate, so nothing of value was lost. **Maincloud was not
touched** and is now **seven** schemas behind — still needs a person and the same
destructive command (it is in the Stage 2 Build Log).

`spacetime generate` passed, which is the real gate: it is the only command that
catches a plain `export const` in the module.

### 6.3 Bindings regenerated

`packages/bindings/src/` — `agent_job_table.ts` (the `claimedAt` column), a new
`reclaim_jobs_reducer.ts`, plus `index.ts`, `types.ts`, `types/reducers.ts`.

### 6.4 `services/agent/.env` was never being read

`cp services/agent/.env.example services/agent/.env` has been in [[CLAUDE]] since
Stage 0 and **nothing loaded it** — no dotenv dependency, no `--env-file` flag. A
key set there was silently ignored, and anyone following the documented setup
would have concluded the key was bad.

All four agent scripts now use Node's `--env-file-if-exists=.env`, verified
supported on this Node (23.10).

### 6.5 `.env.example` rewritten

Gemini-first, with the OpenAI path kept below it as the secondary. Documents the
per-project rate limits, the "do not set a small `max_output_tokens`" trap, that
`GEMINI_BASE_URL` is an origin, and both new timeout variables.

---

## 7. Verification state

| Suite | Command | Before | After |
|---|---|---|---|
| V1 Math | `verify:math` | 18/18 | 18/18 |
| V2 Engine | `verify:engine` | 66/66 | 66/66 |
| Engine purity | `verify:purity` | 14/14 | 14/14 |
| V3 Inference | `verify:inference` | 28/28 | 28/28 |
| Stage 0 data path | `verify:stdb` | 8/8 | 8/8 |
| V4 Data flow | `verify:flow` | 158/158 | **176/176** (+18 hardening) |
| V5 Agent contract | `verify:agent` | 53/53 | **72/72** (+19) |
| V5 mock mode | `BRANCHES_AGENT_MODE=mock verify:agent` | 67/67 | **94/94** |
| V5 end to end | `verify:agent:e2e` | 27/27 | **29/29** |
| V7 Ready check | `verify:ready` | 28/28 | 28/28 |
| **V9 Never-stuck** | `verify:screens` | — | **18/18** (new) |

`npm run verify` → **all 10 suites behaved as expected.**
`npm run typecheck` → clean across all five workspaces.
Metro bundles clean for **web, iOS and Android**.

### New check groups worth knowing

- **`A6a`–`A6o`** — tiers: Gemini first, thinking levels, provider selection
  precedence, no-key-means-no-tier, local mock needs no key, contiguous tier
  numbering.
- **`A9a`–`A9m`** — provider normalisation, run with no network. Both adapters
  reduce to the same statuses; `incomplete`/`failed`/`unknown` are never
  answers; `finish_reason: 'length'` is the OpenAI spelling of `incomplete`;
  unparsable tool arguments are a provider failure not a crash; a Gemini
  **thought step is not** reported as leaked reasoning while OpenAI
  `reasoning_content` **is**.
- **`M8`–`M15`** — `incomplete`, the truncated-but-plausible case, `failed`, and
  the 429 timing check that pins the SDK-retry finding.
- **`O1`–`O4`** — the OpenAI-compatible path still works and is still selected by
  `AGENT_BASE_URL` alone; `reasoning_content` is still caught there.
- **`H1`–`H18`**, **`S1`–`S7`**, **`R5`**, **`E14`** — as described above.

### Two structural rules still proven

A human cannot call any agent-only reducer (`R1`–`R5`), and the agent cannot
change the plan (`D1`–`D3`). `reclaimJobs` was added to the first group rather
than becoming an exception to it.

### How to run the full thing

```bash
# terminal 1
npm run stdb:start
npm run stdb:publish:local

# terminal 2 — the model. Mock needs no key:
npm run agent:mock
# terminal 3
GEMINI_BASE_URL=http://127.0.0.1:8099 npm run agent     # or just `npm run agent` with a key

# terminal 4
npm run mobile:web
```

**Stop the agent service before `npm run verify`** — it registers into whichever
household a test just created. `pkill -f "src/index.ts"`. Note the pattern: the
service runs from inside `services/agent`, so matching the full path finds
nothing.

Two identities in one browser: tab 1 at `/`, tab 2 at `/?device=b`.

---

## 8. Not done this pass — deliberately

Out of scope by the team's instruction ("functionality over presentation; the UI
is going to change"):

- The design pass: typography, spacing, number rolling, card arrival, pulses,
  haptics, wide-screen web layout.
- The demo profile (OD-1) and the one-command demo reset.
- The README for judges, and the public repo the SpacetimeDB track requires.
- **The connection-loss banner.** Note carefully what *was* done: a connection
  that fails *before* a screen has data is now visible and recoverable from
  `Loading` (§4.1). What is missing is the banner for a connection lost *after* a
  screen already has data.
- The manual V8 UI checklist and the three-times demo run-through.
- The backup screen recording.

---

## 9. Open items, newest first

| Item | Note |
|---|---|
| **A8 — the Gemini key** | §1. Needs a person, not code |
| **OD-21 — no way to leave a household** (new) | `createHousehold` refuses once you are a member and there is no inverse, so a wrong *household* is unrecoverable without clearing browser storage. Mitigated in the waiting room (the name can be fixed in place), but not solved. A `leaveHousehold` reducer is a real decision about what happens to that member's transactions, items and goals, so it was **not invented here** |
| **OD-16 — third Devpost track** | Unresolved. Gemini-only forfeits NVIDIA; Photon is the likely replacement |
| **Maincloud is seven schemas behind** | Destructive republish, needs a person. Command in §6.2 |
| **OD-19** | The agent shared secret is a committed module constant |
| **OD-6** | The 1.5s ready hold is still unconfirmed by anyone actually holding it |
| **OD-17** | Negative rounding ties — parked, see [[15 Money and Rounding]] |
| **OD-1 / OD-2** | Demo profile and event cost placeholders. The baby numbers drive E5, so changing them means re-deriving that golden |
| Two-device V6 run | The eleven-item checklist is at the end of the Stage 7 Build Log |
| `general_chat` | Specified but still never queued |
| Fixture yields only 3 branches | Fine for goldens, thin for showing reroll on stage |
| `verify:flow` renders 256-character columns | **Pre-existing and cosmetic**, confirmed by measuring before my change. One check's value is that long and `printTable` pads every row to the widest. Not introduced by this pass |

---

## 10. Credential handling in this pass

- `Creds.md` stays gitignored (`.gitignore:60` → `**/Creds.md`) and has **never**
  been committed.
- The key was read into `services/agent/.env` (gitignored, `.gitignore:2`, mode
  600) by a script that **printed only its length and first three characters** —
  never the value.
- Before committing, every file git can see — `git ls-files` plus
  `git ls-files --others --exclude-standard`, 220 files — was scanned for the
  literal key. **Clean.** Full history re-checked: only `.env.example` appears,
  which is the tracked template.
- The only credential-shaped string in the commit is the word "Creds.md" inside
  the commit message.

**Rotate the key anyway** when you replace it, given it was printed in an earlier
session's output.
