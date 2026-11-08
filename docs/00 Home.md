---
tags: [branches, index]
---
# Branches — Home

Start here. Claude Code reads [[CLAUDE]] first, then the current stage.

## Specs
| Note | What it covers |
|---|---|
| [[01 Product Overview]] | The idea, core features, what we end with, glossary |
| [[02 Ground Rules]] | Rules that apply to every line of code |
| [[03 User Journey]] | The end-to-end experience, including an example live session |
| [[04 Architecture]] | Components, data flow, stack, hosting |
| [[05 Data Model]] | SpacetimeDB tables, reducers, visibility, privacy |
| [[06 Engine Spec]] | Formulas, simulation, impact, levers, branches |
| [[07 Agent Spec]] | Nemotron agent: tasks, tools, guardrails, failover |
| [[08 Live Session Spec]] | Real-time planning session and ready check |
| [[09 Design System]] | Robinhood-inspired visual language |
| [[10 Screens]] | Every screen, what's on it, its states |
| [[11 Mock Data]] | Test fixture and demo profiles, transaction generator |
| [[12 Verification]] | Predictable-output checks for every stage |
| [[13 Open Decisions]] | Undecided items and the defaults to use meanwhile |
| [[14 Research Notes]] | Condensed findings from team research, with flags |
| [[15 Money and Rounding]] | How dollars become cents, and the one tie-breaking rule still open |
| [[16 Dev Environment]] | How we run it while building: platform, hosts, firewall, toolchain |
| [[17 Stage 8 Handoff]] | The plan Stage 8 pass 1 worked from. **Superseded** — see 18 |
| [[18 Stage 8 Pass 1 Record]] | **What Stage 8 pass 1 actually changed**, in detail. §1 is the Gemini key problem and what to do about it |

## Build stages
| Stage | Outcome |
|---|---|
| [[Stage 0 - Foundations and Risk Checks]] | Repo runs on phone + web; SpacetimeDB and Nemotron proven |
| [[Stage 1 - Engine Core]] | Deterministic math and simulation pass golden checks |
| [[Stage 2 - Household, Mock Data and Onboarding]] | Two partners join a household; baseline inferred and confirmed |
| [[Stage 3 - Goals and Timeline]] | Goals on a 10-year timeline, synced live, with "show the math" |
| [[Stage 4 - Life Events and Impact]] | Events change the projection; impact is shown |
| [[Stage 5 - Levers and Branches]] | Engine builds branches; locks, rerolls, pins, sliders work |
| [[Stage 6 - Agent]] | Nemotron interprets events and selects/explains branches |
| [[Stage 7 - Live Planning Session]] | Two people decide together in real time; ready check commits |
| [[Stage 8 - Polish and Demo Hardening]] | Looks great, never breaks on stage |
| [[Stage 9 - Stretch Goals]] | Yearly wrap, statement upload, Photon, push notifications |

## Tracks
- **PNC** (main): "360° Financial Health Navigator"
- **SpacetimeDB**: core logic and real-time sync run on SpacetimeDB
- **NVIDIA**: ~~Nemotron is the agent's primary model~~ — **retired.** [[07 Agent Spec]] now
  specifies Gemini as the only model, which forfeits this track. The third track
  is unresolved: see OD-16 in [[13 Open Decisions]].
- *Photon is a stretch goal and is now the most likely third track.*
