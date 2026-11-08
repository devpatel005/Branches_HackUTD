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
