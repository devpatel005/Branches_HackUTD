---
tags: [branches, spec, realtime]
---
# 08 Live Session Spec

The live session is where real-time matters: **both people acting on the same thing at the same moment**, with an AI as the third participant. Everything here is state in SpacetimeDB; every change appears on every member's screen without refresh.

## Lifecycle
1. **Start:** any member calls `startSession(eventId)` after impact is computed. Status `open`. Only one open session per household.
2. **Invite:** other members get an in-app banner ("Maya started a planning session: baby on the way") on any screen. Tapping joins. (Push notifications are a stretch goal.)
3. **Candidates:** the engine generates candidates; the agent selects and names 3 (or the fallback does). Cards appear **one at a time** as each branch row is written, with "Building branch n of 3…" from the job's progress text.
4. **Decide:** pick, react, tune, lock/reroll, pin/bridge (below).
5. **Commit:** ready check succeeds → plan updated → status `committed` → agent posts a one-line summary.
6. **Leave:** members can close the session without committing; the event stays `active` and the session can be resumed.

## Presence
- `session_member.present` is true while the member has the session screen open and connected.
- Header shows avatars in member colors; absent members are dimmed. Disconnect → absent within ~5 seconds (connect/disconnect lifecycle).

## Selection
- Tapping a card calls `selectBranch`. Each member's avatar appears on their selected card on every screen.
- **Agreement:** all present members on the same card → the hold-to-confirm control appears.
- **Disagreement:** members on different cards → banner "You've picked different branches" with **Pin what matters most**.

## Reactions
- 👍 ❤️ 😬 per card; one per member per card (latest wins). Shown as small emoji next to that member's avatar, instantly on all screens.

## Live tuning
- Opening a card shows its levers as sliders (delay months, shrink %, save more $).
- Dragging calls `tuneLever`, throttled to at most ~10 calls/second; the final value is always sent on release.
- Both screens show the slider moving and the stats recalculating. The tuned card is marked "Tuned by Jordan" in his color.
- Any change to a branch clears every member's `ready` flag.

## Locks and rerolls
- On any card, a member can lock an effect ("House on time"). Locks show on all screens with the locker's color.
- **Reroll** generates new candidates honoring locks and excluding already-shown lever sets; the agent re-selects. If fewer than 3 exist: "These are all the paths that fit what you've locked."

## Pins and bridge branches
- In disagreement, each member pins **one** non-negotiable (same shapes as locks). Pins show on all screens.
- When every present member has pinned, the engine builds **bridge branches** honoring all pins; the agent names them.
- If none exist, show the **closest option** statements ([[06 Engine Spec#Branch candidates]]): what it would take in extra monthly savings or in a goal delay. No AI tiebreaker; the couple can always keep the current plan.

## Ready check
- Visible only when all present members have selected the same branch, and **all household members are present**.
- Each member presses and holds the control. The client sends `setReady(true)` only after the hold reaches **1.5 seconds** (OPEN(OD-6)); releasing early sends nothing; releasing after sends `setReady(false)`.
- The ring shows each member's segment in their color: filled when that member is ready. Others see "Maya is ready — waiting for you."
- **Commit rule (server):** inside `setReady`, if every member's `ready` is true for the same `selectedBranchId`, commit in the same transaction. Commit is idempotent: a second simultaneous call does nothing.
- Any selection change, tuning, lock, pin, or reroll clears all `ready` flags.
- On commit: success haptic on phones, ring completes, plan and timeline update for everyone.

## Agent as the third participant
- The agent appears in the presence header with a neutral style while it's working.
- Its job progress text shows on all screens; branch cards appear as they're written.
- It posts the post-commit summary.

## Edge cases
| Case | Behavior |
|---|---|
| A member disconnects mid-session | Marked absent; ready check hidden until they return; their selections, pins, and locks stay |
| Both press at the exact same moment | Server commits once (idempotent) |
| Agent fails | Fallback names appear; session continues |
| Event dismissed | Session closes for everyone with a banner |
| A tuned branch becomes infeasible | Card shows at-risk goals; ready check still allowed (the couple may choose it knowingly) |
