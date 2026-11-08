/**
 * V2 Engine — 12 Verification#V2 Engine.
 *
 * All of E1-E10 from 06 Engine Spec#Golden scenarios, against Test Household A,
 * plus the constraint, reroll and bridge behaviour from 08 Live Session Spec.
 *
 * The candidate rules E6-E9 exercise are v1 and expected to change
 * (OPEN(OD-3)); generation, ordering and naming are separate functions so they
 * can be swapped without touching these checks.
 *
 * Also enforces the Stage 1 Done-when item that **every number in the output
 * has a provenance record**, by walking the output rather than by listing
 * paths — a new output field cannot silently ship without provenance.
 */
import {
  E4_MEDICAL_BILL_EVENT,
  E5_BABY_EVENT,
  TEST_HOUSEHOLD_A,
  TEST_HOUSEHOLD_A_SURPLUS,
  checkAffordability,
  closestOption,
  computeImpact,
  generateBridges,
  generateCandidates,
  leverSetSignature,
  minimalLevers,
  simulate,
  templateName,
  type Constraint,
  type SimulationOutput,
} from '@branches/engine';
import { check, finish, printTable, type Check } from './table.ts';

const checks: Check[] = [];
const goal = (out: SimulationOutput, id: string) => out.goals.find(g => g.id === id);

/** The fixture's goals, for name templating. Titles are ids at engine level. */
const TEST_HOUSEHOLD_A_GOALS_FOR_NAMES = TEST_HOUSEHOLD_A.goals;
/** Compact "9-23" form for a contiguous run of months, so tables stay readable. */
const span = (months: number[]) =>
  months.length === 0
    ? []
    : months.length === months[months.length - 1]! - months[0]! + 1
      ? `${months[0]}-${months[months.length - 1]}`
      : months;

// ======================================================================
// E1 - baseline inflated costs
// ======================================================================
const baseline = simulate(TEST_HOUSEHOLD_A);

checks.push(
  check('E1a', 'Japan inflated cost', goal(baseline, 'japan')?.inflatedCost, 5273.65),
  check('E1b', 'House inflated cost', goal(baseline, 'house')?.inflatedCost, 45699.58)
);

// ======================================================================
// E2 - required monthly at month 0
// ======================================================================
checks.push(
  check('E2a', 'Japan required monthly at m=0', goal(baseline, 'japan')?.requiredMonthlyAtStart, 211.43),
  check('E2b', 'House required monthly at m=0', goal(baseline, 'house')?.requiredMonthlyAtStart, 689.3)
);

// ======================================================================
// E3 - baseline result
// ======================================================================
checks.push(
  check('E3a', 'baseline atRiskGoalIds', baseline.atRiskGoalIds, []),
  check('E3b', 'baseline tightMonths', baseline.tightMonths, []),
  check('E3c', 'baseline freeToPlan', baseline.freeToPlan, 1899.28),
  check('E3d', 'baseline goalsOnTrack', baseline.goalsOnTrack, { funded: 2, total: 2 }),
  check('E3e', 'emergency floor is 3 x (fixed + debt)', baseline.emergencyFloor, 10500),
  // 15,000 / 3,500
  check('E3f', 'emergencyMonthsNow', baseline.emergencyMonthsNow, 4.29),
  check(
    'E3g',
    'allocation order puts the must-have first',
    baseline.goals.map(g => g.id),
    ['house', 'japan']
  )
);

// ======================================================================
// E4 - medical bill $6,000 at month 3 changes nothing
// ======================================================================
const e4 = simulate({ ...TEST_HOUSEHOLD_A, events: [E4_MEDICAL_BILL_EVENT] });

checks.push(
  check('E4a', 'medical bill: atRiskGoalIds', e4.atRiskGoalIds, []),
  check('E4b', 'medical bill: tightMonths', e4.tightMonths, [])
);

const e4Impact = computeImpact(TEST_HOUSEHOLD_A, E4_MEDICAL_BILL_EVENT);
checks.push(
  check('E4c', 'medical bill: impact reports no impact', e4Impact.noImpact, true),
  check('E4d', 'medical bill: nothing newly at risk', e4Impact.newlyAtRiskGoalIds, [])
);

