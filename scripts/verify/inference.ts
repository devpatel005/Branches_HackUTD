/**
 * V3 Inference — 12 Verification#V3 Inference.
 *
 * Generates Test Household A's transactions, runs inference, and compares to
 * the expected table in 11 Mock Data#Expected inference output — exact rows,
 * exact order, exact amounts — plus the 2 gap questions. Also asserts that
 * generating the household twice yields identical transactions.
 */
import {
  FLEXIBLE_LABEL,
  baselineFromItems,
  emergencyFloor,
  inferBaseline,
  isRecurring,
  simulate,
  TEST_HOUSEHOLD_A_GOALS,
  DEFAULT_ASSUMPTIONS,
  type InferredItem,
  type Transaction,
} from '@branches/engine';
import {
  PRIVATE_MERCHANT_CANARIES,
  TEST_HOUSEHOLD_A_FUN_MONEY,
  TEST_HOUSEHOLD_A_LIQUID_SAVINGS,
  generateTestHouseholdA,
} from '@branches/mock-data';
import { check, printTable, type Check } from './table.ts';

const checks: Check[] = [];

const household = generateTestHouseholdA();
const inference = inferBaseline(household.transactions);

/** Compact row form, so a mismatch is readable in the table. */
const row = (i: InferredItem) => `${i.ownerMemberId}/${i.kind}/${i.label}/${i.monthly.toFixed(2)}`;

// ======================================================================
// The expected table from 11 Mock Data#Expected inference output
// ======================================================================
const EXPECTED_ROWS = [
  'A/income/Northwind Corp/5000.00',
  'A/fixed/Oakridge Apartments/2200.00',
  'A/fixed/Shieldway Insurance/300.00',
  'A/fixed/StreamBox/20.00',
  'A/fixed/TuneHub/10.00',
  'A/debt/Lakeside Auto Finance/350.00',
  'A/retirement/Harborview Investments/250.00',
  `A/flexible/${FLEXIBLE_LABEL}/800.00`,
  'B/income/Brightline Health/3800.00',
  'B/fixed/Cinewave/30.00',
  'B/fixed/FitCore Gym/40.00',
  'B/fixed/Lone Star Energy/250.00',
  'B/fixed/Metro Wireless/150.00',
  'B/debt/Summit Loan Servicing/150.00',
  'B/retirement/Harborview Investments/150.00',
  `B/flexible/${FLEXIBLE_LABEL}/700.00`,
];

checks.push(
  check('I1', 'inferred items match the expected table exactly, in order', inference.items.map(row), EXPECTED_ROWS),
  check('I2', 'exactly 16 inferred items', inference.items.length, 16)
);

// ======================================================================
// Gap questions — exactly 2, one per brokerage item
// ======================================================================
checks.push(
  check('I3', 'exactly 2 gap questions', inference.gapQuestions.length, 2),
  check(
    'I4',
    'one gap question per brokerage item, owner-ordered',
    inference.gapQuestions.map(q => `${q.ownerMemberId}/${q.subject}/${q.answerType}`),
    ['A/Harborview Investments/choice', 'B/Harborview Investments/choice']
  ),
  check(
    'I5',
    'the gap question offers retirement or investing',
    inference.gapQuestions[0]?.options,
    ['Retirement', 'Investing']
  )
);

// ======================================================================
// No merchant group may look recurring (11 Mock Data)
// ======================================================================
const merchantGroups = new Map<string, Transaction[]>();
for (const t of household.transactions) {
  if (t.counterpartyType !== 'merchant') continue;
  const key = `${t.ownerMemberId}:${t.counterparty}`;
  merchantGroups.set(key, [...(merchantGroups.get(key) ?? []), t]);
}
const recurringMerchants = [...merchantGroups.entries()]
  .filter(([, group]) => isRecurring(group))
  .map(([key]) => key)
  .sort();

// Guarded structurally: each merchant name is used in exactly 2 distinct
// months, and the recurring test needs 3. If this ever fails, the generator
// has drifted and the flexible total is no longer trustworthy.
const maxMerchantMonths = Math.max(
  ...[...merchantGroups.values()].map(g => new Set(g.map(t => t.date.slice(0, 7))).size)
);

