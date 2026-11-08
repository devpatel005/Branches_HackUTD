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

## Toolchain as of Stage 0
| Thing | Version | Note |
|---|---|---|
| SpacetimeDB CLI + `spacetimedb` npm | 2.14.1 | keep these two in lockstep |
| Expo SDK | 58 | React 19.3, React Native 0.88.1 |
| Node | 23.10 | **not LTS**; Expo targets 20/22. Runs TypeScript natively, which is why verification scripts need no build step. If Metro or Expo misbehaves, try Node 22 first |
| Package manager | npm workspaces | Metro resolves hoisted `node_modules` more predictably than pnpm's store |
