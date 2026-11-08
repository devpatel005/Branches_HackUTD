---
tags: [branches, spec, architecture]
---
# 04 Architecture

## Components

```
┌──────────────────────────┐   ┌──────────────────────────┐
│ Phone (Expo Go)          │   │ Laptop (Expo web)        │
│ apps/mobile              │   │ apps/mobile              │
└────────────┬─────────────┘   └────────────┬─────────────┘
             │  WebSocket subscriptions + reducer calls     │
             ▼                                              ▼
┌─────────────────────────────────────────────────────────────┐
│ SpacetimeDB module (Maincloud)          server/spacetime      │
│ tables + reducers; imports packages/engine for all math       │
└──────────────────────────────┬──────────────────────────────┘
                               │ subscribes to agent_job rows; calls reducers
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Agent service (Node)                     services/agent       │
│ builds allowlisted context → Nemotron (NVIDIA hosted API)     │
│ validates output → writes results back via reducers           │
└─────────────────────────────────────────────────────────────┘
```

## Message bus pattern
The app never calls the agent directly.
1. The app calls a reducer that writes a `chat_message` and queues an `agent_job`.
2. The agent service, subscribed to queued jobs for its identity, picks the job up, marks it `running`, and writes progress text ("Building branch 2 of 3…").
3. It calls Nemotron, validates the output, and writes results back through agent-only reducers.
4. Every subscribed client (both partners) updates automatically.

Benefits: the agent service needs no public URL (it can run on a laptop, a free host, or a small Brev machine); agent progress is real-time for both partners; there is one source of truth.

## Stack

| Layer | Choice | Status |
|---|---|---|
| App | **Expo (React Native)** with Expo Router; Expo Go on phones, Expo web on laptops | Decided |
| Database / backend | **SpacetimeDB**, TypeScript module, hosted on Maincloud (free tier) | Decided |
| Client SDK | `spacetimedb` package, React hooks from `spacetimedb/react` (not the legacy `@clockworklabs/spacetimedb-sdk`) | From research — verify in Stage 0 |
| Engine | `packages/engine`, pure TypeScript, imported by the SpacetimeDB module and by verification scripts | Decided |
| Agent model | **Nemotron** via NVIDIA hosted API (OpenAI-compatible) — see [[07 Agent Spec]] | Decided |
| Agent service | Node + TypeScript, OpenAI SDK pointed at NVIDIA's base URL, Zod for validation | Recommended |
| Charts | Hand-drawn with `react-native-svg` (works in Expo Go and web) | Recommended |
| Animation / haptics | `react-native-reanimated`, `expo-haptics` (no-op on web) | Recommended |
| Token storage | `@react-native-async-storage/async-storage` (works on native and web). **Not** `localStorage` | Recommended |
| Monorepo | pnpm workspaces (npm workspaces acceptable) | Recommended |

Claude Code may substitute a "Recommended" item if it fails a Stage 0 check; log the reason.

## Hosting
All free or covered by credits.
- **SpacetimeDB:** Maincloud free tier (`spacetime publish`).
- **App:** Expo Go for phones (dev server / tunnel); static web export to any free host, or run the web dev server during the demo.
- **Agent service:** a teammate's laptop during the demo (works because of the message-bus pattern), or a free host / Brev CPU instance from credits. See [[13 Open Decisions]] OD-13.

## Identity and households
- Each device connects anonymously and receives a SpacetimeDB identity + token; store the token with AsyncStorage so reconnects keep the same identity.
- `createHousehold` returns a 6-character join code; `joinHousehold(code)` binds the caller's identity as a member.
- The agent service has its own identity, registered as the household's agent; agent-only reducers check the caller.

## Environment variables
| Variable | Used by |
|---|---|
| `SPACETIME_HOST`, `SPACETIME_DB_NAME` | app, agent |
| `NVIDIA_API_KEY` | agent |
| `FALLBACK_LLM_PROVIDER`, `FALLBACK_LLM_API_KEY`, `FALLBACK_LLM_MODEL` | agent (optional failover) |
| `AGENT_TOKEN` | agent (persisted SpacetimeDB identity token) |

Commit `.env.example` files only.

## Known technical risks
1. SpacetimeDB client + React hooks inside Expo Go (Stage 0).
2. SpacetimeDB module importing `packages/engine` (bundling) (Stage 0).
3. `useTable` flashing bug: don't render a loading state just because `isReady` is false; only when there are no rows yet **and** not ready. See [[14 Research Notes#SpacetimeDB]].
4. Reducers cannot make HTTP calls; all LLM calls live in the agent service.
5. Nemotron model name and "thinking off" parameter must be confirmed with a live call (Stage 0).
6. Push notifications may not work in Expo Go; use in-app banners (push is a stretch goal).
