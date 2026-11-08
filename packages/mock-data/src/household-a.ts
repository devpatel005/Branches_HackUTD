import { toCents, type CounterpartyType, type Transaction } from '@branches/engine';
import { SeededRandom } from './random.ts';

/**
 * Test Household A — 11 Mock Data#Test Household A.
 *
 * All names are fictional and all data is fake. These exact numbers back the
 * goldens in 06 Engine Spec, so **never change them** without updating that
 * section, 11 Mock Data, and 12 Verification.
 *
 * Generation is deterministic: same inputs, byte-identical transactions
 * (`verify:inference` asserts it).
 */

export const TEST_HOUSEHOLD_A_SEED = 20260101;
export const TEST_HOUSEHOLD_A_WINDOW_MONTHS = 12;
export const TEST_HOUSEHOLD_A_LIQUID_SAVINGS = 15000;
/** Fun money per member, from the fixture's onboarding answers. */
export const TEST_HOUSEHOLD_A_FUN_MONEY = 300;

/** Display names for the demo. OPEN(OD-1): Test Household A renamed. */
export const DEMO_NAMES = { a: 'Maya', b: 'Jordan' } as const;

type RecurringSpec = {
  counterparty: string;
  counterpartyType: CounterpartyType;
  /** Days of the month the transaction lands on. Income lands twice. */
  days: number[];
  /** Signed dollars per occurrence: positive in, negative out. */
  amount: number;
};

/** Member A's recurring transactions. Monthly totals in the comments. */
const MEMBER_A_RECURRING: RecurringSpec[] = [
  { counterparty: 'Northwind Corp', counterpartyType: 'employer', days: [1, 15], amount: 2500 }, // +5,000
  { counterparty: 'Oakridge Apartments', counterpartyType: 'landlord', days: [1], amount: -2200 },
  { counterparty: 'Shieldway Insurance', counterpartyType: 'insurer', days: [5], amount: -300 },
  { counterparty: 'StreamBox', counterpartyType: 'subscription', days: [8], amount: -20 },
  { counterparty: 'TuneHub', counterpartyType: 'subscription', days: [12], amount: -10 },
  { counterparty: 'Lakeside Auto Finance', counterpartyType: 'lender', days: [20], amount: -350 },
  { counterparty: 'Harborview Investments', counterpartyType: 'brokerage', days: [16], amount: -250 },
];

/** Member B's recurring transactions. */
const MEMBER_B_RECURRING: RecurringSpec[] = [
  { counterparty: 'Brightline Health', counterpartyType: 'employer', days: [1, 15], amount: 1900 }, // +3,800
  { counterparty: 'Lone Star Energy', counterpartyType: 'utility', days: [10], amount: -250 },
  { counterparty: 'Metro Wireless', counterpartyType: 'telecom', days: [18], amount: -150 },
  { counterparty: 'Cinewave', counterpartyType: 'subscription', days: [9], amount: -30 },
  { counterparty: 'FitCore Gym', counterpartyType: 'subscription', days: [3], amount: -40 },
  { counterparty: 'Summit Loan Servicing', counterpartyType: 'lender', days: [22], amount: -150 },
  { counterparty: 'Harborview Investments', counterpartyType: 'brokerage', days: [16], amount: -150 },
];

/** Flexible spending totals, exact per month (11 Mock Data). */
const FLEXIBLE_MONTHLY = { a: 800, b: 700 } as const;

/** Merchants per member per month. 12 x 5 = 60 slots over a 30-name pool. */
const MERCHANTS_PER_MONTH = 5;

/**
 * Pool of fictional merchants for the variable spending.
 *
 * Exactly 30 names, which matters: over 12 months at 5 per month, each name is
 * used exactly **twice**, in two months six apart. The recurring test needs 3+
 * distinct months, so no merchant group can ever be mistaken for a fixed cost.
 * That is a structural guarantee rather than a hope about random amounts
 * (11 Mock Data requires merchant groups to stay non-recurring).
 */
