import { DEFAULT_ASSUMPTIONS } from './assumptions.ts';
import type { Baseline, Goal, LifeEvent, SimulationInput } from './types.ts';

/**
 * Test Household A from 11 Mock Data#Test Household A, as an engine fixture.
 *
 * These exact numbers back the goldens in 06 Engine Spec#Golden scenarios.
 * **Never change them** without updating that section and 12 Verification.
 *
 * The transaction generator that produces this household from raw mock
 * transactions arrives in Stage 2 (`packages/mock-data`); Stage 1 only needs
 * the confirmed baseline it infers.
 */

/**
 * Resulting baseline: income 8,800 (A 5,000 / B 3,800) · fixed 3,000 ·
 * debt 500 · flexible 1,500 · fun money 600 · retirement 400 ·
 * monthly surplus 2,800 · emergency floor 10,500.
 */
export const TEST_HOUSEHOLD_A_BASELINE: Baseline = {
  incomeByMember: { A: 5000, B: 3800 },
  fixed: 3000,
  debt: 500,
  flexible: 1500,
  funMoneyByMember: { A: 300, B: 300 },
  retirement: 400,
  liquidSavings: 15000,
};

/** Japan $5,000 at month 24 (flexible); House $40,000 at month 60 (must-have). */
export const TEST_HOUSEHOLD_A_GOALS: readonly Goal[] = [
  { id: 'japan', costToday: 5000, targetMonth: 24, priority: 'flex' },
  { id: 'house', costToday: 40000, targetMonth: 60, priority: 'must' },
];

export const TEST_HOUSEHOLD_A: SimulationInput = {
  baseline: TEST_HOUSEHOLD_A_BASELINE,
  goals: TEST_HOUSEHOLD_A_GOALS,
  assumptions: DEFAULT_ASSUMPTIONS,
};

/** The E5 event: baby, birth month 9, member B takes 2 months' leave, daycare. */
export const E5_BABY_EVENT: LifeEvent = {
  templateId: 'baby',
  params: { monthsUntilBirth: 9, leaveMember: 'B', leaveMonths: 2, care: 'daycare' },
};

/** The E4 event: a $6,000 medical bill in month 3. */
export const E4_MEDICAL_BILL_EVENT: LifeEvent = {
  templateId: 'medical_bill',
  params: { amount: 6000, month: 3 },
};

/** Expected monthly surplus for the fixture, as a readability aid in tests. */
export const TEST_HOUSEHOLD_A_SURPLUS = 2800;
