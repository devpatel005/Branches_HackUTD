import { minimalDelay, minimalSaveMore } from './levers.ts';
import { simulate } from './simulate.ts';
import type { LifeEvent, SimulationInput, SimulationOutput } from './types.ts';

/**
 * 06 Engine Spec#Affordability check — "can we afford a $1,200 couch?"
 *
 * Modelled as a one-time cost at month 0, so it goes through the same
 * simulation as everything else. The point is to answer in **time** rather than
 * only in dollars: which goals move and by how much, or "no goal changes;
 * emergency fund goes from 4.2 to 3.9 months".
 */

export type AffordabilityOutput = {
  amount: number;
  label: string;
  atRiskBefore: string[];
  atRiskAfter: string[];
  /** Goals pushed into risk by this purchase alone, in allocation order. */
  newlyAtRiskGoalIds: string[];
  emergencyMonthsNowBefore: number;
  emergencyMonthsNowAfter: number;
  emergencyMonthsMinBefore: number;
  emergencyMonthsMinAfter: number;
  /**
   * Only present when something becomes at risk: the smallest delay per
   * affected goal, and the smallest extra monthly saving, that would absorb it.
   * `null` means no value in range works.
   */
  minimalDelayByGoalId: Readonly<Record<string, number | null>>;
  minimalSaveMore: number | null;
  /** True when no goal changes — the easy, common answer. */
  affordableWithoutChanges: boolean;
  before: SimulationOutput;
  after: SimulationOutput;
};

export function checkAffordability(
  input: SimulationInput,
  amount: number,
  label: string
): AffordabilityOutput {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`checkAffordability: amount must be a non-negative number, got ${amount}`);
  }

  // A purchase is just a one-time cost at month 0. Reusing the windfall
  // template with a negative sign would be clever and unreadable; a
  // medical_bill-shaped one-time cost is the honest model.
  const purchase: LifeEvent = {
    templateId: 'medical_bill',
    params: { amount, month: 0 },
  };

  const existing = input.events ?? [];
  const before = simulate(input);
  const after = simulate({ ...input, events: [...existing, purchase] });

  const wasAtRisk = new Set(before.atRiskGoalIds);
  const newlyAtRiskGoalIds = after.atRiskGoalIds.filter(id => !wasAtRisk.has(id));

  const minimalDelayByGoalId: Record<string, number | null> = {};
  let minSaveMore: number | null = null;

  if (newlyAtRiskGoalIds.length > 0) {
    // Search against the world that includes the purchase, so the answer is
    // "what would make this work", not "what would fix the plan generally".
    const withPurchase: SimulationInput = { ...input, events: [...existing, purchase] };
    for (const id of newlyAtRiskGoalIds) {
      minimalDelayByGoalId[id] = minimalDelay(withPurchase, id);
    }
    minSaveMore = minimalSaveMore(withPurchase);
  }

  return {
    amount,
    label,
    atRiskBefore: before.atRiskGoalIds,
    atRiskAfter: after.atRiskGoalIds,
    newlyAtRiskGoalIds,
    emergencyMonthsNowBefore: before.emergencyMonthsNow,
    emergencyMonthsNowAfter: after.emergencyMonthsNow,
    emergencyMonthsMinBefore: before.emergencyMonthsMin.months,
    emergencyMonthsMinAfter: after.emergencyMonthsMin.months,
    minimalDelayByGoalId,
    minimalSaveMore: minSaveMore,
    affordableWithoutChanges: newlyAtRiskGoalIds.length === 0,
    before,
    after,
  };
}
