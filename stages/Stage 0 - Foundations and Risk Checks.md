---
tags: [branches, stage]
status: not-started
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
- [ ] App runs in Expo Go on a phone **and** in a laptop browser (Expo web).
- [ ] Tapping increment on the phone updates the count on the laptop within ~1s, and vice versa.
- [ ] Reloading the app keeps the same identity (token persisted).
- [ ] The SpacetimeDB module successfully calls a function from `packages/engine`.
- [ ] The Nemotron smoke call returns a valid tool call with the exact model name from [[07 Agent Spec]], and **no reasoning content** (thinking off confirmed).
- [ ] The verify runner prints a table and exits non-zero on a deliberately failing check.
- [ ] Findings recorded: update [[14 Research Notes]] "(verify)" items with what you confirmed or changed.

## Verification
Run the smoke checks above; report each as PASS/FAIL in the Build Log.

## Notes for Claude Code
- If the SpacetimeDB client or hooks fail inside Expo Go, stop and report the error and options before working around it. This decides the rest of the build.
- If the Nemotron parameters differ from the research, record the working request shape in [[07 Agent Spec]].

## Build Log
*(append entries here)*
