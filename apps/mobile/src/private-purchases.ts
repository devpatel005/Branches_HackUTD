import AsyncStorage from '@react-native-async-storage/async-storage';
import { generatePrivatePurchases, type PrivatePurchase } from '@branches/mock-data';

/**
 * Fun-money purchases — **device-local only** (02 Ground Rules #3).
 *
 * This module is the entire lifetime of a private purchase. It is deliberately
 * the only file in the app that touches them, and it has no SpacetimeDB import
 * at all, so there is no code path from a purchase to the database or to the
 * agent. Only the monthly *total* leaves here, and only as a
 * `within` / `over` status via `setFunMoneyStatus`.
 *
 * The merchant names are the privacy canaries for 12 Verification#V5: if one
 * ever shows up in a database row or a logged prompt, privacy has broken.
 */

// Keyed by member id, which already differs per device slot, so two tabs on one
// laptop never share a purchase list.
const keyFor = (memberId: string, month: string) =>
  `branches.private-purchases.${memberId}.${month}`;

export async function loadPrivatePurchases(
  memberId: string,
  month: string
): Promise<PrivatePurchase[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(memberId, month));
    if (raw) return JSON.parse(raw) as PrivatePurchase[];
  } catch {
    // A broken store must not break the app; fall through to seeding.
  }
  // Seed deterministically on first read, so the demo has something to show.
  const seeded = generatePrivatePurchases(memberId, month, hashSeed(memberId));
  await savePrivatePurchases(memberId, month, seeded);
  return seeded;
}

export async function savePrivatePurchases(
  memberId: string,
  month: string,
  purchases: PrivatePurchase[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(memberId, month), JSON.stringify(purchases));
  } catch {
    /* non-fatal */
  }
}

export async function clearPrivatePurchases(memberId: string, month: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(memberId, month));
  } catch {
    /* non-fatal */
  }
}

/** Total spent this month, in cents. Never leaves the device. */
export function totalCents(purchases: readonly PrivatePurchase[]): number {
  return purchases.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
}

/**
 * The only thing derived from purchases that is allowed to be shared: a status,
 * plus the carryover that reduces *this member's* next month. The shared plan
 * never changes, so the partner is never notified (02 Ground Rules #3).
 */
export function funMoneyStatus(
  purchases: readonly PrivatePurchase[],
  allowanceCents: number
): { status: 'within' | 'over'; carryoverCents: number } {
  const spent = totalCents(purchases);
  return spent > allowanceCents
    ? { status: 'over', carryoverCents: spent - allowanceCents }
    : { status: 'within', carryoverCents: 0 };
}

/** Stable numeric seed from a member id, so a device reseeds identically. */
function hashSeed(memberId: string): number {
  let h = 2166136261;
  for (let i = 0; i < memberId.length; i++) {
    h ^= memberId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
