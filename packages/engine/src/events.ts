import { f4LoanPayment } from './formulas.ts';
import {
  WINDOW_MONTHS,
  type Assumptions,
  type Baseline,
  type EventEffects,
  type LifeEvent,
  type LifeEventTemplateId,
  type MemberId,
} from './types.ts';

/**
 * Life event templates from 06 Engine Spec#Life event templates, as data.
 *
 * OPEN(OD-2): every cost and duration below is a **placeholder**. The team may
 * change the numbers or replace the events entirely before the demo, so nothing
 * outside this file should hard-code them.
 */

type ParamSpec = {
  /** Default applied when the parameter is absent. */
  default?: number | string;
  /** True when the agent or the event form is expected to ask for it. */
  asked?: boolean;
  /** Inclusive numeric bounds, where the spec gives them. */
  min?: number;
  max?: number;
  /** Allowed values for an enum parameter. */
  choices?: readonly string[];
  /** A member id is resolved against the household rather than defaulted. */
  isMember?: boolean;
};

export type TemplateSpec = {
  id: LifeEventTemplateId;
  label: string;
  params: Readonly<Record<string, ParamSpec>>;
};

export const EVENT_TEMPLATES: Readonly<Record<LifeEventTemplateId, TemplateSpec>> = {
  baby: {
    id: 'baby',
    label: 'A baby on the way',
    params: {
      monthsUntilBirth: { default: 9, min: 0, max: WINDOW_MONTHS - 1 },
      leaveMember: { isMember: true },
      leaveMonths: { default: 2, asked: true, min: 0, max: 6 },
      care: { default: 'daycare', asked: true, choices: ['daycare', 'home'] },
    },
  },
  job_loss: {
    id: 'job_loss',
    label: 'A job loss',
    params: {
      member: { isMember: true },
      monthsWithoutIncome: { default: 4, asked: true, min: 0, max: WINDOW_MONTHS },
      startMonth: { default: 0, min: 0, max: WINDOW_MONTHS - 1 },
    },
  },
  medical_bill: {
    id: 'medical_bill',
    label: 'A medical bill',
    params: {
      amount: { asked: true, min: 0 },
      month: { default: 0, min: 0, max: WINDOW_MONTHS - 1 },
    },
  },
  car_replacement: {
    id: 'car_replacement',
    label: 'Replacing a car',
    params: {
      price: { asked: true, min: 0 },
      downPaymentPct: { default: 20, min: 0, max: 100 },
      month: { default: 0, min: 0, max: WINDOW_MONTHS - 1 },
    },
  },
  raise: {
    id: 'raise',
    label: 'A raise',
    params: {
      member: { isMember: true },
      monthlyIncrease: { asked: true },
      startMonth: { default: 0, min: 0, max: WINDOW_MONTHS - 1 },
    },
  },
  windfall: {
    id: 'windfall',
    label: 'Money in',
    params: {
      amount: { asked: true, min: 0 },
      month: { default: 0, min: 0, max: WINDOW_MONTHS - 1 },
    },
  },
};

/** Placeholder costs for the `baby` template. OPEN(OD-2). */
export const BABY_COSTS = {
  oneTimeAtBirth: 3000,
  monthlyFromBirth: 800,
  monthlyDaycare: 1200,
  /** F4 term for a car loan, in months. */
  carLoanMonths: 60,
} as const;

/** Months a car loan runs for. OPEN(OD-2). */
export const CAR_LOAN_MONTHS = 60;

export function emptyEffects(memberIds: readonly MemberId[]): EventEffects {
  const overrides: Record<MemberId, (number | null)[]> = {};
  const deltas: Record<MemberId, number[]> = {};
  for (const id of memberIds) {
    overrides[id] = new Array<number | null>(WINDOW_MONTHS).fill(null);
    deltas[id] = new Array<number>(WINDOW_MONTHS).fill(0);
  }
  return {
    oneTimeCosts: new Array<number>(WINDOW_MONTHS).fill(0),
    recurringCosts: new Array<number>(WINDOW_MONTHS).fill(0),
    incomeOverrideByMember: overrides,
    incomeDeltaByMember: deltas,
  };
}

function num(params: Readonly<Record<string, unknown>>, key: string, spec: ParamSpec): number {
  const raw = params[key] ?? spec.default;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`event param "${key}" must be a finite number, got ${String(raw)}`);
  }
  if (spec.min !== undefined && raw < spec.min) {
    throw new Error(`event param "${key}" must be >= ${spec.min}, got ${raw}`);
  }
  if (spec.max !== undefined && raw > spec.max) {
    throw new Error(`event param "${key}" must be <= ${spec.max}, got ${raw}`);
  }
  return raw;
}

function choice(params: Readonly<Record<string, unknown>>, key: string, spec: ParamSpec): string {
  const raw = params[key] ?? spec.default;
  if (typeof raw !== 'string' || !spec.choices?.includes(raw)) {
    throw new Error(
      `event param "${key}" must be one of ${spec.choices?.join(', ')}, got ${String(raw)}`
    );
  }
  return raw;
}