const MERCHANT_POOL: readonly string[] = [
  'Allspice Kitchen', 'Bayside Grocers', 'Blue Ladder Hardware', 'Brickhouse Coffee',
  'Cedar Lane Deli', 'Corner Pharmacy', 'Daybreak Bakery', 'Driftwood Diner',
  'Eastgate Cinema', 'Fernwood Florist', 'Gaslamp Grill', 'Golden Fig Market',
  'Harvest Table', 'Ironwood Barber', 'Juniper Juice Bar', 'Kettle & Crumb',
  'Lantern Books', 'Maplewood Pizza', 'Northside Fuel', 'Oakbarrel Taproom',
  'Pebble Creek Cafe', 'Quarry Road Tacos', 'Riverbend Bistro', 'Saltfield Seafood',
  'Thistle & Thread', 'Umbra Eyewear', 'Vineyard Fresh', 'Westport Noodles',
  'Yardbird Chicken', 'Zephyr Cycles',
];

/** Shift a `YYYY-MM` key by a number of months. No Date parsing. */
export function addMonths(yearMonth: string, delta: number): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`addMonths: expected YYYY-MM, got "${yearMonth}"`);
  }
  const zeroBased = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12 + 12) % 12 + 1;
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`;
}

/** Days in a month, for clamping a scheduled day. Leap years included. */
function daysInMonth(yearMonth: string): number {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isoDate(yearMonth: string, day: number): string {
  const clamped = Math.min(day, daysInMonth(yearMonth));
  return `${yearMonth}-${String(clamped).padStart(2, '0')}`;
}

/**
 * Split `total` across `count` transactions with wide variation, summing to
 * exactly `total` to the cent. The last amount absorbs the rounding residue, so
 * the monthly flexible total is exact as 11 Mock Data requires.
 */
function splitAmount(total: number, count: number, rng: SeededRandom): number[] {
  const weights = Array.from({ length: count }, () => rng.float(0.4, 2.2));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const amounts = weights.map(w => toCents((total * w) / weightSum));
  const assigned = amounts.slice(0, -1).reduce((s, a) => s + a, 0);
  amounts[count - 1] = toCents(total - assigned);
  return amounts;
}

export type GeneratedHousehold = {
  /** The plan's month 0, as `YYYY-MM`. */
  currentMonth: string;
  /** 12 months of transactions ending the month before `currentMonth`. */
  transactions: Transaction[];
  /** Device-local only. **Never written to SpacetimeDB.** */
  privatePurchasesByMember: Record<string, PrivatePurchase[]>;
  memberIds: { a: string; b: string };
};

/**
 * A fun-money purchase. Lives **only** in local app storage on the owner's
 * device (02 Ground Rules #3). These merchant names are the canaries for the
 * privacy check in 12 Verification#V5 Agent contract — if any of them ever
 * appears in a logged prompt or a database row, privacy has been broken.
 */
export type PrivatePurchase = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
};

/** Merchants that appear *only* in private purchases, never in transactions. */
const PRIVATE_MERCHANT_POOL: readonly string[] = [
  'Pixel Arcade', 'Paperleaf Books', 'Velvet Record Shop', 'Hobby Hollow',
  'Sugarpine Candy', 'Tinderbox Games', 'Loomcraft Yarn', 'Solstice Vinyl',
];

export function generateTestHouseholdA(options?: {
  /** Plan month 0 as `YYYY-MM`. Transactions cover the 12 months before it. */
  currentMonth?: string;
  seed?: number;
  memberIds?: { a: string; b: string };
}): GeneratedHousehold {
  // A fixed default so verification never depends on the calendar. Callers in
  // the app pass the household's real currentMonth, derived from ctx.timestamp.
  const currentMonth = options?.currentMonth ?? '2026-11';
  const seed = options?.seed ?? TEST_HOUSEHOLD_A_SEED;
  const memberIds = options?.memberIds ?? { a: 'A', b: 'B' };

  const transactions: Transaction[] = [];
  const months = Array.from({ length: TEST_HOUSEHOLD_A_WINDOW_MONTHS }, (_, i) =>
    addMonths(currentMonth, -(TEST_HOUSEHOLD_A_WINDOW_MONTHS - i))
  );

  const members = [
    { id: memberIds.a, recurring: MEMBER_A_RECURRING, flexible: FLEXIBLE_MONTHLY.a, salt: 1 },
    { id: memberIds.b, recurring: MEMBER_B_RECURRING, flexible: FLEXIBLE_MONTHLY.b, salt: 2 },
  ];

  for (const member of members) {
    // Recurring transactions: fixed amounts on fixed days, every month.
    for (const spec of member.recurring) {
      for (const month of months) {
        for (const day of spec.days) {
          transactions.push({
            id: `${member.id}-${spec.counterparty}-${month}-${day}`,
            ownerMemberId: member.id,
            date: isoDate(month, day),
            amount: spec.amount,
            counterparty: spec.counterparty,
            counterpartyType: spec.counterpartyType,
          });
        }
      }
    }

    // Variable merchant spending. Its own stream per member, so changing one
    // member's data never shifts the other's.
    const rng = new SeededRandom(seed + member.salt * 7919);
    const pool = rng.shuffle(MERCHANT_POOL);

    months.forEach((month, monthIndex) => {
      const amounts = splitAmount(member.flexible, MERCHANTS_PER_MONTH, rng);
      for (let k = 0; k < MERCHANTS_PER_MONTH; k++) {
        // Each pool entry is used exactly twice across the window, six months
        // apart, so no merchant reaches the 3-distinct-month recurring bar.
        const merchant = pool[(monthIndex * MERCHANTS_PER_MONTH + k) % pool.length]!;
        const day = rng.int(2, 27);
        transactions.push({
          id: `${member.id}-merch-${month}-${k}`,
          ownerMemberId: member.id,
          date: isoDate(month, day),
          amount: -amounts[k]!,
          counterparty: merchant,
          counterpartyType: 'merchant',
        });
      }
    });
  }

  // Stable order: date, then owner, then id. Inference does not depend on this,
  // but a stable order makes diffs and database rows reproducible.
  transactions.sort(
    (x, y) =>
      (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) ||
      (x.ownerMemberId < y.ownerMemberId ? -1 : x.ownerMemberId > y.ownerMemberId ? 1 : 0) ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
  );

  const privatePurchasesByMember: Record<string, PrivatePurchase[]> = {};
  for (const member of members) {
    privatePurchasesByMember[member.id] = generatePrivatePurchases(
      member.id,
      currentMonth,
      seed + member.salt * 104729
    );
  }

  return { currentMonth, transactions, privatePurchasesByMember, memberIds };
}

/**
 * This month's fun-money purchases for one member, generated on-device.
 *
 * Kept well under the $300 allowance so the fixture's status is `within`; the
 * Fun Money sheet is the only place these are ever shown, on the owner's device.
 */
export function generatePrivatePurchases(
  memberId: string,
  currentMonth: string,
  seed: number
): PrivatePurchase[] {
  const rng = new SeededRandom(seed);
  const pool = rng.shuffle(PRIVATE_MERCHANT_POOL);
  const count = rng.int(3, 4);
  return Array.from({ length: count }, (_, i) => ({
    id: `${memberId}-private-${currentMonth}-${i}`,
    date: isoDate(currentMonth, rng.int(2, 26)),
    merchant: pool[i]!,
    amount: toCents(rng.float(12, 65)),
  })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Every private-purchase merchant name, for the privacy canary check. */
export const PRIVATE_MERCHANT_CANARIES: readonly string[] = PRIVATE_MERCHANT_POOL;