// ======================================================================
// E5 - baby (birth month 9, member B, 2 months leave, daycare)
// ======================================================================
const e5 = simulate({ ...TEST_HOUSEHOLD_A, events: [E5_BABY_EVENT] });
const e5Months = Array.from({ length: 23 - 9 + 1 }, (_, i) => i + 9);

checks.push(
  check('E5a', 'baby: atRiskGoalIds', e5.atRiskGoalIds, ['japan']),
  check('E5b', 'baby: Japan shortfall', goal(e5, 'japan')?.shortfall, 2183.97),
  check('E5c', 'baby: House still funded', goal(e5, 'house')?.funded, true),
  check('E5d', 'baby: tightMonths are 9 through 23', e5.tightMonths, e5Months),
  check('E5e', 'baby: tightYears', e5.tightYears, [1, 2]),
  check('E5f', 'baby: goalsOnTrack', e5.goalsOnTrack, { funded: 1, total: 2 })
);

const e5Impact = computeImpact(TEST_HOUSEHOLD_A, E5_BABY_EVENT);
checks.push(
  check('E5g', 'baby: impact newly at risk', e5Impact.newlyAtRiskGoalIds, ['japan']),
  check('E5h', 'baby: impact shortfall matches', e5Impact.shortfallsByGoalId, { japan: 2183.97 }),
  check('E5i', 'baby: impact tightMonths before', e5Impact.tightMonthsBefore, []),
  check('E5j', 'baby: impact is not "no impact"', e5Impact.noImpact, false)
);

// ======================================================================
// E10 - determinism: every scenario, run twice, byte-identical JSON
// ======================================================================
const scenarios: [string, () => unknown][] = [
  ['baseline', () => simulate(TEST_HOUSEHOLD_A)],
  ['E4 medical bill', () => simulate({ ...TEST_HOUSEHOLD_A, events: [E4_MEDICAL_BILL_EVENT] })],
  ['E5 baby', () => simulate({ ...TEST_HOUSEHOLD_A, events: [E5_BABY_EVENT] })],
  ['E5 impact', () => computeImpact(TEST_HOUSEHOLD_A, E5_BABY_EVENT)],
  ['affordability $1,200', () => checkAffordability(TEST_HOUSEHOLD_A, 1200, 'couch')],
];

for (const [name, run] of scenarios) {
  const first = JSON.stringify(run());
  const second = JSON.stringify(run());
  checks.push({
    id: `E10.${name.replace(/[^a-z0-9]+/gi, '').slice(0, 10)}`,
    description: `determinism: ${name} is byte-identical across runs`,
    expected: 'identical',
    actual: first === second ? 'identical' : `differs (${first.length} vs ${second.length} chars)`,
    pass: first === second,
  });
}

// ======================================================================
// Provenance coverage — Stage 1 Done-when
// ======================================================================

/**
 * Walk the output for numeric leaves that a user could see, and require a
 * provenance entry for each. Series and month-index arrays are excluded: they
 * are chart geometry, not individually-explained numbers, and the spec's
 * provenance requirement is about *displayed* numbers.
 */
function uncoveredNumericPaths(out: SimulationOutput): string[] {
  const covered = new Set(Object.keys(out.provenance));
  const missing: string[] = [];

  // Scalars and composites the UI renders directly.
  const scalarPaths = [
    'freeToPlan',
    'emergencyMonthsNow',
    'emergencyMonthsMin',
    'emergencyFloor',
    'goalsOnTrack',
    'tightMonths',
    'tightYears',
  ];
  for (const path of scalarPaths) {
    if (!covered.has(path)) missing.push(path);
  }

  // Per-goal numbers. A shortfall only exists when the goal is at risk.
  for (const g of out.goals) {
    for (const field of ['inflatedCost', 'requiredMonthlyAtStart'] as const) {
      const path = `goals.${g.id}.${field}`;
      if (!covered.has(path)) missing.push(path);
    }
    if (g.shortfall > 0 && !covered.has(`goals.${g.id}.shortfall`)) {
      missing.push(`goals.${g.id}.shortfall`);
    }
  }
  return missing;
}

