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
  packages/mock-data/   deterministic mock households and transactions
  scripts/verify/       verification scripts (see [[12 Verification]])
```

## Current stage

**Current stage:** [[Stage 0 - Foundations and Risk Checks]] *(the team updates this line)*

## Commands

*Fill this in during Stage 0 and keep it current: install, run the app (phone and web), publish the SpacetimeDB module, run the agent service, run each verification script, reseed demo data.*
