---
tags: [branches, stage]
status: not-started
---
# Stage 6 — Agent

**Goal:** Nemotron joins as the third participant: it interprets life events from chat, selects and names branches, translates feedback into constraints, and explains results, all validated, with fallbacks.

## Starting point
Stage 5 complete: the full flow works with forms and fallback names.

## Read first
[[07 Agent Spec]] (all of it) · [[02 Ground Rules#1. The AI never computes numbers]] · [[02 Ground Rules#3. Privacy by architecture]] · [[04 Architecture#Message bus pattern]] · [[12 Verification#V5 Agent contract]]

## Build
1. `chat_message` and `agent_job` tables; `sendMessage`; agent-only reducers with role checks.
2. Agent service: subscribe to queued jobs, claim, progress, complete/fail; one job at a time per household.
3. The single context builder with the allowlist; development prompt logging.
4. Tasks: `interpret_event`, `select_branches`, `translate_feedback`, `affordability`, `explain`, `general_chat`.
5. Validation: Zod schemas, numbers whitelist, language filter, length limits; retry once, then failover tiers.
6. Chat UI: messages with author colors, follow-up chips, progress indicator, impact and affordability cards.
7. `verify:agent` in recorded and live modes.

## Out of scope
Live session multi-user behaviors (Stage 7).

## Done when
- [ ] Typing "We just found out we're pregnant!" leads to follow-up chips, then the E5 impact card.
- [ ] Branches arrive one at a time with agent names; names and summaries use only engine numbers.
- [ ] "Don't delay the house, we can cut eating out" produces the matching lock and a reroll.
- [ ] Stopping the agent service leaves the app fully usable via fallbacks.
- [ ] `verify:agent` A1–A8 PASS, including the privacy canaries.

## Verification
`verify:agent` (recorded + live); manual chat run-through.

## Build Log
*(append entries here)*