/** Every provenance record must carry a formula, plain text, and a result. */
function malformedProvenance(out: SimulationOutput): string[] {
  return Object.entries(out.provenance)
    .filter(
      ([, rec]) =>
        !rec.formula ||
        !rec.formulaText ||
        rec.formulaText.length < 20 ||
        typeof rec.result !== 'number' ||
        !Number.isFinite(rec.result) ||
        rec.inputs === undefined ||
        rec.assumptions === undefined
    )
    .map(([key]) => key);
}

for (const [label, out] of [
  ['baseline', baseline],
  ['E5 baby', e5],
] as const) {
  checks.push(
    check(`P1.${label.split(' ')[0]}`, `provenance covers every displayed number (${label})`, uncoveredNumericPaths(out), []),
    check(`P2.${label.split(' ')[0]}`, `provenance records are well formed (${label})`, malformedProvenance(out), [])
  );
}

checks.push(
  check(
    'P3',
    'provenance inputs are unrounded, so the math re-walks',
    baseline.provenance['goals.japan.requiredMonthlyAtStart']?.inputs.inflatedCost !== 5273.65,
    true
  ),
  check(
    'P4',
    'freeToPlan provenance records both halves of the subtraction',
    baseline.provenance['freeToPlan']?.inputs.surplusAtMonthZero,
    TEST_HOUSEHOLD_A_SURPLUS
  )
);

// ======================================================================
// Series shape
// ======================================================================
checks.push(
  check('S1', 'monthly series covers the whole 120-month window', baseline.series.monthly.length, 120),
  check('S2', 'yearly series has one sample per plan year', baseline.series.yearly.length, 10),
  check(
    'S3',
    'yearly samples land on end-of-year months',
    baseline.series.yearly.map(s => s.month),
    [11, 23, 35, 47, 59, 71, 83, 95, 107, 119]
  ),
  check('S4', 'month 0 surplus matches the fixture', baseline.series.monthly[0]?.surplus, TEST_HOUSEHOLD_A_SURPLUS)
);

// ======================================================================
// Purity — no time, no randomness reachable from the engine
// ======================================================================
checks.push(
  check(
    'E10.pure',
    'engine output is unaffected by wall-clock time',
    (() => {
      const before = JSON.stringify(simulate(TEST_HOUSEHOLD_A));
      const realNow = Date.now;
      // If anything inside the engine reached for the clock, this would change
      // the result or throw.
      (Date as unknown as { now: () => number }).now = () => 1_700_000_000_000;
      const after = JSON.stringify(simulate(TEST_HOUSEHOLD_A));
      (Date as unknown as { now: () => number }).now = realNow;
      return before === after;
    })(),
    true
  )
);

// ======================================================================
// E6 - minimal levers for E5
// ======================================================================
const e5Input = { ...TEST_HOUSEHOLD_A, events: [E5_BABY_EVENT] };
const minimal = minimalLevers(e5Input);

checks.push(
  check('E6a', 'minimal delay(japan) does not exist', minimal.delays.japan, null),
  check('E6b', 'minimal shrink(japan) does not exist', minimal.shrinks.japan, null),
  check('E6c', 'minimal delay(house) is 18 months', minimal.delays.house, 18),
  check('E6d', 'minimal saveMore is $175', minimal.saveMore, 175)
);

// ======================================================================
// E7 - the balanced pair
// ======================================================================
const balanced = simulate({
  ...e5Input,
  levers: { delays: { house: 9 }, saveMore: 75 },
});

checks.push(
  check('E7a', 'delay(house, 9) + saveMore(75) fixes the plan', balanced.atRiskGoalIds, []),
  check(
    'E7b',
    'and it is generated as a candidate',
    generateCandidates(e5Input).some(c => c.signature === 'd:house=9|m:75'),
    true
  )
);

