import { Platform } from 'react-native';

/**
 * Lets one laptop act as two devices.
 *
 * AsyncStorage on web is `localStorage`, which is scoped to the **origin**, not
 * the tab. Two tabs therefore load the same persisted SpacetimeDB token and
 * connect as the *same* identity — so a second tab joins as the existing member
 * instead of as a partner, and the household never reaches two members.
 *
 * Development is web-on-laptop (OD-18, 16 Dev Environment), and
 * [[Stage 7 - Live Planning Session]] needs two people acting at once, so
 * holding two identities on one machine is a hard requirement, not a
 * convenience.
 *
 * Open `?device=b` (any short label) to claim an independent identity:
 *   http://localhost:8081/            -> partner A
 *   http://localhost:8081/?device=b   -> partner B
 *
 * Incognito or a second browser profile also works, since those get their own
 * localStorage. This is just less fiddly.
 *
 * Native is unaffected: separate devices already have separate storage.
 *
 * ## Why sessionStorage
 *
 * The slot is latched into `sessionStorage`, not re-read from the URL on demand,
 * for two reasons:
 *
 *  - `router.replace('/welcome')` **drops the query string**, so by the time the
 *    token is saved the `?device=b` is already gone. Re-reading the URL would
 *    silently fall back to the shared key and recreate the collision.
 *  - `sessionStorage` is scoped per **tab** and survives reloads within it,
 *    which is precisely the lifetime a "device" should have here.
 */
const SLOT_STORAGE_KEY = 'branches.device-slot';

function readSlot(): string | undefined {
  if (Platform.OS !== 'web') return undefined;

  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search ?? '')
      .get('device')
      ?.trim()
      .toLowerCase();

    // Keep it short and boring: it becomes part of a storage key.
    if (fromUrl && /^[a-z0-9_-]{1,16}$/.test(fromUrl)) {
      globalThis.sessionStorage?.setItem(SLOT_STORAGE_KEY, fromUrl);
      return fromUrl;
    }

    return globalThis.sessionStorage?.getItem(SLOT_STORAGE_KEY) ?? undefined;
  } catch {
    // Private-mode browsers can throw on storage access. One shared identity is
    // a better failure than a crash.
    return undefined;
  }
}

/** Latched once per tab, at module load, before any navigation can strip the URL. */
const SLOT = readSlot();

export function deviceSlot(): string | undefined {
  return SLOT;
}

/** Human label for the current slot, shown in dev UI so tabs are tellable apart. */
export function deviceSlotLabel(): string | undefined {
  return SLOT ? `device ${SLOT.toUpperCase()}` : undefined;
}

/** Exported for verification only — exercises the parsing rules without a browser. */
export function isValidSlot(candidate: string): boolean {
  return /^[a-z0-9_-]{1,16}$/.test(candidate);
}
