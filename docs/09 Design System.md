---
tags: [branches, spec, design]
---
# 09 Design System

**Direction: Robinhood-inspired.** We borrow Robinhood's design *language*: dark, quiet, one bright accent, huge numbers, a single expressive line chart you can scrub, almost no chrome. We do **not** copy Robinhood's logo, name, feather mark, proprietary fonts, illustrations, or screens. Branches has its own identity.

## Principles
1. **One big number per screen.** The number is the hero; everything else supports it.
2. **The chart is the story.** One line, no gridlines or axes, scrubbable with a finger.
3. **Calm by default, color for meaning.** Green means good/primary, red-orange means at risk, partner colors mean *who*. Nothing else gets color.
4. **No homework.** Taps over typing. Chips over forms.
5. **Feel live.** When the other partner changes something, you *see* it move.

## Color tokens
| Token | Value | Use |
|---|---|---|
| `bg` | `#000000` | App background |
| `surface` | `#121212` | Sheets, cards |
| `surfaceRaised` | `#1C1C1E` | Selected cards, inputs |
| `hairline` | `#2C2C2E` | Dividers (1px) |
| `textPrimary` | `#FFFFFF` | Numbers, titles |
| `textSecondary` | `#8E8E93` | Labels, captions |
| `accent` | `#00C805` | On track, primary buttons, positive change |
| `negative` | `#FF5000` | At risk, shortfalls, negative change |
| `caution` | `#FFB800` | Tight years only |
| `memberA` | `#4DA8FF` (Sky) | Member A: avatar, selections, locks, tuning |
| `memberB` | `#B18CFF` (Lavender) | Member B |
| `agent` | `#E5E5EA` | Agent avatar and progress (neutral) |

Partner colors were chosen to never collide with green/red meanings. Final values: OPEN(OD-14).

## Typography
- System font (SF Pro on iOS, Roboto on Android, `system-ui` on web). No custom font required.
- Numbers use tabular figures (`fontVariant: ['tabular-nums']`; `font-variant-numeric: tabular-nums` on web).

| Style | Size / weight | Use |
|---|---|---|
| Display | 44 / bold | The hero number |
| Title | 28 / bold | Screen titles |
| Headline | 20 / semibold | Card titles, section headers |
| Body | 16 / regular | Text |
| Caption | 13 / medium, `textSecondary` | Labels, stats labels |

## Layout
- 8-point grid; 20px side padding; generous vertical space between sections (24–32px).
- Lists are rows separated by hairlines, not boxed cards. Row height ≈ 64px.
- Cards only for **branches** (they're the thing you choose).
- Bottom tab bar with 3 tabs: **Home, Timeline, Chat**. Sessions open full-screen above the tabs.
- Bottom sheets for details (goal detail, show the math, assumptions).

## Signature components
**Hero header.** Display number + caption beneath ("Free to plan each month"). While scrubbing the chart, the hero shows the value at that point and the date replaces the caption (Robinhood's signature interaction).

**Projection chart.** Single line of projected savings across 10 years; solid for the committed plan. Line color `accent` if all goals are funded, `negative` if any goal is at risk. Goal markers as small dots on the line. In a session, up to 3 branch lines overlay in muted tones; the line under each member's selection takes that member's color. Draw with `react-native-svg`.

**Stat row.** 2–4 compact stats: emergency-fund months, tight years, goals on track, free to plan. Caption label above, number below.

**Branch card.** Name (headline), one-line summary, stats as icon rows (🏠 on time · ✈️ +14 mo · 💰 +$210/mo · 🛟 4.2 mo · ⚠️ 1 tight year), member avatars of whoever selected it, reaction emoji, lock icons in the locker's color. Selected state: `surfaceRaised` + 2px border in the selecting member's color (both colors split if both selected).

**Hold-to-confirm ring.** Circular control, one arc segment per member in their color; fills over 1.5s while held; light haptic ticks while holding, success haptic on commit.

**Chips.** Rounded pills for follow-up answers, locks, pins, and goal picks.

## Motion and haptics
- Numbers roll to new values (≈250ms) instead of jumping.
- Remote changes pulse the changed element once in the actor's color.
- Branch cards arrive with a short slide-up + fade, one by one.
- Haptics: light on select, medium on lock/pin, success on commit. No-op on web.
- Avoid confetti and casino-style celebration. Calm, warm, confident.

## Copy tone
Plain, warm, short. "Doesn't fit yet" instead of "failed." "If you…, the projection shows…" instead of "you should." Celebrate life events, not spending.