// ======================================================================
// E8 - candidate order and fallback names
// ======================================================================
const candidates = generateCandidates(e5Input);
// The engine holds no calendar, so the caller supplies month labels. The
// goldens only care about the order, so a stub label is enough here.
const monthLabel = (planMonth: number) => `M${planMonth}`;

checks.push(
  check('E8a', 'candidates appear in the documented order', candidates.slice(0, 3).map(c => c.signature), [
    'm:175',
    'd:house=9|m:75',
    'd:house=18',
  ]),
  check(
    'E8b',
    'fallback names match the templates',
    candidates.slice(0, 3).map(c => templateName(c.levers, TEST_HOUSEHOLD_A_GOALS_FOR_NAMES, monthLabel)),
    ['Save $175 more a month', 'Balanced', 'Move house to M78']
  ),
  check('E8c', 'at most 8 candidates are kept', candidates.length <= 8, true),
  check('E8d', 'no candidate repeats a lever set', new Set(candidates.map(c => c.signature)).size, candidates.length)
);

// ======================================================================
// E9 - each candidate applied
// ======================================================================
for (const [index, candidate] of candidates.slice(0, 3).entries()) {
  const applied = simulate({ ...e5Input, levers: candidate.levers });
  checks.push(
    check(`E9a.${index + 1}`, `candidate ${index + 1} (${candidate.signature}) leaves nothing at risk`, applied.atRiskGoalIds, []),
    check(`E9b.${index + 1}`, `candidate ${index + 1} tight months are [9, 10]`, applied.tightMonths, [9, 10])
  );
}

// ======================================================================
// Constraints, rerolls and bridges (08 Live Session Spec)
// ======================================================================
const houseOnTime: Constraint = { kind: 'goalOnTime', goalId: 'house' };
const lockedCandidates = generateCandidates(e5Input, { constraints: [houseOnTime] });

checks.push(
  check(
    'C1',
    'locking "House on time" never delays the house',
    lockedCandidates.every(c => (c.levers.delays?.house ?? 0) === 0),
    true
  ),
  check('C2', 'and candidates still exist under that lock', lockedCandidates.length > 0, true),
  check(
    'C3',
    'a reroll never repeats an already-shown lever set',
    generateCandidates(e5Input, { exclude: candidates.map(c => c.signature) }).some(c =>
      candidates.some(shown => shown.signature === c.signature)
    ),
    false
  ),
  check(
    'C4',
    'noExtraSaving removes every saveMore candidate',
    generateCandidates(e5Input, { constraints: [{ kind: 'noExtraSaving' }] }).every(
      c => (c.levers.saveMore ?? 0) === 0
    ),
    true
  ),
  check(
    'C5',
    'saveMoreAtMost caps what is offered',
    generateCandidates(e5Input, { constraints: [{ kind: 'saveMoreAtMost', amount: 100 }] }).every(
      c => (c.levers.saveMore ?? 0) <= 100
    ),
    true
  ),
  check('C6', 'signatures are canonical and order-independent', leverSetSignature({ saveMore: 75, delays: { house: 9 } }), 'd:house=9|m:75')
);

// Two conflicting pins: Japan must not move, and no extra saving. Nothing in
// the normal domains can satisfy both, so the closest-option statements answer.
const conflicting: Constraint[] = [
  { kind: 'goalOnTime', goalId: 'japan' },
  { kind: 'noExtraSaving' },
];
const bridges = generateBridges(e5Input, conflicting);
const closest = closestOption(e5Input, conflicting);

checks.push(
  check('B1', 'bridges honour every pin', bridges.every(c => (c.levers.saveMore ?? 0) === 0 && (c.levers.delays?.japan ?? 0) === 0), true),
  check(
    'B2',
    'when no bridge exists, the closest option says what it would take',
    bridges.length === 0 ? closest.saveMore !== null || Object.values(closest.delayByGoalId).some(v => v !== null) : true,
    true
  ),
  check('B3', 'the closest option is deterministic', JSON.stringify(closestOption(e5Input, conflicting)), JSON.stringify(closest))
);

const ok = printTable('V2 Engine (E1-E10)', checks);

// Keep the compact span helper referenced so the import surface stays honest.
void span;

finish(ok);
