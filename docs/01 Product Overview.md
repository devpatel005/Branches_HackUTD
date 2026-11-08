---
tags: [branches, spec]
---
# 01 Product Overview

## One-line pitch
**Branches is a shared financial plan for couples that shows the paths forward when life changes, and lets them choose one together, in real time.**

## The problem
- Couples avoid long-term money talks. In Fidelity's 2026 study, 69% don't regularly discuss long-term finances, though 41% wish they did, and nearly half sidestep money talks to avoid conflict.
- They often agree on the dream but not the numbers (how much to save, what comes first).
- One partner usually carries the money work; the other disengages.
- Budgeting apps get abandoned because categorizing transactions feels like homework.
- Existing couples apps (Honeydue, YNAB Together, Monarch, etc.) mostly **track the past**. None turn a life event into concrete paths forward that two people decide on together.

## The solution
1. **Shared baseline:** both partners' accounts merge into one picture. Income, bills, and debts are inferred automatically; the app asks only for what it can't see.
2. **10-year goal timeline:** goals with a cost, a target date, and a must-have or flexible tag. Every number comes from a deterministic engine, with "show the math" on each one.
3. **Life events:** tell the agent what happened. It interprets the event, and the engine shows which goals no longer fit.
4. **Branches:** the system builds three paths forward as cards with stats. Lock what you like and reroll the rest.
5. **Live planning session:** both partners see each other's picks, reactions, and slider changes instantly. When they disagree, each pins a non-negotiable and gets bridge branches.
6. **Ready check:** a branch becomes the plan only when both partners press and hold at the same time.
7. **Private fun money:** the amount is shared; the purchases are private, and the agent can never see them.

**Later (stretch):** yearly wrap, statement-screenshot upload, Photon iMessage thread, push notifications. See [[Stage 9 - Stretch Goals]].

## How it maps to PNC's challenge
PNC suggested: a conversational coach, 3+ health indicators, balance forecasts, a "what if" simulator. Branches combines all four for two people:
- **Coach:** the agent.
- **Health indicators:** the stats on every branch card and the home screen (emergency-fund months, tight years, goals on track, free monthly cash).
- **Forecasts:** the 10-year simulation.
- **What-if simulator:** life events and branches.

PNC's speaker at the opening ceremony framed it as "what do I have, what do I owe, can I take that vacation." Branches answers that for two people.

## What we end with (the finished hackathon build)
- A household of two members, joined by code, each on their own device (phone via Expo Go or laptop via web).
- A baseline inferred from mock PNC-style transactions and confirmed in a few taps.
- Goals on a 10-year timeline; every number traceable via "show the math."
- Life events entered through chat with a Nemotron agent, producing impact and three branches.
- A live session where both partners pick, react, tune, lock, reroll, pin, and ready-check a branch into the plan.
- Private fun money that provably never reaches the agent.
- A polished, Robinhood-inspired dark UI.
- Verification scripts proving the math and engine behave predictably.

## Out of scope for the hackathon
Real bank connections, real PNC APIs, investment advice, tax logic, retirement planning beyond "money set aside," authentication beyond anonymous identity + join code.

## Glossary
| Term | Meaning |
|---|---|
| **Household** | The shared plan. Has 2 members in the demo (data model supports more). |
| **Member** | A person in the household. Has a color (see [[09 Design System]]). |
| **Baseline** | Monthly income, fixed costs, debt payments, flexible spending, fun money, retirement set-aside, and liquid savings. |
| **Goal** | A future cost with a target month, today's-dollar cost, and priority (`must-have` or `flexible`). |
| **Assumptions** | Editable rates: savings rate, inflation, loan rate. Shown wherever used. |
| **Life event** | Something that changes the baseline (template + parameters). |
| **Impact** | What an event does to the plan: goals at risk, tight months, emergency fund. |
| **Lever** | One adjustment: delay a goal, shrink a goal, or save more each month. |
| **Branch** | A complete path: a named set of levers plus its resulting stats. |
| **Candidate** | A branch the engine generated but the couple hasn't seen yet. |
| **Lock** | "Keep this effect" when rerolling. |
| **Pin** | A member's single non-negotiable when partners disagree. |
| **Bridge branch** | A branch that honors both partners' pins. |
| **Session** | A live planning session about one event. |
| **Ready check** | Simultaneous press-and-hold by all members that commits a branch. |
| **Fun money** | Each member's private monthly allowance. Amount shared; purchases private. |
| **Tight month / year** | A month where a goal is underfunded or the emergency fund is below the floor; a plan year containing one. |
| **Show the math** | The formula, inputs, and assumptions behind any number. |
