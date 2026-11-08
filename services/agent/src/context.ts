import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The **one** function that builds model context — 07 Agent Spec#Context builder.
 *
 * Nothing else in this service may send data to a model. That is the whole
 * privacy architecture (02 Ground Rules #3): instead of auditing every call
 * site, there is one allowlist, here, and `verify:agent` greps the logged
 * prompts for canary merchant names to prove it holds.
 *
 * Allowed: member display names and colours; baseline totals; fun-money
 * **amounts** only; goals; the engine output relevant to this task; active
 * constraints; the last few chat messages.
 *
 * **Never**: transactions, counterparties, inferred-item detail, fun-money
 * status history, or anything from the device-local private purchases store.
 */

export const RECENT_MESSAGE_LIMIT = 8;

export type AgentContextInput = {
  members: { id: string; displayName: string; colorKey: string }[];
  baseline?: {
    incomeByMember: Record<string, number>;
    fixed: number;
    debt: number;
    flexible: number;
    retirement: number;
    liquidSavings: number;
  };
  /** Amounts only. A status or a purchase must never reach here. */
  funMoneyByMember?: Record<string, number>;
  goals?: {
    id: string;
    title: string;
    costToday: number;
    targetMonth: number;
    targetLabel: string;
    priority: string;
    funded?: boolean;
    requiredMonthly?: number;
  }[];
  /** Engine output for this task: impact, candidates, affordability. */
  engineData?: unknown;
  constraints?: { memberId: string; kind: string; target: unknown }[];
  recentMessages?: { author: string; text: string }[];
};

/** The shape handed to a model. Deliberately plain JSON, easy to eyeball. */
export type AgentContext = {
  household: { members: { name: string; colour: string }[] };
  money?: {
    incomePerMonth: Record<string, number>;
    fixedPerMonth: number;
    debtPerMonth: number;
    everydaySpendingPerMonth: number;
    setAsideForRetirementPerMonth: number;
    savings: number;
    funMoneyPerMonth?: Record<string, number>;
  };
  goals?: AgentContextInput['goals'];
  engineData?: unknown;
  constraints?: AgentContextInput['constraints'];
  recentMessages?: AgentContextInput['recentMessages'];
};

/**
 * Build the context. Every field is copied explicitly — there is no spread of
 * a database row anywhere in this function, deliberately, so a new column can
 * never leak by default.
 */
export function buildContext(input: AgentContextInput): AgentContext {
  const context: AgentContext = {
    household: {
      members: input.members.map(m => ({ name: m.displayName, colour: m.colorKey })),
    },
  };

  if (input.baseline) {
    const nameOf = (memberId: string) =>
      input.members.find(m => m.id === memberId)?.displayName ?? memberId;

    const incomePerMonth: Record<string, number> = {};
    for (const [memberId, amount] of Object.entries(input.baseline.incomeByMember)) {
      incomePerMonth[nameOf(memberId)] = amount;
    }

    let funMoneyPerMonth: Record<string, number> | undefined;
    if (input.funMoneyByMember) {
      funMoneyPerMonth = {};
      for (const [memberId, amount] of Object.entries(input.funMoneyByMember)) {
        funMoneyPerMonth[nameOf(memberId)] = amount;
      }
    }

    context.money = {
      incomePerMonth,
      fixedPerMonth: input.baseline.fixed,
      debtPerMonth: input.baseline.debt,
      everydaySpendingPerMonth: input.baseline.flexible,
      setAsideForRetirementPerMonth: input.baseline.retirement,
      savings: input.baseline.liquidSavings,
      funMoneyPerMonth,
    };
  }

  if (input.goals) context.goals = input.goals;
  if (input.engineData !== undefined) context.engineData = input.engineData;
  if (input.constraints) context.constraints = input.constraints;
  if (input.recentMessages) {
    context.recentMessages = input.recentMessages.slice(-RECENT_MESSAGE_LIMIT);
  }

  return context;
}

/**
 * Every number anywhere in the context, for the numbers whitelist.
 *
 * Walks the context rather than taking a curated list, so a number the model
 * was shown is automatically allowed to appear in its reply — and one it was
 * never shown is not.
 */
export function numbersInContext(value: unknown, found = new Set<number>()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    found.add(value);
    // Money is often displayed rounded, so the rounded form counts as shown.
    found.add(Math.round(value));
    found.add(Math.round(value * 100) / 100);
    found.add(Math.round(value * 10) / 10);
  } else if (Array.isArray(value)) {
    for (const item of value) numbersInContext(item, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) numbersInContext(item, found);
  } else if (typeof value === 'string') {
    // Numbers embedded in engine-produced strings — a date label, an effect
    // line like "$1,200 more each month" — count as shown too.
    for (const match of value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
      const parsed = Number(match[0].replace(/,/g, ''));
      if (Number.isFinite(parsed)) found.add(parsed);
    }
  }
  return found;
}

/**
 * Log the final prompt in development, so `verify:agent` can grep it for canary
 * merchant names (12 Verification#V5 A7).
 *
 * Writes only when `AGENT_PROMPT_LOG` is set, so production never accumulates
 * prompts on disk.
 */
export function logPrompt(entry: {
  jobKind: string;
  tier: string;
  messages: unknown;
  context: unknown;
}): void {
  const path = process.env.AGENT_PROMPT_LOG;
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      'utf8'
    );
  } catch {
    // Logging must never break a job.
  }
}

/** Default log location, used by the verify script. */
export function defaultPromptLog(): string {
  return join(process.cwd(), '.agent-prompts.log');
}
