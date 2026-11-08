---
tags: [branches, decisions]
---
# 13 Open Decisions

Claude Code: use the **default** for each item, mark code with `// OPEN(OD-x)`, and log it. Don't finalize these. The team will update this note as decisions are made.

| ID | Decision | Default for now | Decide by |
|---|---|---|---|
| OD-1 | Demo couple profiles (numbers, goals) | Test Household A renamed "Maya" and "Jordan" | After Stage 7 works |
| OD-2 | Life event templates and their cost values | Placeholders in [[06 Engine Spec#Life event templates]] | Before demo; may change events entirely |
| OD-3 | Branch factors: candidate generation, ordering, how many, scoring | v1 rules in [[06 Engine Spec#Branch candidates]] | During Stage 5 |
| OD-4 | Which actions need approval from all members | Only committing a branch (ready check) | During Stages 3–7 |
| OD-5 | Reroll limits (count, exhaustion behavior) | Unlimited; show "all paths that fit" when exhausted | Stage 5 |
| OD-6 | Ready-check hold duration | 1.5 seconds | Stage 7 |
| OD-7 | Default savings rate | 4.00% labeled "assumed" (not a PNC rate; unverified) | Before demo |
| OD-8 | Emergency floor definition | 3 × (fixed + debt payments) | Stage 1 |
| OD-9 | Photon iMessage thread | Not built (stretch) | After Stage 8 |
| OD-10 | Push notifications | In-app banners only | After Stage 8 |
| OD-11 | Product copy and branch name style | Warm, plain; templates in specs | Stage 8 |
| OD-12 | Households with more than 2 members | Data model supports it; UI and ready check tested with 2 | Post-hackathon |
| OD-13 | Where the agent service runs during the demo | A teammate's laptop | Stage 6 |
| OD-14 | Final color values and app icon | Tokens in [[09 Design System]] | UI teammate |
| OD-15 | Existing savings earmarked for goals | Goals start at $0 balance | Stage 3 |
| OD-16 | Third Devpost track | NVIDIA (Photon only if stronger) | Before submission |
