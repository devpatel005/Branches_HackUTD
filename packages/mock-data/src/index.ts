/**
 * @branches/mock-data — deterministic mock households (11 Mock Data).
 *
 * All names are fictional, all data is fake. Generation is seeded, so the same
 * inputs always produce byte-identical transactions.
 */
export {
  generateTestHouseholdA,
  generatePrivatePurchases,
  addMonths,
  DEMO_NAMES,
  PRIVATE_MERCHANT_CANARIES,
  TEST_HOUSEHOLD_A_SEED,
  TEST_HOUSEHOLD_A_WINDOW_MONTHS,
  TEST_HOUSEHOLD_A_LIQUID_SAVINGS,
  TEST_HOUSEHOLD_A_FUN_MONEY,
  type GeneratedHousehold,
  type PrivatePurchase,
} from './household-a.ts';

export { SeededRandom, mulberry32 } from './random.ts';
