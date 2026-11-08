---
tags: [branches, spec, screens]
---
# 10 Screens

Visual rules: [[09 Design System]]. Every screen works on phone (Expo Go) and laptop (Expo web, centered column, max width ~480px).

## Navigation
- First launch → **Welcome**.
- After onboarding → tabs: **Home · Timeline · Chat**.
- **Session** opens full-screen from the invite banner or Chat.
- Sheets: Goal Detail, Show the Math, Assumptions, Fun Money.

## Welcome
- App name, one-line pitch, **Start a household** / **Join a household**.
- Start → shows the 6-character code large, with "Waiting for your partner…" until they join (their avatar pops in live).
- Join → code entry (auto-advance, uppercase).
- Dev only: **Load demo household** (seeds a mock profile).

## Onboarding
1. **Confirm what we found:** inferred items as rows (label, monthly amount, ✓ / edit / ✕). Grouped: Income, Bills, Loans, Set aside. Partner's progress shown at top ("Jordan: 4 of 5").
2. **Fill the gaps:** one question per screen with chips (ranges, choices).
3. **Your fun money:** amount stepper; note: "Your partner sees the amount, never what you buy."
4. **Goals (shared):** grid of goal chips (House, Baby, Travel, Car, Wedding, Custom) → cost + target year + Must-have / Flexible. Goals added by either partner appear live for both.
- Done → Home.

## Home
- Hero: **Free to plan** per month (display number).
- Projection chart (scrubbable).
- Stat row: emergency-fund months · tight years · goals on track.
- Goal list rows: icon, title, target date, status dot (green funded / red-orange at risk), monthly amount.
- Primary button: **Something came up** → Chat with event prompt.
- Live: partner edits pulse in their color.

## Timeline
- Vertical scroll by plan year (Year 1 … Year 10, with calendar years).
- Goals as rows at their target month; applied life events as markers.
- Tight years tinted `caution`.
- Tap a goal → **Goal Detail** sheet: cost today → inflated cost, required monthly, funded status, edit fields, **Show the math**.

## Chat
- Thread with the agent (both partners see the same thread; messages show author color).
- Agent follow-ups as chips.
- When an impact is ready: an **impact card** (goals affected, tight years, emergency-fund change) with **Start planning session**.
- Affordability answers as compact result cards.
- Agent typing/progress indicator from job progress text.

## Session
- Header: event title, member avatars with presence, agent indicator while working.
- Impact summary (collapsible).
- Branch cards: horizontal pager on phone, row of 3 on wide web screens.
- Card actions: select (tap), react, lock effects, open details (sliders).
- Disagreement banner → **Pin what matters most** (chips of possible pins) → bridge branches.
- Reroll button: "Show me other paths."
- Text box: "None of these fit? Tell us what you want." → agent translates to constraints.
- Hold-to-confirm ring when everyone agrees.
- Post-commit: "This is your plan now" + agent summary + **View timeline**.

## Sheets
- **Show the Math:** formula in words, inputs, assumptions, result. Readable by a non-expert.
- **Assumptions:** savings rate, inflation, loan rates; editing recomputes the plan live for both partners.
- **Fun Money:** shared amount and status; **My purchases** list visible only on the owner's device (local mock data).

## States every screen needs
Loading (only when no data yet — see [[14 Research Notes#SpacetimeDB]] flashing bug), empty, offline/reconnecting banner, error with retry, and agent-unavailable (fallback UI).
