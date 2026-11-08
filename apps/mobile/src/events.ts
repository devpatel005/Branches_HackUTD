import { useEffect, useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '@branches/bindings';
import { EVENT_TEMPLATES, type EffectLine, type LifeEventTemplateId, type Provenance } from '@branches/engine';
import { useMe } from './household';

/**
 * Life events, impact and the chat thread.
 *
 * The impact row holds exactly what the card renders — the module strips the
 * two full projections before storing, since each is ~13 KB and the card needs
 * neither.
 */

export type StoredImpact = {
  newlyAtRiskGoalIds: string[];
  shortfallsByGoalId: Record<string, number>;
  alreadyAtRiskGoalIds: string[];
  tightYearsBefore: number[];
  tightYearsAfter: number[];
  tightMonthsAfter: number[];
  emergencyMonthsMinBefore: number;
  emergencyMonthsMinAfter: number;
  freeToPlanBefore: number;
  freeToPlanAfter: number;
  noImpact: boolean;
  effects: EffectLine[];
  provenance: Provenance;
  goalsAfter: { id: string; funded: boolean; shortfall: number; settleMonth: number }[];
  seriesAfter: { month: number; totalSavings: number }[];
};

export type AffordabilityPayload = {
  amount: number;
  label: string;
  affordableWithoutChanges: boolean;
  newlyAtRiskGoalIds: string[];
  emergencyMonthsNowBefore: number;
  emergencyMonthsNowAfter: number;
  emergencyMonthsMinBefore: number;
  emergencyMonthsMinAfter: number;
  minimalDelayByGoalId: Record<string, number | null>;
  minimalSaveMore: number | null;
  tightMonthsBefore: number;
  tightMonthsAfter: number;
};

/** The one event currently in play, if any. */
export function useActiveEvent() {
  const { me } = useMe();
  const [rows, ready] = useTable(tables.lifeEvent);
  const event = me
    ? rows
        .filter(
          e =>
            e.householdId === me.householdId && (e.status === 'active' || e.status === 'draft')
        )
        .sort((a, b) => (a.id < b.id ? 1 : -1))[0]
    : undefined;
  return { event, ready };
}

export function useImpact(eventId: bigint | undefined) {
  const [rows] = useTable(tables.impact);
  const row = eventId !== undefined ? rows.find(i => i.eventId === eventId) : undefined;

  const impact = useMemo(() => {
    if (!row) return undefined;
    try {
      return JSON.parse(row.json) as StoredImpact;
    } catch {
      return undefined;
    }
  }, [row?.json]);

  return { impact, computedAt: row?.computedAt };
}

/**
 * The job the agent is working on right now, if any.
 *
 * `progressText` is written by the agent service as it goes, so both partners
 * see "Thinking…" at the same moment (04 Architecture#Message bus pattern).
 */
/**
 * How long outstanding agent work may go quiet before the UI offers a way
 * around it.
 *
 * Shorter than the service's own task budget (60s) and the module's staleness
 * threshold (120s), on purpose: this is not a declaration that the job failed,
 * it is an offer of the form while the job keeps trying. The deterministic path
 * is always available, so saying so early costs nothing and being wrong costs
 * nothing either.
 */
const AGENT_QUIET_MS = 20000;

export function useAgentActivity() {
  const { me } = useMe();
  const [jobs, ready] = useTable(tables.agentJob);
  const mine = me ? jobs.filter(j => j.householdId === me.householdId) : [];
  const running = mine.find(j => j.status === 'running');
  const queuedJobs = mine.filter(j => j.status === 'queued');
  const queued = queuedJobs.length;
  const lastFailed = mine
    .filter(j => j.status === 'failed')
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0];

  const outstanding = running ?? queuedJobs.sort((a, b) => (a.id < b.id ? -1 : 1))[0];

  // A clock, because the thing we are trying to detect is the *absence* of
  // change. If the agent service dies mid-job its row never updates again, so
  // no subscription event will ever arrive to re-render this — without a tick
  // the spinner stays on screen forever and the user has nothing to act on.
  // The interval only runs while something is outstanding.
  const [now, setNow] = useState(() => Date.now());
  const hasOutstanding = outstanding !== undefined;
  useEffect(() => {
    if (!hasOutstanding) return;
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, [hasOutstanding]);

  // The claim stamp for running work, the queue time for work not yet picked
  // up: a job nobody ever claims is just as stuck as one abandoned halfway.
  const sinceMicros = running
    ? (running.claimedAt ?? running.createdAt).microsSinceUnixEpoch
    : outstanding?.createdAt.microsSinceUnixEpoch;

  const quietMs =
    sinceMicros === undefined ? 0 : Math.max(0, now - Number(sinceMicros / 1000n));

  return {
    ready,
    running,
    queued,
    progressText: running?.progressText ?? '',
    /** Whether an agent is registered at all — drives the fallback copy. */
    lastFailed,
    /** Outstanding work that has gone quiet for longer than is reassuring. */
    stalled: hasOutstanding && quietMs > AGENT_QUIET_MS,
    quietSeconds: Math.round(quietMs / 1000),
  };
}

/** True when an agent member exists for this household. */
export function useHasAgent() {
  const [members] = useTable(tables.member);
  const { me } = useMe();
  return me ? members.some(m => m.householdId === me.householdId && m.role === 'agent') : false;
}

/** The shared thread, oldest first. */
export function useThread() {
  const { me } = useMe();
  const [rows, ready] = useTable(tables.chatMessage);
  const messages = me
    ? rows
        .filter(m => m.householdId === me.householdId)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
    : [];
  return { messages, ready };
}

/** Templates in a stable display order, with their asked parameters. */
export const EVENT_TEMPLATE_LIST: {
  id: LifeEventTemplateId;
  label: string;
  icon: string;
}[] = [
  { id: 'baby', label: EVENT_TEMPLATES.baby.label, icon: '🍼' },
  { id: 'job_loss', label: EVENT_TEMPLATES.job_loss.label, icon: '💼' },
  { id: 'raise', label: EVENT_TEMPLATES.raise.label, icon: '📈' },
  { id: 'medical_bill', label: EVENT_TEMPLATES.medical_bill.label, icon: '🏥' },
  { id: 'car_replacement', label: EVENT_TEMPLATES.car_replacement.label, icon: '🚗' },
  { id: 'windfall', label: EVENT_TEMPLATES.windfall.label, icon: '🎁' },
];

export type FormField = {
  key: string;
  label: string;
  kind: 'number' | 'choice' | 'member';
  options?: readonly string[];
  /** Default as a string, ready for a text field. */
  initial: string;
};

/**
 * The form for a template, derived from the engine's own parameter specs.
 *
 * This is the permanent fallback for when the agent is unavailable
 * (07 Agent Spec#Deterministic fallbacks), so it must cover every parameter —
 * generating it from the spec means a new template gets a form for free.
 */
export function formFieldsFor(templateId: LifeEventTemplateId): FormField[] {
  const spec = EVENT_TEMPLATES[templateId].params;
  return Object.entries(spec).map(([key, param]) => ({
    key,
    label: FIELD_LABELS[key] ?? key,
    kind: param.isMember ? 'member' : param.choices ? 'choice' : 'number',
    options: param.choices,
    initial: param.default === undefined ? '' : String(param.default),
  }));
}

const FIELD_LABELS: Record<string, string> = {
  monthsUntilBirth: 'Months until the birth',
  leaveMember: 'Who takes leave',
  leaveMonths: 'Months of unpaid leave',
  care: 'Childcare',
  member: 'Who',
  monthsWithoutIncome: 'Months without income',
  startMonth: 'Starting in month',
  amount: 'Amount ($)',
  month: 'In month',
  price: 'Price ($)',
  downPaymentPct: 'Down payment (%)',
  monthlyIncrease: 'Monthly increase ($)',
};

const CHOICE_LABELS: Record<string, string> = {
  daycare: 'Daycare',
  home: 'One of us stays home',
};

export function choiceLabel(value: string): string {
  return CHOICE_LABELS[value] ?? value;
}
