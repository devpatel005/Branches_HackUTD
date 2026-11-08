---
tags: [branches, spec, screens]
---
# 10 Screens

Visual rules: [[09 Design System]]. Every screen works on phone (Expo Go) and laptop (Expo web, centered column, max width ~480px).

## Navigation
- First launch → **Welcome**.
- After onboarding → tabs: **Home · Timeline · Chat · Menu**.
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

## Menu
The fourth tab. Not part of the journey — it is the page you need *between*
runs, and the two things on it are the two ways a demo gets stuck.

- **"Bring the agent here."** Writes an `agent_request` row; the service
  prefers the newest one over both of its own targeting rules, including
  `AGENT_JOIN_CODE`, and it is the only rule allowed to move the service
  *backwards* to an older household id. Above the button, a row says whether
  this household has an agent member row at all — which is what Chat's "no
  agent is running" actually reports.
  - Why it is needed: with no `AGENT_JOIN_CODE` the service serves the
    **newest** household it can see. `verify:flow` mints one on every run, so a
    verification run steals the agent, and the forward-only guard means it
    never comes back. Before this button the fix was reading a log, finding a
    join code and editing a dotfile mid-demo.
  - A request only outranks `AGENT_JOIN_CODE` if it is recent
    (`AGENT_REQUEST_WINDOW_MS`, 10 minutes). Otherwise a tap from last week
    would beat the pinned code on every boot forever.
  - The service polls, so the button reports what it *sent*; the agent row
    above flips to "connected" on its own, within about a second.
- **One button: "Reset everything."** Calls `reseedHousehold`, which clears the
  whole plan and sets `onboarded` back to false. `RouteGate` watches that flag,
  so one tap sends **both** devices back to the start of onboarding at once —
  the reset needs no navigation of its own.
- It **arms on the first tap and acts on the second**, because this tab is
  reachable during the demo and a stray tap would wipe the plan with no undo.
- What it keeps, deliberately: the household, both members and the join code
  (so the devices stay paired), and the imported transactions (so inference
  re-runs from the same data). Pinned by `verify:flow` R1–R9.
- Below the button, the facts that are awkward to find while driving two tabs:
  device slot, your name, join code, member count, onboarded state, database
  and host. On web it also points at `?device=b`.

Not reachable mid-onboarding — it lives behind the tabs. Clearing browser
storage is still the only escape from a half-finished onboarding, since
there is no way to leave a household ([[13 Open Decisions]] OD-21).

## Sheets
- **Show the Math:** formula in words, inputs, assumptions, result. Readable by a non-expert.
- **Assumptions:** savings rate, inflation, loan rates; editing recomputes the plan live for both partners.
- **Fun Money:** shared amount and status; **My purchases** list visible only on the owner's device (local mock data).

## States every screen needs
Loading (only when no data yet — see [[14 Research Notes#SpacetimeDB]] flashing bug), empty, offline/reconnecting banner, error with retry, and agent-unavailable (fallback UI).
