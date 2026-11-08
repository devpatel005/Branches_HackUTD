import { compileEvents } from './events.ts';
import { toCents } from './money.ts';
import {
  WINDOW_MONTHS,
  type Assumptions,
  type Baseline,
  type EffectLedgerEntry,
  type LifeEvent,
} from './types.ts';

/**
 * Turns an event's compiled effects into readable lines — the "why it changed"
 * half of an impact's "Show the Math" (10 Screens#Sheets).
 *
 * Read from `compileEvents`' **ledger**, which the same code writes alongside
 * the arrays the simulation consumes. A description built by re-reading the
 * template could drift from what the projection actually used, and an
 * explanation that disagrees with its number is worse than none
 * (02 Ground Rules #8).
 *
 * The ledger exists because the arrays are sums: a baby's $800/mo and $1,200/mo
 * daycare land in the same slot and read back as $2,000, which is correct
 * arithmetic and a useless explanation.
 */

export type EffectLine = {
  kind: EffectLedgerEntry['kind'];
  /** Inclusive plan-month range. */
  fromMonth: number;
  toMonth: number;
  /** Dollars, always a magnitude. */
  amount: number;
  memberId?: string;
  /** A stable slug for the contribution, for tests and for icon choice. */
  cause: string;
  /** Plain-language description, member names already substituted. */
  label: string;
};

function monthRange(from: number, to: number): string {
  if (from === to) return `month ${from}`;
  if (to >= WINDOW_MONTHS - 1) return `month ${from} onwards`;
  return `months ${from}-${to}`;
}

function money(dollars: number): string {
  const rounded = toCents(Math.abs(dollars));
  const whole = Number.isInteger(rounded);
  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** Plain-language cause names, so a slug never reaches the screen. */
const CAUSE_LABELS: Readonly<Record<string, string>> = {
  birth: 'the birth itself',
  'raising-a-child': 'raising a child',
  daycare: 'daycare',
  'unpaid-leave': 'unpaid leave',
  'staying-home': 'staying home with the baby',
  'out-of-work': 'being out of work',
  'medical-bill': 'the bill',
  'down-payment': 'the down payment',
  'car-loan': 'the car loan',
  raise: 'the raise',
  'money-in': 'money coming in',
};

export function describeEventEffects(
  events: readonly LifeEvent[],
  baseline: Baseline,
  assumptions: Assumptions,
  /** Member ids to display names, so lines read "Jordan's income stops". */
  memberNames: Readonly<Record<string, string>> = {}
): EffectLine[] {
  const { ledger } = compileEvents(events, baseline, assumptions);
  const nameOf = (id: string | undefined) => (id ? memberNames[id] ?? 'Their' : 'Their');

  const lines: EffectLine[] = ledger.map(entry => {
    const when = monthRange(entry.fromMonth, entry.toMonth);
    const cause = CAUSE_LABELS[entry.cause] ?? entry.cause.replace(/-/g, ' ');

    let label: string;
    switch (entry.kind) {
      case 'one-time':
        label =
          entry.amount >= 0
            ? `${money(entry.amount)} once in ${when} for ${cause}`
            : `${money(entry.amount)} comes in during ${when}`;
        break;
      case 'recurring':
        label = `${money(entry.amount)} more each month in ${when} for ${cause}`;
        break;
      case 'income-zeroed':
        label = `${nameOf(entry.memberId)} income stops in ${when} — ${cause}`;
        break;
      case 'income-raised':
        label = `${nameOf(entry.memberId)} income rises by ${money(entry.amount)} in ${when} — ${cause}`;
        break;
    }

    return {
      kind: entry.kind,
      fromMonth: entry.fromMonth,
      toMonth: entry.toMonth,
      amount: toCents(Math.abs(entry.amount)),
      memberId: entry.memberId,
      cause: entry.cause,
      label,
    };
  });

  // Stable order: start month, then kind, then cause. Two identical runs must
  // never swap places between calls (02 Ground Rules #5).
  lines.sort(
    (a, b) =>
      a.fromMonth - b.fromMonth ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      (a.cause < b.cause ? -1 : a.cause > b.cause ? 1 : 0)
  );
  return lines;
}
