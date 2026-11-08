# CLAUDE.md — Branches

> Read this file first, every session. It tells you what we're building, how the docs are organized, and the rules you must never break.

## What we're building

**Branches** is a shared financial planner for couples, built for HackUTD 2026 (PNC track, plus SpacetimeDB and NVIDIA tracks). Both partners' accounts feed a combined baseline, they set goals on a rolling 10-year timeline, and when life happens (a pregnancy, a job loss, a raise) a Nemotron agent and a deterministic math engine produce **branches**: alternative paths forward. The couple picks one together in a **live planning session** and locks it in with a simultaneous press-and-hold.

Full picture: [[01 Product Overview]].

## How the docs are organized

This folder is also an Obsidian vault. `[[Note Name]]` is a wikilink: it means the file `docs/Note Name.md` or `stages/Note Name.md`. `[[Note Name#Heading]]` points to a section.

| Folder | Contents |
|---|---|
| `docs/` | Specs: what to build and how it must behave. Start at [[00 Home]]. |
| `stages/` | The build plan, one file per stage. We build **one stage at a time**. |

Specs describe **outcomes and rules**, not implementation. You write the code. Where a spec is silent, choose the simplest approach that satisfies the rules below, and note your choice in the stage's Build Log.

## How to work a stage

1. The team will tell you which stage to work on. **Never start the next stage on your own.**
2. Read the stage file, then every spec it links to.
3. Before writing code, post a short plan: files you'll create or change, and anything in the specs that is unclear.
4. Build until every item under **Done when** is true.
5. Run the stage's **Verification** checks and report PASS/FAIL for each.
6. Append to the stage's **Build Log**: what you built, decisions you made, anything left open.
7. If you hit an item from [[13 Open Decisions]], use the listed default, mark the code with `// OPEN(OD-x)`, and keep going. Never invent a final answer for an open decision.

## Ground rules (non-negotiable)

Full detail: [[02 Ground Rules]].

1. **The AI never computes numbers.** Every number a user sees comes from the engine (`packages/engine`), executed in SpacetimeDB reducers or verification scripts. The agent only selects, names, and explains engine output. Agent text containing a number not present in engine output is rejected.
2. **Projections, not advice.** Copy says "if you do X, the projection shows Y." Never "you should."
3. **Private purchases never reach the shared database or the agent.** Fun-money purchases stay on the owner's device. Only the fun-money *amount* and a within/over status are shared.
4. **The agent proposes; humans decide.** The agent can create branch candidates and messages. Only a ready check by every member can change the plan.
5. **Deterministic engine.** Same inputs produce byte-identical outputs. No randomness, no `Date.now()` inside engine logic, stable sort orders everywhere.
6. **Expo Go compatible.** No custom native modules. Everything must run in Expo Go on a phone *and* on Expo web in a laptop browser.
7. **Core logic lives in SpacetimeDB.** Plan math, simulation, levers, and branch generation run inside the SpacetimeDB module (required by the SpacetimeDB track).
8. **Secrets never committed.** API keys go in `.env` files that are git-ignored. Provide `.env.example`.
9. **Specs win.** If code and spec disagree, follow the spec. If you think the spec is wrong, say so in the Build Log instead of silently diverging.

## Repo layout (target)

```
branches/
  CLAUDE.md
  docs/                 specs (Obsidian vault)
  stages/               build plan
  apps/mobile/          Expo (React Native) app — phones via Expo Go + web
  server/spacetime/     SpacetimeDB TypeScript module
  services/agent/       Node service: subscribes to SpacetimeDB, calls Nemotron
  packages/engine/      pure TypeScript math, simulation, levers, branches
  packages/bindings/    generated SpacetimeDB client bindings (app + agent + verify)
  packages/mock-data/   deterministic mock households and transactions
  scripts/verify/       verification scripts (see [[12 Verification]])
```

## Current stage

**Current stage:** [[Stage 0 - Foundations and Risk Checks]] *(the team updates this line)*

## Commands

All commands run from the repo root. `npm install` runs a postinstall hook that
links the root TypeScript into `server/spacetime` — without it `spacetime build`
silently skips typechecking the module.

### Setup (once)
```bash
npm install                       # all workspaces
curl -sSf https://install.spacetimedb.com | sh   # SpacetimeDB CLI
export PATH="$HOME/.local/bin:$PATH"             # add to your shell profile
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env
cp services/agent/.env.example services/agent/.env   # add NVIDIA_API_KEY
```

### SpacetimeDB module
```bash
npm run stdb:start            # local server on 127.0.0.1:3000 (own terminal)
npm run stdb:build            # build + typecheck the module
npm run stdb:publish:local    # publish to the local server
npm run stdb:publish          # publish to Maincloud (needs `spacetime login`)
npm run stdb:bindings         # regenerate packages/bindings from the module
```
Regenerate bindings after **every** schema or reducer change, or clients
silently use a stale schema.

### App (phone and web)
```bash
npm run mobile                # Expo dev server; scan the QR with Expo Go
npm run mobile:web            # Expo web in a browser
npm run -w @branches/mobile start:tunnel   # phone not on the same Wi-Fi
npm run -w @branches/mobile export:web     # static web build
```
On a physical phone, `127.0.0.1` is the phone itself. Set
`EXPO_PUBLIC_SPACETIME_HOST` to your laptop's LAN IP, or publish to Maincloud.

### Agent service
```bash
npm run agent:smoke                        # recorded mode, no network
npm run -w @branches/agent smoke:live      # real Nemotron call (needs NVIDIA_API_KEY)
npm run agent                              # the service (Stage 6)
```

### Verification ([[12 Verification]])
```bash
npm run verify              # every suite, aggregated; non-zero on any failure
npm run verify:math         # V1 Math — F1-F5, r = 0 cases, money rounding
npm run verify:engine       # V2 Engine — golden scenarios E1-E5, E10, provenance
npm run verify:purity       # engine uses no time, randomness or I/O
npm run verify:inference    # V3 Inference — the expected table from 11 Mock Data
npm run verify:stdb         # Stage 0 data path (needs a published module)
npm run verify:flow         # V4 Data flow — two clients through onboarding (needs a module)
npm run verify:selftest     # proves the harness reports failures (exits 1 by design)
npm run typecheck           # engine + module + app
```
Suites needing a server print SKIP rather than failing when none is reachable.

### Demo data
*Added in Stage 2 (`seedMockData` / reseed).*