checks.push(
  check('I6', 'no merchant group is detected as recurring', recurringMerchants, []),
  check('I7', 'no merchant appears in 3+ distinct months', maxMerchantMonths < 3, true),
  check(
    'I8',
    'only the expected non-merchant groups recur',
    inference.recurringGroups,
    [
      'A:Harborview Investments',
      'A:Lakeside Auto Finance',
      'A:Northwind Corp',
      'A:Oakridge Apartments',
      'A:Shieldway Insurance',
      'A:StreamBox',
      'A:TuneHub',
      'B:Brightline Health',
      'B:Cinewave',
      'B:FitCore Gym',
      'B:Harborview Investments',
      'B:Lone Star Energy',
      'B:Metro Wireless',
      'B:Summit Loan Servicing',
    ]
  )
);

// ======================================================================
// The rolled-up baseline must equal 11 Mock Data's "Resulting baseline"
// ======================================================================
const baseline = baselineFromItems(
  inference.items,
  { A: TEST_HOUSEHOLD_A_FUN_MONEY, B: TEST_HOUSEHOLD_A_FUN_MONEY },
  TEST_HOUSEHOLD_A_LIQUID_SAVINGS
);

const surplus =
  baseline.incomeByMember.A! +
  baseline.incomeByMember.B! -
  baseline.fixed -
  baseline.debt -
  baseline.flexible -
  TEST_HOUSEHOLD_A_FUN_MONEY * 2 -
  baseline.retirement;

checks.push(
  check('B1', 'income A', baseline.incomeByMember.A, 5000),
  check('B2', 'income B', baseline.incomeByMember.B, 3800),
  check('B3', 'fixed', baseline.fixed, 3000),
  check('B4', 'debt', baseline.debt, 500),
  check('B5', 'flexible', baseline.flexible, 1500),
  check('B6', 'retirement', baseline.retirement, 400),
  check('B7', 'monthly surplus', surplus, 2800),
  check('B8', 'emergency floor', emergencyFloor(baseline), 10500)
);

// The whole point of inference: the baseline it produces must drive the same
// projection as the hand-written Stage 1 fixture. If these diverge, Stage 1's
// goldens and Stage 2's onboarding disagree about the same household.
const projection = simulate({
  baseline,
  goals: TEST_HOUSEHOLD_A_GOALS,
  assumptions: DEFAULT_ASSUMPTIONS,
});

checks.push(
  check('B9', 'inferred baseline reproduces E3 freeToPlan', projection.freeToPlan, 1899.28),
  check('B10', 'inferred baseline reproduces E2 Japan required', projection.goals.find(g => g.id === 'japan')?.requiredMonthlyAtStart, 211.43),
  check('B11', 'inferred baseline reproduces E2 House required', projection.goals.find(g => g.id === 'house')?.requiredMonthlyAtStart, 689.3),
  check('B12', 'inferred baseline has no at-risk goals', projection.atRiskGoalIds, [])
);

// ======================================================================
// Determinism
// ======================================================================
const again = generateTestHouseholdA();
checks.push(
  check(
    'D1',
    'generating the household twice yields identical transactions',
    JSON.stringify(again.transactions) === JSON.stringify(household.transactions),
    true
  ),
  check(
    'D2',
    'inference over identical input is byte-identical',
    JSON.stringify(inferBaseline(again.transactions)) === JSON.stringify(inference),
    true
  ),
  check(
    'D3',
    'private purchases are deterministic too',
    JSON.stringify(again.privatePurchasesByMember) === JSON.stringify(household.privatePurchasesByMember),
    true
  ),
  check('D4', '12 months of transactions, ending before month 0', new Set(household.transactions.map(t => t.date.slice(0, 7))).size, 12),
  check(
    'D5',
    'no transaction falls in or after the current month',
    household.transactions.filter(t => t.date.slice(0, 7) >= household.currentMonth).length,
    0
  )
);

// ======================================================================
// Privacy — the canaries must not exist in the shared transaction set
// ======================================================================
const transactionBlob = JSON.stringify(household.transactions);
const leakedCanaries = PRIVATE_MERCHANT_CANARIES.filter(name => transactionBlob.includes(name));

const privateTotalA = (household.privatePurchasesByMember.A ?? []).reduce((s, p) => s + p.amount, 0);

checks.push(
  check('V1', 'no private-purchase merchant appears in any transaction', leakedCanaries, []),
  check('V2', 'private purchases exist for both members', Object.keys(household.privatePurchasesByMember).sort(), ['A', 'B']),
  check('V3', "member A's fun-money spend is within the allowance", privateTotalA <= TEST_HOUSEHOLD_A_FUN_MONEY, true)
);

process.exit(printTable('V3 Inference', checks) ? 0 : 1);
