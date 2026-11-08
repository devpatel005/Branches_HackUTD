---
tags: [branches, handoff, stage8]
---
# 17 Stage 8 Handoff

Working notes for the next session. Stages 0–7 are complete and committed; this
is what Stage 8 is scoped to, the decisions already made, and the things that
would otherwise have to be rediscovered.

Read [[CLAUDE]] first, then this, then [[07 Agent Spec]].

---

## 1. Where the build stands

All of Stages 0–7 are built, verified and pushed. `main` is clean.

| Suite | Command | State |
|---|---|---|
| V1 Math | `npm run verify:math` | 18/18 |
| V2 Engine (E1–E10) | `npm run verify:engine` | 66/66 |
| Engine purity | `npm run verify:purity` | 14/14 |
| V3 Inference | `npm run verify:inference` | 28/28 |
| Stage 0 data path | `npm run verify:stdb` | 8/8 |
| V4 Data flow (Stages 2–5) | `npm run verify:flow` | 158/158 |
| V5 Agent contract | `npm run verify:agent` | 53/53 |
| V5 over real HTTP | `BRANCHES_AGENT_MODE=mock npm run verify:agent` | 67/67 |
| V5 end to end | `npm run verify:agent:e2e` | 27/27 |
| V7 Ready check | `npm run verify:ready` | 28/28 |
| Everything | `npm run verify` | 9 suites |

`npm run typecheck` covers engine, module, app, agent **and** the verify
scripts. Metro bundles clean for web, iOS and Android.

**Before running `npm run verify`, stop the agent service** — it registers into
whichever household a test just created. `pkill -f "src/index.ts"`. Note the
pattern: the service runs as `node … src/index.ts` from inside `services/agent`,
so matching the full path finds nothing.

---

## 2. Stage 8 scope for this pass

The team's instruction: **functionality over presentation.** The UI is going to
change, so no design work.

### In scope
1. **Plug in the Gemini API** per the rewritten [[07 Agent Spec]] (section 3 below).
2. **Agent robustness** — timeouts, retry and failover against real Gemini
   behaviour; `status: incomplete` / `failed`; truncated output; rate limits; and
   a job that can never wedge in `running` if the service dies mid-flight.
3. **Never-stuck audit** — walk every screen for a dead end (empty, loading,
   error, agent-down, no goals, no partner) and make sure each offers a way
   forward. Functional, not cosmetic.
4. **Reducer hardening** — a systematic pass for input that could panic the WASM
   module or corrupt state: bad ids, stale sessions, concurrent calls, oversized
   strings, numbers at domain edges.

### Explicitly out of scope this pass
- The design pass, typography, motion, number rolling, wide-screen layout.
- The demo profile (OD-1) and the one-command demo reset.
- The README for judges.
- Connection-loss / reconnect UI (considered and deliberately **not** chosen).

---

## 3. The Gemini change

[[07 Agent Spec]] was rewritten. Gemini replaces Nemotron entirely. The shape is
**not** OpenAI-compatible, so this is a new adapter, not a config change.

### Decisions already made
- **Gemini only.** Nemotron tiers come out. This **forfeits the NVIDIA track** —
  OD-16's third Devpost track needs replacing (Photon, or PNC + SpacetimeDB
  only). Update [[13 Open Decisions]] and the Tracks list in [[00 Home]].
- **Teach the bundled mock the Gemini Interactions shape**, so the keyless
  verification exercises the real primary path — including `requires_action` and
  `status: incomplete`. Keep the OpenAI-compatible adapter and mock mode for the
  secondary path.

### API specifics (from the rewritten spec, so they need not be re-derived)
| Setting | Value |
|---|---|
| SDK | `@google/genai` (`npm install @google/genai`). **Never** the deprecated `@google/generative-ai` |
| API | **Interactions API**: `ai.interactions.create({…})`. `generateContent` is legacy — do not use |
| Auth | `GEMINI_API_KEY` env var, read automatically by `new GoogleGenAI({})`. Agent service only, never the app |
| Primary model | `gemini-3.8-flash` with `generation_config: { thinking_level: "low" }` |
| Fallback model | `gemini-3.5-flash-lite` (minimal thinking, fastest) |
| Forcing a tool | `generation_config: { tool_choice: { allowed_tools: { mode: "any", tools: ["<tool_name>"] } } }` |
| Tool declaration | `tools: [{ type: "function", name, description, parameters: <JSON Schema> }]` |
| JSON without a tool | `response_format: { type: "text", mime_type: "application/json", schema: … }` |
| State | `store: false`. Every job is one self-contained call; the context builder supplies history. SpacetimeDB stays the single source of truth |
| Output limit | **Do not** set a small `max_output_tokens` — it includes thinking tokens, and hitting it ends the interaction `incomplete` with truncated or empty output. Lower `thinking_level` instead |

