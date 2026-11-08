---
tags: [branches, stage]
status: complete-except-live-nemotron
---
# Stage 0 — Foundations and Risk Checks

**Goal:** a working skeleton on phone and laptop, and proof that the risky integrations work before we build on them.

## Starting point
Empty repo containing only `CLAUDE.md`, `docs/`, and `stages/`.

## Read first
[[02 Ground Rules]] · [[04 Architecture]] · [[14 Research Notes]] · [[07 Agent Spec#Model configuration]]

## Build
1. Monorepo with the layout in `CLAUDE.md` (pnpm workspaces recommended).
2. `apps/mobile`: Expo app with Expo Router and the 3 tabs (Home, Timeline, Chat) as placeholders, using the dark color tokens from [[09 Design System]].
3. `server/spacetime`: a TypeScript module with a tiny `counter` table and an `increment` reducer; publish to Maincloud.
4. The app connects to SpacetimeDB, persists its token with AsyncStorage, subscribes to `counter`, and has a button that calls `increment`.
5. `packages/engine` with one trivial exported function (e.g., F1) imported **by the SpacetimeDB module** and used by a reducer.
6. `services/agent`: a Node script that calls Nemotron with one forced tool call, thinking off, and prints the tool arguments.
7. `scripts/verify/` runner skeleton that prints the PASS/FAIL table format from [[12 Verification]].
8. `.env.example` files; `.gitignore` covers `.env`.
9. Fill in the **Commands** section of `CLAUDE.md`.

## Out of scope
Any real features, design polish, data model beyond `counter`.

## Done when
- [x] Laptop browser (Expo web) — PASS. **Expo Go on a phone — deferred by OD-18 ([[16 Dev Environment]]); iOS/Android bundles compile clean.**
- [x] Proven scripted (two clients, cross-client subscription update). Phone-to-laptop pending the manual V6 run.
- [x] PASS (verify:stdb D7/D8).
- [x] PASS (verify:stdb D3/D4).
- [ ] **Recorded mode only — still open.** Needs `NVIDIA_API_KEY`; run `npm run -w @branches/agent smoke:live`.
- [x] PASS (verify:selftest exits 1 with 2 deliberate failures).
- [x] PASS — SpacetimeDB and Expo sections updated; Nemotron items left explicitly open.

## Verification
Run the smoke checks above; report each as PASS/FAIL in the Build Log.

## Notes for Claude Code
- If the SpacetimeDB client or hooks fail inside Expo Go, stop and report the error and options before working around it. This decides the rest of the build.
- If the Nemotron parameters differ from the research, record the working request shape in [[07 Agent Spec]].

## Build Log

### 2026-11-07 — Stage 0 built

**Team decisions taken before building** (asked up front):
- Package manager: **npm workspaces** (spec allows it; Metro resolves hoisted
  `node_modules` more predictably than pnpm's symlinked store).
- SpacetimeDB: **local first**, Maincloud after `spacetime login`.
- Nemotron: **recorded (mock) mode** — no `NVIDIA_API_KEY` available yet.

**Built**
- npm workspace monorepo matching the layout in `CLAUDE.md`, plus a new
  `packages/bindings` (below). Shared `tsconfig.base.json`.
- `packages/engine`: `toCents` / `toIntegerCents` / `fromIntegerCents`,
  `monthlyRate`, `f1SavingsNoInterest` (F1), `ENGINE_VERSION`. No I/O, no time,
  no randomness.
- `server/spacetime`: `counter` and `connected_client` tables, `increment` /
  `reset` reducers, connect/disconnect lifecycle. `increment` calls the engine
  on every call and stores the result, so a missing or stale engine shows up in
  the data rather than silently.
- `packages/bindings`: generated client bindings, shared by the app, the agent
  service and the verification scripts.
- `apps/mobile`: Expo SDK 58 + Expo Router, three tabs (Home, Timeline, Chat),
  dark tokens from [[09 Design System]] in `src/theme.ts`, monorepo-aware
  `metro.config.js`, SpacetimeDB provider with AsyncStorage token persistence,
  and a Home screen showing the shared counter, the engine check, connected
  device count and this device's identity.
- `services/agent`: Nemotron request shape per [[07 Agent Spec]]
  (`chat_template_kwargs` top-level, no `top_p`, forced tool call, tier list),
  the `classify_life_event` tool, the system prompt, and a smoke check with
  **recorded** and **live** modes.
- `scripts/verify`: shared table renderer (ID / description / expected / actual /
  PASS-FAIL + summary, non-zero exit), `math.ts`, `stdb.ts`, `selftest.ts`, and
  `run-all.ts` that aggregates and SKIPs server-dependent suites when no
  SpacetimeDB is reachable.
- `.env.example` at the root, in `apps/mobile` and in `services/agent`.
- `CLAUDE.md` **Commands** section filled in.

**Verification**

| Check | Result |
|---|---|
| App runs in a laptop browser (Expo web) | **PASS** — 880 modules, HTTP 200 |
| App runs in Expo Go on a phone | **NOT RUN** — deferred by OD-18. iOS and Android bundles both compile clean (1310 / 1307 modules), so this is a device check, not a code risk |
| Increment on one device updates the other within ~1s | **PASS (scripted)** — `verify:stdb` D5: two independent clients, B observes A's reducer call through its own subscription. Phone-to-laptop still needs the manual V6 run |
| Reloading keeps the same identity | **PASS** — `verify:stdb` D7 (same identity with the stored token) and D8 (a different identity without one) |
| The module calls a function from `packages/engine` | **PASS** — `verify:stdb` D3/D4: the reducer wrote `500` and `0.0.0-stage0` |
| Nemotron returns a valid tool call with no reasoning content | **PASS in recorded mode only** — S1–S7 pass against a fixture. Does **not** prove the model name or that thinking is off |
| Verify runner prints a table and exits non-zero on a failing check | **PASS** — `verify:selftest` reports 2 deliberate failures and exits 1; `run-all` treats a zero exit there as a failure |
| `(verify)` items in [[14 Research Notes]] updated | **PASS** — SpacetimeDB and Expo sections rewritten; Nemotron items left explicitly open |

`npm run verify` -> 3/3 suites behaved as expected. `npm run typecheck` -> clean
across engine, module and app. `npm run stdb:build` -> clean.

**Decisions and problems solved** (all reversible)

1. **Money rounding needed more than `Math.round`.** [[06 Engine Spec]] E1 expects
   Japan's inflated cost to be `5273.65`. The exact value is
   `5000 x 1.027^2 = 5273.645` — an exact half-cent tie — but `Math.pow(1.027, 2)`
   is `1.0547289999999998`, just *below* the tie, so `Math.round(x * 100) / 100`
   returns `5273.64` and **E1 would fail**. `toCents` normalises to 12
   significant digits first. F1-F5 and E1-E3 were all checked numerically and
   match the spec. Full writeup: [[15 Money and Rounding]].
2. **Rounding is half away from zero** so negative money is symmetric. The spec
   is silent and no golden distinguishes the choice — parked as **OD-17**.
3. **`packages/bindings` is new, not in the `CLAUDE.md` layout.** The app, the
   agent service and the verification scripts are all SpacetimeDB clients
   ([[04 Architecture]]), so bindings could not live inside `apps/mobile`.
   `CLAUDE.md`'s layout block was updated to match.
4. **Bindings are generated with `--import-extension ts`.** The default
   extensionless imports resolve in Metro but not in Node ESM, which broke the
   Node-run verification scripts. The `ts` form works in both.
5. **`spacetime build` was silently skipping typechecking.** It looks for `tsc`
   in the module's own `node_modules`, but npm workspaces hoists it to the root,
   so the build printed "tsc not found in node_modules" and carried on — type
   errors would have reached published WASM. A postinstall hook
   (`scripts/link-module-tsc.mjs`) links it and self-heals on every install.
6. **Expo web output changed from `server` to `single`**, so the web build is a
   static SPA per [[04 Architecture#Hosting]] rather than needing a Node host.
7. **The template's own `CLAUDE.md` / `AGENTS.md` were deleted** from
   `apps/mobile` so they cannot compete with this repo's `CLAUDE.md`.
8. **Node 23.10 runs TypeScript natively** (type stripping), so verification
   scripts import engine source with no build step and no `tsx` dependency.
   Node 23 is **not LTS** — Expo targets 20/22. Nothing has broken; if Metro or
   Expo misbehaves later, Node 22 is the first thing to rule out.
9. **Connect errors now name the host they tried.** The SDK reports a bare
   `WebSocket error`; every realistic cause is a config problem, so the
   `onConnectError` handler lists them. Prompted by a real debugging session —
   see [[16 Dev Environment]].

**Open / still to do**

- **`NVIDIA_API_KEY` and the live Nemotron call.** The two risks Stage 0 exists
  to retire — that `nvidia/nemotron-3.5-bolt-e4b` is a real model name, and that
  top-level `chat_template_kwargs` actually disables thinking — are **still
  open**. Recorded mode cannot prove either. Not on the critical path: Stages 1-5
  need no LLM at all, and the agent only arrives in
  [[Stage 6 - Agent]]. One command once a key exists:
  `npm run -w @branches/agent smoke:live` (watch S6 and S7).
- **Expo Go on a physical phone** — **deferred by team decision** (OD-18,
  [[16 Dev Environment]]): development continues against Expo web on a laptop,
  and we may switch back before the demo. [[Stage 7 - Live Planning Session]]
  will need two real devices for the [[12 Verification#V6 Real-time checklist]].
- **Maincloud publish** — `spacetime login` is **done**; `npm run stdb:publish`
  still needs a team member to run it. Local publish works today.
- **macOS firewall** blocks incoming connections to `spacetimedb-standalone` by
  design. Loopback is unfiltered, so laptop development needs nothing opened; a
  phone would. See [[16 Dev Environment]].
- `packages/mock-data` is an empty placeholder until
  [[Stage 2 - Household, Mock Data and Onboarding]].

