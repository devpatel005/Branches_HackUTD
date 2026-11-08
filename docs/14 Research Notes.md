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
- **(verify)** SDK and hooks run inside Expo Go; module can import `packages/engine`; whether per-client row filtering exists.
- **Note:** the research's sample `simulateYear` reducer never subtracted completed goal costs from savings. Don't reuse it; the yearly wrap (stretch) must follow [[06 Engine Spec]] semantics.

## Nemotron
- Base URL `https://integrate.api.nvidia.com/v1`, OpenAI-compatible, key from build.nvidia.com. Free endpoints for the recommended models.
- Primary `nvidia/nemotron-3.5-bolt-e4b` (66K context, strict JSON schema, tool calling); failover `nvidia/nemotron-3.5-lightning-30b-a3b`; vision (stretch) `nvidia/nemotron-3.5-super-vl-120b-a12b`.
- Weights for the top models aren't downloadable, so don't self-host on Brev; use the hosted API.
- Quirks: with thinking on, `max_tokens` covers thinking + tool arguments and can exhaust the budget (empty response, `finish_reason: "length"`); disable thinking and use `max_tokens: 2048`. Don't set both `temperature` and `top_p`. Strict message alternation and tool-call id matching. 429 = rate limit, 402 = quota.
- Research reports a low score (≈9.5%) for a Nemotron model on a banking-arithmetic benchmark — supports our no-AI-math rule.
- NVIDIA track: Nemotron must be the primary decision-maker (other providers only as failover).
- **(verify)** exact model name; that `chat_template_kwargs` sent at the top level of the Node SDK request disables thinking (the research sample used a Python-style `extra_body`).

## Photon
- iMessage group chats are supported via `spectrum-ts` (outbound gRPC; no webhook URL needed). The bot can create groups (dedicated "money thread"). WhatsApp Business: 1-on-1 only. Telegram: bot can't create spaces.
- `terminal` provider simulates multi-user chats locally.
- Demo phones must text the Photon line first before the bot can include them.
- Promo code `HACKWITHPHOTON` for free Pro access.
- Judging emphasizes conversational quality: debouncing bursts, tapbacks, turn-taking.

## Expo
- Expo Go runs JavaScript-only libraries; no custom native modules.
- **(verify)** Push notifications are limited in recent Expo Go versions; use in-app banners.

## Users and market
- Fidelity 2026: 69% of couples don't regularly discuss long-term finances (41% wish they did); nearly half avoid money talks to prevent conflict. 2024: most share a retirement vision, but more than half disagree on how much to save. 58% say contributions aren't equal.
- Common complaints: one partner does all the money work ("fun police"); budgeting apps feel like homework and get abandoned within weeks; partners want autonomy (private fun money) rather than micro-scrutiny.
- Competitors (Honeydue, Honeyfi, YNAB Together, Origin Partner Mode, Monarch, Copilot, Planned) offer shared tracking and some projections; none found that combine life-event-driven branches, live co-decision, and an agent.

## PNC alignment
- PNC's challenge suggests a coach, 3+ health indicators, forecasts, and a what-if simulator; Branches covers all four.
- PNC Virtual Wallet has real features called Money Bar and Danger Day. Don't use those names or ℠ symbols for our own features; you can say our "tight years" were inspired by Danger Day.
- **The 4.00% "PNC Growth APY" in the research is unverified.** Treat the savings rate as an editable assumption, not a PNC figure.
