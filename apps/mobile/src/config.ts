import Constants from 'expo-constants';

/**
 * SpacetimeDB connection settings. Read from Expo's extra/env so the phone and
 * the laptop can point at the same server (04 Architecture#Environment variables).
 *
 * On a phone, 127.0.0.1 is the phone itself — set SPACETIME_HOST to your
 * laptop's LAN IP (e.g. ws://192.168.1.20:3000) when testing against a local
 * server, or publish to Maincloud and use wss://maincloud.spacetimedb.com.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const SPACETIME_HOST =
  process.env.EXPO_PUBLIC_SPACETIME_HOST ?? extra.spacetimeHost ?? 'ws://127.0.0.1:3000';

export const SPACETIME_DB_NAME =
  process.env.EXPO_PUBLIC_SPACETIME_DB_NAME ?? extra.spacetimeDbName ?? 'branches';

/** A private LAN address — reachable from a phone, but firewalled on web. */
function isPrivateLanHost(host: string): boolean {
  return /^wss?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

/**
 * On **web**, a LAN-IP host is always a mistake.
 *
 * The browser runs on the same machine as the dev server, so loopback always
 * works — while the LAN IP leaves and re-enters the network stack and gets
 * dropped by the macOS firewall's "block incoming connections" rule for
 * spacetimedb-standalone. The symptom is an opaque `Load failed`.
 *
 * A phone is the opposite: loopback would be the phone itself, so it genuinely
 * needs the LAN IP. Hence web-only, and only for private addresses — a
 * Maincloud `wss://` host is left alone.
 *
 * Returns the host to use plus an explanation when it differs, so the swap is
 * logged rather than silent.
 */
export function resolveHost(platform: string): { host: string; note?: string } {
  if (platform === 'web' && isPrivateLanHost(SPACETIME_HOST)) {
    return {
      host: 'ws://127.0.0.1:3000',
      note:
        `configured host ${SPACETIME_HOST} is a LAN address, which the firewall blocks on web. ` +
        'Using ws://127.0.0.1:3000 instead. Set EXPO_PUBLIC_SPACETIME_HOST to loopback or Maincloud ' +
        'to silence this; the LAN IP is only needed for a phone.',
    };
  }
  return { host: SPACETIME_HOST };
}