Reading the response:
- `interaction.status`: `completed` · `requires_action` (a function call came
  back) · `incomplete` · `failed`. Treat `incomplete` and `failed` as failures.
- Function calls are in `interaction.steps`, as steps with
  `type === 'function_call'`, carrying `name`, `arguments` (**already parsed**),
  and `id`.
- Plain text: `interaction.output_text`.
- **Do not** send `function_result` back. For our task tools the arguments *are*
  the output; the service validates them and writes through reducers.

Failover chain: primary → one retry with the validation error appended →
fallback model → deterministic fallback. On HTTP 429 or 5xx, skip straight to
the fallback model.

Free-tier notes worth keeping: rate limits are **per Google Cloud project**, not
per key, and differ by model; each developer should use their own project during
development with a separate project reserved for the demo. Google requires phone
verification for the free tier. Free-tier content may be used by Google to
improve its products — we only ever send mock data, and the context builder never
sends private purchases.

### A8 is now answerable
The one thing no mock could settle — that the model name is real and the
thinking/tool-forcing parameters behave — can now be confirmed with a live call,
because a key exists. `npm run -w @branches/agent smoke` is the place for it
(that script needs rewriting for the Gemini adapter).

---

## 4. Credentials — do not commit

The key lives in **`Creds.md` at the vault root**, which is already in
`.gitignore` (`**/Creds.md`, plus `Creds.md` / `creds.md` / `CREDS.md`). It has
never been committed; `git log --all --name-only` is clean for it. **Keep it that
way.** Do not copy its contents into any tracked file, including this one.

It holds a Gemini API key, the key name `Branches_LLM`, and a Google Cloud
project number.

Plumbing: put the key in `services/agent/.env` as `GEMINI_API_KEY=…`.
`services/agent/.env` is gitignored (`.env*` with a `!.env.example` exception);
`services/agent/.env.example` is the tracked template and needs updating for the
Gemini variables.

---

## 5. What exists in `services/agent` today, and what has to change

```
services/agent/src/
  providers.ts     OpenAI-compatible tiers, forced tool calls, Nemotron quirks
  context.ts       THE single allowlisted context builder + prompt logging
  validate.ts      Zod schemas + the four gates (schema, numbers, language, length)
  tasks.ts         runTask: build context → call tier → validate → retry → failover
  tools.ts         tool declarations + the system prompt
  fallbacks.ts     the model-free path for every task
  mock-server.ts   OpenAI-compatible mock (knobs: MOCK_FAIL_STATUS, MOCK_INVENT_NUMBER,
                   MOCK_ADVICE, MOCK_THINKING)
  index.ts         the job loop: subscribe → claim → progress → complete/fail
  smoke.ts         "is my endpoint working" check
```

Likely shape of the work:
- **`providers.ts`** — introduce a provider interface returning a normalised
  `{ toolCall?, text, status }`, with a `gemini` adapter (native SDK) and the
  existing `openai` adapter behind it. `AGENT_PROVIDER` selects; Gemini is the
  default. Nemotron tiers removed.
- **`tasks.ts`** — `runTask` should keep its retry-then-failover policy but speak
  the normalised result, and treat `incomplete` / `failed` as tier failures (the
  way it already treats reasoning content and `finish_reason: length`).
- **`mock-server.ts`** — add a Gemini-shaped route so the keyless path exercises
  the real adapter; add knobs for `status: incomplete` and a truncated output.
- **`tools.ts`** — the declaration shape differs (`{ type, name, description,
  parameters }` rather than nesting under `function`).
- **`smoke.ts`** — rewrite against the Gemini adapter; this is where A8 gets
  settled.
- **`index.ts`** — unchanged in structure, but see the wedged-job item in §2.

`context.ts`, `validate.ts` and `fallbacks.ts` should need **no** change — they
are provider-agnostic by design, and `verify:agent` covers them. That is the
point of the single context builder.

---

## 6. Verification that must keep passing

