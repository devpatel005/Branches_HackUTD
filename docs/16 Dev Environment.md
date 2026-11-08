---
tags: [branches, ops]
---
# 16 Dev Environment

How we actually run Branches while building it. Product rules live in the specs;
this note is machine-level and expected to change. See OD-18 in
[[13 Open Decisions]].

## Current decision: web on the laptop
**We develop against Expo web in a laptop browser.** Phone testing via Expo Go
is deferred, not abandoned — we may switch back before the demo
([[Stage 7 - Live Planning Session]] needs two real devices for the
[[12 Verification#V6 Real-time checklist]]).

What this means day to day:
- `npm run mobile:web` is the dev loop.
- Two "devices" during development = two browser tabs, or a tab plus
  `npm run verify:stdb`. Both get their own SpacetimeDB identity, which is
  enough to exercise household membership and the live session.
- Write every screen so it still works on a phone ([[10 Screens]] requires both),
  and keep honouring **no custom native modules** ([[02 Ground Rules#6. Runs everywhere we demo]]).
  Stage 0 confirmed the iOS and Android bundles compile, so platform drift is
  the risk to avoid, not platform support.
- Haptics and other phone-only features must still no-op cleanly on web.

## The macOS firewall, and why loopback matters
`spacetimedb-standalone` is listed in the macOS application firewall as
**"Block incoming connections"**, deliberately. That is fine, because:

| Client | Host it must use | Firewall involved? |
|---|---|---|
| Laptop browser (Expo web) | `ws://127.0.0.1:3000` | **No** — loopback is not filtered |
| Node scripts (`verify:stdb`) | `ws://127.0.0.1:3000` | **No** |
| A phone on the same Wi-Fi | `ws://<laptop LAN IP>:3000` | **Yes** — this is genuinely incoming traffic |
| Anything, via Maincloud | `wss://maincloud.spacetimedb.com` | **No** — outbound only |

The failure mode is confusing: pointing the *laptop browser* at the laptop's own
LAN IP also fails, because that traffic leaves and re-enters the network stack
and hits the deny rule. The symptom is a bare `WebSocket error`. The app's
`onConnectError` now names the host it tried and lists the causes.

`EXPO_PUBLIC_*` variables are inlined at **bundle time**, so always restart Expo
after editing `apps/mobile/.env`.

## If we switch to phone testing
Two ways, in preference order.

**Maincloud (preferred).** Nothing listens on the laptop at all; every client is
outbound-only, so the firewall stays shut. Also removes the laptop from the demo
data path and drops the LAN-IP-changes-per-network problem.
```bash
spacetime login                 # browser flow, once
npm run stdb:publish
# apps/mobile/.env:
#   EXPO_PUBLIC_SPACETIME_HOST=wss://maincloud.spacetimedb.com
```

**Local server + open the firewall.** Only if Maincloud is unavailable.
```bash
sudo /usr/libexec/ApplicationFirewall/socketfilterfw \
  --unblockapp ~/.local/share/spacetime/bin/<version>/spacetimedb-standalone
# apps/mobile/.env:
#   EXPO_PUBLIC_SPACETIME_HOST=ws://<laptop LAN IP>:3000
```
The version number is in the path, so this needs redoing after a CLI upgrade.
Reverse with `--blockapp`. The LAN IP changes between networks — re-check with
`ipconfig getifaddr en0`.

## Maincloud is live
Published in [[Stage 1 - Engine Core]]. Both environments are verified against
the same `verify:stdb` suite (8/8 each).

| | Host | Database |
|---|---|---|
| Local | `ws://127.0.0.1:3000` | `branches` |
| Maincloud | `wss://maincloud.spacetimedb.com` | `branches` |

Dashboard: <https://spacetimedb.com/branches>

```bash
npm run stdb:publish       # deploy the module to Maincloud
SPACETIME_HOST=wss://maincloud.spacetimedb.com npm run verify:stdb   # verify it
```

`npm run stdb:publish` passes `--yes=remote`, which skips only the "publish to a
non-local server?" prompt. The **break-clients** and **delete-data** prompts are
deliberately left in place, so a publish can still never silently destroy data.

Local stays the day-to-day loop: instant republish, no network, and nothing
listens on a port the firewall cares about. Maincloud is for phone testing and
the demo.

## Running two identities on one laptop
**Browser tabs do not get separate identities.** AsyncStorage on web is
`localStorage`, which is scoped to the origin, not the tab — so a second tab
loads the first tab's SpacetimeDB token and connects as the **same member**. The
household never reaches two members, and onboarding stalls with nothing to do.

Two ways to hold two identities:

| Approach | How |
|---|---|
| **Device slot** (easiest) | `http://localhost:8081/` is partner A, `http://localhost:8081/?device=b` is partner B |
| Incognito / second browser profile | Its own `localStorage`, so it works with no query param |

The slot is latched into **`sessionStorage`** (per-tab, survives reloads) rather
than re-read from the URL, because `router.replace()` strips the query string —
re-reading it would silently fall back to the shared key and recreate the
collision.

This matters beyond onboarding: [[Stage 7 - Live Planning Session]] needs two
people selecting, tuning and ready-checking at the same time, and the
[[12 Verification#V6 Real-time checklist]] is written for two devices.

The join code is shown on the "waiting for your partner" screen as well as on
Welcome, so a solo member can always find it again.

## Gotcha: the host in `apps/mobile/.env`
This has cost time twice, so it is worth stating plainly.

**While developing on web, never set the host to this machine's LAN IP.** The
browser runs on the same machine as the dev server, so loopback always works;
the LAN IP leaves and re-enters the network stack and gets dropped by the
firewall rule for `spacetimedb-standalone`. The symptom is an opaque
`Load failed`. A phone is the opposite — loopback there means the phone itself.

The app now guards against this: on **web only**, a private LAN host
(`10.*`, `192.168.*`, `172.16-31.*`) is swapped for `ws://127.0.0.1:3000` with a
console warning explaining why. A `wss://` Maincloud host is never touched, and
native platforms are never touched.

**Two layers of caching bite here:**
1. `EXPO_PUBLIC_*` values are inlined at **bundle time** — editing `.env` needs
   an Expo restart.
2. `expo start --clear` clears Metro's *transform* cache but **not** Expo's env
   cache. A stale host can survive it. To be sure:
   ```bash
   pkill -f "expo start"
   rm -rf apps/mobile/.expo
   npm run mobile:web
   ```
   Confirm with: `env: load .env` in the startup log, or grep the bundle for
   `EXPO_PUBLIC_SPACETIME_HOST`.

## Gotcha: a running agent joins the newest household
The agent service serves the **newest** household it can see, so while it is
running it registers into whichever household a verification script just
created — and may post an agent message into it mid-test.

That is correct behaviour, and the scripts tolerate it (`verify:flow` R4 and R9
filter by role and message kind). But if a suite fails only inside
`npm run verify` and passes on its own, a live agent is the first thing to
suspect:

```bash
pkill -f "src/index.ts"
```

Mind the pattern: the service runs as `node ... src/index.ts` from inside
`services/agent`, so matching `services/agent/src/index.ts` finds nothing — and
**two** stray services will fight over the `agent` role, each deleting the
other's member row.

## Gotcha: logging in after creating a local database
`spacetime login` changes the CLI's **active identity**. A local database created
*before* logging in is owned by the earlier server-local identity, and the newly
logged-in identity cannot update or even delete it:

```
Error: Pre-publish check failed with status 403 Forbidden:
  <identity> is not authorized to perform action on database <db>: update database
```

Fix, for a local database holding nothing but dev state:
```bash
spacetime server clear --yes     # deletes the data dir on disk
pkill -f spacetimedb-standalone  # a running server keeps its state in memory
spacetime start                  # restart, then republish
npm run stdb:publish:local
```
The restart is not optional — without it the old database is still served from
memory and the publish fails again. **Check what the database holds first.**

Hit during [[Stage 1 - Engine Core]]. Avoid it by logging in *before* creating
any local database.

## Toolchain as of Stage 0
| Thing | Version | Note |
|---|---|---|
| SpacetimeDB CLI + `spacetimedb` npm | 2.14.1 | keep these two in lockstep |
| Expo SDK | 58 | React 19.3, React Native 0.88.1 |
| Node | 23.10 | **not LTS**; Expo targets 20/22. Runs TypeScript natively, which is why verification scripts need no build step. If Metro or Expo misbehaves, try Node 22 first |
| Package manager | npm workspaces | Metro resolves hoisted `node_modules` more predictably than pnpm's store |