function member(
  params: Readonly<Record<string, unknown>>,
  key: string,
  memberIds: readonly MemberId[]
): MemberId {
  const raw = params[key];
  if (typeof raw !== 'string' || !memberIds.includes(raw)) {
    throw new Error(
      `event param "${key}" must be one of the household's members (${memberIds.join(', ')}), got ${String(raw)}`
    );
  }
  return raw;
}

/** Clamp a month to the plan window so an out-of-range event can't write past the end. */
function inWindow(month: number): boolean {
  return month >= 0 && month < WINDOW_MONTHS;
}

/**
 * Flatten one or more events into per-month arrays.
 *
 * Event costs and income changes are in today's dollars and are **not**
 * inflated (06 Engine Spec). Multiple events accumulate: costs add, and a later
 * income override wins over an earlier one for the same member and month.
 */
export function compileEvents(
  events: readonly LifeEvent[],
  baseline: Baseline,
  assumptions: Assumptions
): EventEffects {
  const memberIds = Object.keys(baseline.incomeByMember).sort();
  const fx = emptyEffects(memberIds);

  for (const event of events) {
    const template = EVENT_TEMPLATES[event.templateId];
    if (!template) throw new Error(`unknown event template: ${event.templateId}`);
    const p = event.params;

    switch (event.templateId) {
      case 'baby': {
        const birth = num(p, 'monthsUntilBirth', template.params.monthsUntilBirth!);
        const leaveMember = member(p, 'leaveMember', memberIds);
        const leaveMonths = num(p, 'leaveMonths', template.params.leaveMonths!);
        const care = choice(p, 'care', template.params.care!);

        if (inWindow(birth)) fx.oneTimeCosts[birth]! += BABY_COSTS.oneTimeAtBirth;
        for (let m = birth; m < WINDOW_MONTHS; m++) {
          if (inWindow(m)) fx.recurringCosts[m]! += BABY_COSTS.monthlyFromBirth;
        }

        if (care === 'home') {
          // One partner stays home: their income stops at birth and does not
          // come back, and there is no childcare cost.
          for (let m = birth; m < WINDOW_MONTHS; m++) {
            if (inWindow(m)) fx.incomeOverrideByMember[leaveMember]![m] = 0;
          }
        } else {
          // Unpaid leave, then daycare once leave ends.
          for (let m = birth; m < birth + leaveMonths; m++) {
            if (inWindow(m)) fx.incomeOverrideByMember[leaveMember]![m] = 0;
          }
          for (let m = birth + leaveMonths; m < WINDOW_MONTHS; m++) {
            if (inWindow(m)) fx.recurringCosts[m]! += BABY_COSTS.monthlyDaycare;
          }
        }
        break;
      }

      case 'job_loss': {
        const who = member(p, 'member', memberIds);
        const months = num(p, 'monthsWithoutIncome', template.params.monthsWithoutIncome!);
        const start = num(p, 'startMonth', template.params.startMonth!);
        for (let m = start; m < start + months; m++) {
          if (inWindow(m)) fx.incomeOverrideByMember[who]![m] = 0;
        }
        break;
      }

      case 'medical_bill': {
        const amount = num(p, 'amount', template.params.amount!);
        const month = num(p, 'month', template.params.month!);
        if (inWindow(month)) fx.oneTimeCosts[month]! += amount;
        break;
      }

      case 'car_replacement': {
        const price = num(p, 'price', template.params.price!);
        const downPct = num(p, 'downPaymentPct', template.params.downPaymentPct!);
        const month = num(p, 'month', template.params.month!);
        const down = price * (downPct / 100);
        const financed = price - down;

        if (inWindow(month)) fx.oneTimeCosts[month]! += down;
        if (financed > 0) {
          const payment = f4LoanPayment(financed, CAR_LOAN_MONTHS, assumptions.carRateAnnual);
          for (let m = month; m < month + CAR_LOAN_MONTHS; m++) {
            if (inWindow(m)) fx.recurringCosts[m]! += payment;
          }
        }
        break;
      }

      case 'raise': {
        const who = member(p, 'member', memberIds);
        const increase = num(p, 'monthlyIncrease', template.params.monthlyIncrease!);
        const start = num(p, 'startMonth', template.params.startMonth!);
        const deltas = fx.incomeDeltaByMember[who]!;
        for (let m = start; m < WINDOW_MONTHS; m++) {
          if (inWindow(m)) deltas[m] = (deltas[m] ?? 0) + increase;
        }
        break;
      }

      case 'windfall': {
        const amount = num(p, 'amount', template.params.amount!);
        const month = num(p, 'month', template.params.month!);
        // A negative "cost": the emergency-fund step subtracts one-time costs,
        // so a negative one adds to the fund (06 Engine Spec).
        if (inWindow(month)) fx.oneTimeCosts[month]! -= amount;
        break;
      }
    }
  }

  return fx;
}

/** Parameters a template expects to be asked for, for the agent's follow-ups. */
export function askedParams(templateId: LifeEventTemplateId): string[] {
  const template = EVENT_TEMPLATES[templateId];
  return Object.keys(template.params)
    .filter(key => template.params[key]?.asked)
    .sort();
}
