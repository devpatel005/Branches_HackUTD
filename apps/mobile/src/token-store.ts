import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persists the SpacetimeDB identity token so a reload keeps the same identity
 * (04 Architecture#Identity and households).
 *
 * AsyncStorage, not localStorage: localStorage does not exist in React Native,
 * and AsyncStorage works on native *and* web (14 Research Notes#SpacetimeDB).
 */
import { deviceSlot } from './device-slot.ts';

/**
 * The storage key is namespaced by device slot, so `?device=b` on web holds a
 * second, independent identity on the same machine. Without this, two browser
 * tabs share one localStorage and therefore one identity — see device-slot.ts.
 */
function key(): string {
  const slot = deviceSlot();
  return slot ? `branches.spacetime.token.${slot}` : 'branches.spacetime.token';
}

export async function loadToken(): Promise<string | undefined> {
  try {
    return (await AsyncStorage.getItem(key())) ?? undefined;
  } catch {
    // A broken store must not block the app from connecting fresh.
    return undefined;
  }
}

export async function saveToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key(), token);
  } catch {
    // Non-fatal: the identity just won't survive a reload.
  }
}

export async function clearToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(key());
  } catch {
    /* non-fatal */
  }
}