Nothing above is allowed to break:
- `verify:agent` 53/53 recorded, and mock mode must be ported to the Gemini
  shape rather than dropped.
- `verify:agent:e2e` 27/27 — the real service over the real bus, with the mock
  standing in for the model.
- The two structural rules asserted there: **a human cannot call any agent-only
  reducer**, and **the agent cannot change the plan**.
- `A3j`/`A3k` in `verify:agent`: the numbers whitelist is only as tight as the
  data behind it. The 120-month series must stay **out** of the model context,
  or every integer 0–119 becomes whitelisted and invented durations sail through.

---

## 7. Gotchas already paid for

These cost real time in earlier stages and are easy to walk back into.

**SpacetimeDB module**
- A plain `export const` fails schema inspection: *"exporting something that is
  not a spacetime export"*. Named runtime exports are reserved for registered
  values. **`build` and `publish` both accept it; only `generate` catches it.**
- Reducers take a **single object** argument. A no-arg reducer still needs `{}`.
- `init` runs only on a database's **first** publish, never on a module update —
  anything seeded there goes stale silently.
- An engine `throw` inside a reducer **panics the whole WASM instance** and every
  client sees a fatal error. All engine calls go through `viaEngine`, which
  converts a throw into a `SenderError`. Keep new ones inside it.
- Money columns are `i32` cents, not `i64`, to keep money out of `bigint` —
  `JSON.stringify` refuses to serialize it. Row ids are `u64` and therefore
  bigint, so any JSON of a row needs a replacer.
- A view's accessor name generates a PascalCase type; a row type must not reuse
  it.
- Do not use `new Date(...)` in the module. Convert `ctx.timestamp` arithmetically.
- `subscriptionBuilder().onError` takes **one** argument; the error is on `ctx.event`.

**Verification scripts**
- Never `process.exit()` — it discards buffered stdout when stdout is a pipe,
  truncating a table mid-row and garbling the exit code, *only when piped*. Use
  the shared `finish()` in `scripts/verify/table.ts`.
- Wait on the client you are about to **assert on**. Waiting on A then reading B
  reads as a product failure and is not one.
- `goal`, `plan_projection`, `baseline`, `session` and friends have no row-level
  security and **accumulate across runs** on a dev database. Scope every read to
  the household the script created.
- Counting household members must filter `role === 'member'` — the agent is a
  member row.
- Assert *why* something was rejected (the gate), not merely that it was. Two
  mock-mode checks once passed for the wrong reason.
- One mock per behaviour, each on its own port. Reusing a port is a race where
  the dying server answers while its replacement fails to bind, invisibly.

**Dev environment** — see [[16 Dev Environment]] for the rest: the macOS firewall
and loopback, `?device=b` for a second identity in one browser, Expo's `.expo`
env cache, and `spacetime login` orphaning a local database.

---

## 8. Open items carried forward

| Item | Note |
|---|---|
| **Maincloud is six schemas behind** | Destructive republish; needs a person. Command in the Stage 2 Build Log |
| **OD-16 third track** | Now unresolved — dropping Nemotron forfeits NVIDIA |
| **OD-19** | The agent shared secret is a committed module constant in `server/spacetime/src/agent-secret.ts` |
| **OD-6** | The 1.5s ready hold is unconfirmed by anyone actually holding it |
| **OD-17** | Negative rounding ties — parked, see [[15 Money and Rounding]] |
| **OD-1 / OD-2** | Demo profile and event cost placeholders. The baby numbers drive E5, so changing them means re-deriving that golden |
| Two-device V6 run | The eleven-item checklist is at the end of the Stage 7 Build Log |
| `general_chat` | Specified but never queued |
| Fixture yields only 3 branches | Fine for goldens, thin for showing reroll on stage |

---

## 9. Running it

```bash
# terminal 1
npm run stdb:start
npm run stdb:publish:local

# terminal 2 — the model. Mock needs no key:
npm run agent:mock
# terminal 3
AGENT_BASE_URL=http://127.0.0.1:8099/v1 npm run agent   # (to be replaced by the Gemini adapter)

# terminal 4
npm run mobile:web
```

Two identities in one browser: tab 1 at `/`, tab 2 at `/?device=b`.
`apps/mobile/.env` must point at `ws://127.0.0.1:3000` for web — a LAN IP is
firewalled even from this machine, and the app now self-corrects with a warning.
