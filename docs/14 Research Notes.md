---
tags: [branches, research]
---
# 14 Research Notes

Condensed from the team's research documents. Items marked **(verify)** have not been confirmed by a working build; Stage 0 and later stages should confirm them and update this note.

## SpacetimeDB
- Server modules can be written in TypeScript (`spacetimedb/server`). Client package: `spacetimedb`, React hooks in `spacetimedb/react` (`useTable`, `useReducer`). Avoid the legacy `@clockworklabs/spacetimedb-sdk`.
- **Reducers cannot make outbound HTTP calls.** All LLM calls live in the agent service, which connects as a normal client.
- **Flashing bug (SDK v2.0.4, Issue #4642):** calling a reducer briefly flips `useTable`'s ready flag to false. Never render `if (!isReady) return <Loading/>`. Use: show loading only when there are no rows **and** not ready.
- Anonymous identity: clients receive an identity and token on connect. Persist the token (AsyncStorage in React Native — **not** `localStorage`) to keep the same identity.
- Maincloud free tier is sufficient (research cites ~2,500 TeV/month).
- HackUTD track: the majority of business logic must live in SpacetimeDB; submissions need a public GitHub repo.
- **Confirmed in Stage 0** (CLI + npm `spacetimedb` both 2.14.1):
  - The module **can** import `packages/engine`. The engine is bundled into the WASM and runs inside reducers — verified by a reducer writing `F1(12000, 24)` into a column and reading back `500`.
  - The client SDK and generated bindings drive a real connection **from Node** (two clients, cross-client subscription updates, token-preserved identity). The React hooks bundle cleanly for **web, iOS and Android**; running inside Expo Go on a physical device is still unconfirmed (needs a phone).
  - **Per-client row filtering exists**, which resolves the warning in [[05 Data Model]]. Two mechanisms: `spacetimedb.clientVisibilityFilter.sql('SELECT * FROM t WHERE owner = :sender')`, and **per-user views** (`spacetimedb.view(...)` keyed on `ctx.sender`), where deleting a row the view depends on automatically drops the rows it exposed. Stage 2 should use these rather than relying on "all data is mock."
  - Generated TypeScript bindings use extensionless imports by default, which bundlers resolve but Node ESM does not. Generate with `--import-extension ts` so the same bindings work in Metro *and* in Node-run verification scripts.
  - `spacetime build` looks for `tsc` in the module's own `node_modules`; under npm workspaces it is hoisted, and the build then prints "tsc not found" and **silently skips typechecking**. A postinstall hook links it (`scripts/link-module-tsc.mjs`).
- **Row-level security works, and is now in use** (Stage 2). `clientVisibilityFilter.sql('SELECT * FROM t WHERE owner_identity = :sender')` on `transaction`, `inferred_item` and `gap_question`. Proven with two live clients in `verify:flow`: partner A receives 8 of 16 inferred items and zero of B's transactions. Put an `identity` column on any row that belongs to one person, so the filter can key on `:sender` directly.
- **A view's accessor name collides with its row type.** A view named `onboarding_progress` generates the PascalCase type `OnboardingProgress`; declaring `t.row('OnboardingProgress', ...)` alongside it fails schema inspection with "name is used for multiple types". Name the row type something else.
- **Reducers take a single object argument**, not positional ones: `confirmItem({ itemId })`, never `confirmItem(itemId)`. Only visible once a reducer has parameters.
- **Prefer `i32` cents to `i64` for money.** i32 reaches ~$21.4M, and it keeps money out of JavaScript `bigint`, which `JSON.stringify` refuses to serialize — otherwise every projection payload and every formatted number inherits the problem. Row ids must stay `u64` for `autoInc`, so any JSON of a row still needs a BigInt replacer.
- **Modules should not use `new Date(...)`.** Stdlib clocks are not guaranteed in the module runtime and a build will not catch it. Convert `ctx.timestamp` with integer arithmetic instead.
- **`init` runs only on a database's FIRST publish, never on a module update.**
  Any row or column populated in `init` goes stale the moment the module changes,
  with no error and no warning — the module is current but the *data* is not.
  Found on the Maincloud publish in [[Stage 1 - Engine Core]], where a version
  string written at init still read `0.0.0-stage0` after a Stage 1 module was
  deployed. This matters for Stage 2: anything seeded in `init` (assumption
  defaults, a household row, demo data) needs either an explicit re-seed reducer
  or `publish -c` to wipe and re-init. `verify:stdb` now reads its engine checks
  *after* calling a reducer, which is the only way to observe what the deployed
  module actually computes.
- **Correction:** reducers still cannot make outbound HTTP calls, but **procedures and HTTP handlers can** (`ctx.http.fetch`). This does not change the design — the agent service stays a separate client, because validation, retries and failover belong outside the database — but it is no longer true that the module *cannot* reach the network.
- **Note:** the research's sample `simulateYear` reducer never subtracted completed goal costs from savings. Don't reuse it; the yearly wrap (stretch) must follow [[06 Engine Spec]] semantics.

## Gemini

_Confirmed against `@google/genai` 3.0.0 and a live call, Stage 8._

- **The spec's shape is right.** `ai.interactions.create` exists; `CreateModelInteraction` takes `model`, `store`, `input`, `system_instruction`, `tools`, `generation_config`, `response_format`. `GenerationConfig.thinking_level` is `"minimal" | "low" | "medium" | "high"`; `tool_choice.allowed_tools` is `{ mode, tools: string[] }`; a function tool is the flat `{ type: "function", name, description, parameters }`. A `function_call` step carries `arguments` **already parsed** as an object.
- **`interactions.create` ignores constructor-level retry settings.** Neither `new GoogleGenAI({ retries })` nor `httpOptions.retryOptions` reaches it — it silently makes **five** backed-off attempts on a 429 or 5xx. On a free-tier rate limit that is tens of seconds spent before our own failover is even consulted. Retries must be disabled **per request**, which does work: `create(params, { retries: { strategy: 'none' }, timeout_ms })`. `verify:agent` M15 pins this by timing a 429.
- **Timeouts are per request too**, and raise `APIConnectionTimeoutError` with no `.status`.
- **Errors are thrown, not returned**, as named classes (`RateLimitError`, `BadRequestError`, …) carrying `.status`.
- **`error.message` is useless for diagnosis.** A rejected key arrives as `400 API error occurred: {"httpMeta":{"response":{},"request":{}}}`; Google's actual explanation is only in `error.body`. `messageOf` in `providers.ts` unwraps it, which turned an opaque 400 into "API key not valid" in one step.
- **The SDK POSTs its request body verbatim** to `{baseUrl}/v1/interactions`. That is what lets `GEMINI_BASE_URL` point at the bundled mock and exercise the real adapter with no key. Note it takes an **origin**, with no path.
- **Key format matters.** An AI Studio API key looks like `AIza…` (~39 chars). A credential beginning `AQ.` is not one — it is an ephemeral/session token and the Gemini API rejects it as "API key not valid".

## Nemotron

_Retired in Stage 8: [[07 Agent Spec]] is Gemini-only, which forfeits the NVIDIA track (OD-16). Kept for the record, and because the thinking/token-budget lesson generalised — it is the same failure Gemini reports as `status: incomplete`._

- Base URL `https://integrate.api.nvidia.com/v1`, OpenAI-compatible, key from build.nvidia.com. Free endpoints for the recommended models.
- Primary `nvidia/nemotron-3.5-bolt-e4b` (66K context, strict JSON schema, tool calling); failover `nvidia/nemotron-3.5-lightning-30b-a3b`; vision (stretch) `nvidia/nemotron-3.5-super-vl-120b-a12b`.
- Weights for the top models aren't downloadable, so don't self-host on Brev; use the hosted API.
- Quirks: with thinking on, `max_tokens` covers thinking + tool arguments and can exhaust the budget (empty response, `finish_reason: "length"`); disable thinking and use `max_tokens: 2048`. Don't set both `temperature` and `top_p`. Strict message alternation and tool-call id matching. 429 = rate limit, 402 = quota.
- Research reports a low score (≈9.5%) for a Nemotron model on a banking-arithmetic benchmark — supports our no-AI-math rule.
- NVIDIA track: Nemotron must be the primary decision-maker (other providers only as failover).
- **(verify) — still unconfirmed.** The exact model name and the thinking-off behaviour both need a live call, which needs `NVIDIA_API_KEY`. Stage 0 built the smoke check and ran it in **recorded mode** only (the team chose to defer the key), so these two remain the project's largest unverified risks. Run `npm run -w @branches/agent smoke:live` as soon as a key exists; checks S6 (no `reasoning_content`) and S7 (`finish_reason` is not `length`) are the ones that matter.
- **Confirmed in Stage 6 (shape, not the model).** The request builder, forced tool calls, `parallel_tool_calls: false`, temperature-without-top_p, and the reasoning/`finish_reason: length` detection are all implemented and exercised over real HTTP against a bundled mock (`verify:agent` in mock mode, 67/67). What a mock **cannot** settle remains open: that `nvidia/nemotron-3.5-bolt-e4b` is a live model name, and that top-level `chat_template_kwargs` actually disables thinking on NVIDIA's endpoint.
- **The provider layer is env-driven.** Nemotron is tier 1 by default; `AGENT_BASE_URL` / `AGENT_MODEL` / `AGENT_API_KEY` point tier 1 anywhere OpenAI-compatible, and thinking-off is only sent to NVIDIA endpoints. `FALLBACK_LLM_*` adds a third tier from a different provider.
- Stage 0's request builder puts `chat_template_kwargs` at the **top level** of the request body (correct for the Node SDK / raw `fetch`; `extra_body` is a Python-SDK convention) and deliberately omits `top_p`. See `services/agent/src/model-config.ts`.

## Photon
- iMessage group chats are supported via `spectrum-ts` (outbound gRPC; no webhook URL needed). The bot can create groups (dedicated "money thread"). WhatsApp Business: 1-on-1 only. Telegram: bot can't create spaces.
- `terminal` provider simulates multi-user chats locally.
- Demo phones must text the Photon line first before the bot can include them.
- Promo code `HACKWITHPHOTON` for free Pro access.
- Judging emphasizes conversational quality: debouncing bursts, tapbacks, turn-taking.

## Expo
- Expo Go runs JavaScript-only libraries; no custom native modules.
- **Confirmed in Stage 0:** current template is **Expo SDK 58** (React 19.3, React Native 0.88.1). The dependency set — `spacetimedb`, `spacetimedb/react`, `@react-native-async-storage/async-storage`, `expo-router` — is JS-only and bundles for web, iOS and Android with no native modules.
- A monorepo needs an explicit `metro.config.js` (`watchFolders` to the repo root plus `nodeModulesPaths`), or Metro cannot resolve workspace packages at all.
- Expo's `web.output` defaults to `"server"` in the template; Stage 0 set it to `"single"` so the web build is a static SPA that any free host can serve.
- **(verify)** Push notifications are limited in recent Expo Go versions; use in-app banners.

## Users and market
- Fidelity 2026: 69% of couples don't regularly discuss long-term finances (41% wish they did); nearly half avoid money talks to prevent conflict. 2024: most share a retirement vision, but more than half disagree on how much to save. 58% say contributions aren't equal.
- Common complaints: one partner does all the money work ("fun police"); budgeting apps feel like homework and get abandoned within weeks; partners want autonomy (private fun money) rather than micro-scrutiny.
- Competitors (Honeydue, Honeyfi, YNAB Together, Origin Partner Mode, Monarch, Copilot, Planned) offer shared tracking and some projections; none found that combine life-event-driven branches, live co-decision, and an agent.

## PNC alignment
- PNC's challenge suggests a coach, 3+ health indicators, forecasts, and a what-if simulator; Branches covers all four.
- PNC Virtual Wallet has real features called Money Bar and Danger Day. Don't use those names or ℠ symbols for our own features; you can say our "tight years" were inspired by Danger Day.
- **The 4.00% "PNC Growth APY" in the research is unverified.** Treat the savings rate as an editable assumption, not a PNC figure.
