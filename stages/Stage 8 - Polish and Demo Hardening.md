---
tags: [branches, stage]
status: not-started
---
# Stage 8 — Polish and Demo Hardening

**Goal:** it looks like a real product and cannot break on stage.

## Starting point
Stage 7 complete: full journey works.

## Read first
[[09 Design System]] · [[10 Screens#States every screen needs]] · [[12 Verification#V8 UI checklist]] · [[12 Verification#Demo run-through]]

## Build
1. Full design pass against the design system: typography, spacing, number rolling, card arrival, pulses, haptics.
2. Every state on every screen: loading (no flashing), empty, reconnecting, error with retry, agent unavailable.
3. Demo profile (OD-1, once decided) and a one-command reset.
4. Agent failover and fallbacks exercised; timeouts tuned so the demo never waits more than a few seconds.
5. Wide-screen web layout (centered column; branch cards in a row).
6. README for judges: what it is, tracks, how to run, architecture diagram.

## Done when
- [ ] V8 checklist passes.
- [ ] Demo run-through passes three times in a row, including once with the agent service stopped.
- [ ] Backup recording exists.
- [ ] Public GitHub repo ready (SpacetimeDB track requirement).

## Build Log
*(append entries here)*
