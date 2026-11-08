import { z } from 'zod';
import { numbersInContext } from './context.ts';

/**
 * Validation — 07 Agent Spec#Validation.
 *
 * Four gates, all of them mechanical. This file is why "the AI never computes
 * numbers" (02 Ground Rules #1) is a property of the system rather than an
 * instruction in a prompt: a response carrying a number it was never shown is
 * discarded, not trusted.
 *
 * On rejection the caller retries once on the same tier with the error
 * appended, then moves to the next tier, then falls back to a deterministic
 * template. The user is never left stuck.
 */

export const LIFE_EVENT_TEMPLATE_IDS = [
  'baby',
  'job_loss',
  'medical_bill',
  'car_replacement',
  'raise',
  'windfall',
] as const;

// ---------------------------------------------------------------------------
// 1. Schemas
// ---------------------------------------------------------------------------

export const classifyLifeEventSchema = z.object({
  templateId: z.enum(LIFE_EVENT_TEMPLATE_IDS),
  params: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  followUps: z
    .array(
      z.object({
        param: z.string().min(1),
        prompt: z.string().min(1).max(200),
        chips: z.array(z.string().max(40)).max(6).default([]),
      })
    )
    .max(4)
    .default([]),
});

export const selectBranchesSchema = z.object({
  picks: z
    .array(
      z.object({
        candidateId: z.string().min(1),
        name: z.string().min(1).max(30),
        summary: z.string().min(1).max(200),
      })
    )
    .length(3),
});

export const setConstraintsSchema = z.object({
  locks: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('goalOnTime'), goalId: z.string().min(1) }),
        z.object({ kind: z.literal('goalFullSize'), goalId: z.string().min(1) }),
        z.object({ kind: z.literal('noExtraSaving') }),
        z.object({ kind: z.literal('saveMoreAtMost'), amount: z.number().int().min(0) }),
      ])
    )
    .max(4)
    .default([]),
  excludeCandidateIds: z.array(z.string()).max(8).default([]),
});

export const checkAffordabilitySchema = z.object({
  amount: z.number().positive(),
  label: z.string().min(1).max(60),
});

// ---------------------------------------------------------------------------
// 2. Numbers whitelist
// ---------------------------------------------------------------------------

/**
 * Numbers that may appear in agent text without being in the engine data.
 *
 * Only ordinals a sentence needs for grammar — "the first path", "both of
 * you". Deliberately tiny: anything larger is the kind of figure the engine
 * should have produced.
 */
const GRAMMATICAL_NUMBERS = new Set([0, 1, 2, 3]);

export type NumberCheck = {
  ok: boolean;
  /** Numbers in the text that the model was never shown. */
  invented: number[];
};

/**
 * Every number in `text` must appear in the engine data the model was given,
 * after normalising `$1,200` / `1200` / `1200.00`.
 *
 * Small integers are allowed because the engine routinely emits them as counts
 * ("2 goals", "3 months") and rejecting those would mean falling back on almost
 * every reply — a working agent that looks broken. Anything above that must be
 * traceable.
 */
export function checkNumbers(text: string, engineData: unknown): NumberCheck {
  const allowed = numbersInContext(engineData);
  const invented: number[] = [];

  for (const match of text.matchAll(/-?\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const raw = match[0].replace(/[$,%]/g, '');
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (GRAMMATICAL_NUMBERS.has(value) && Number.isInteger(value)) continue;
    if (allowed.has(value)) continue;
    // A year like 2029 is fine if the engine produced a date containing it,
    // which numbersInContext picks up from engine-produced strings.
    invented.push(value);
  }

  return { ok: invented.length === 0, invented: [...new Set(invented)] };
}

// ---------------------------------------------------------------------------
// 3. Language filter
// ---------------------------------------------------------------------------

/**
 * Projections, not advice (02 Ground Rules #2).
 *
 * Word-boundary matched so "shoulder" and "recommendation" in a goal title
 * don't trip it, and so the filter catches the actual phrasing we care about.
 */
const ADVICE_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'should', pattern: /\bshould(n't|n’t)?\b/i },
  { label: 'recommend', pattern: /\brecommend(s|ed|ation|ations)?\b/i },
  { label: 'best option', pattern: /\bbest (option|choice|path|plan)\b/i },
  { label: 'advice', pattern: /\badvice\b|\badvise[sd]?\b/i },
  { label: 'you ought to', pattern: /\bought to\b/i },
  { label: 'I suggest', pattern: /\bI (suggest|advise|recommend)\b/i },
];

export type LanguageCheck = { ok: boolean; found: string[] };

export function checkLanguage(text: string): LanguageCheck {
  const found = ADVICE_PATTERNS.filter(p => p.pattern.test(text)).map(p => p.label);
  return { ok: found.length === 0, found };
}

// ---------------------------------------------------------------------------
// 4. Lengths
// ---------------------------------------------------------------------------

export const MAX_BRANCH_NAME = 30;
export const MAX_BRANCH_SUMMARY = 200;

export type ValidationFailure = { gate: string; detail: string };

/** Validate one piece of agent-written text against gates 2-4. */
export function validateText(
  text: string,
  engineData: unknown,
  limits?: { maxLength?: number; label?: string }
): ValidationFailure | null {
  const label = limits?.label ?? 'text';

  if (limits?.maxLength !== undefined && text.length > limits.maxLength) {
    return {
      gate: 'length',
      detail: `${label} is ${text.length} characters, limit ${limits.maxLength}`,
    };
  }

  const language = checkLanguage(text);
  if (!language.ok) {
    return {
      gate: 'language',
      detail: `${label} uses advice language (${language.found.join(', ')}). Describe the projection instead: "if you do X, the projection shows Y".`,
    };
  }

  const numbers = checkNumbers(text, engineData);
  if (!numbers.ok) {
    return {
      gate: 'numbers',
      detail: `${label} contains ${numbers.invented.join(', ')}, which is not in the data you were given. Use only numbers from the data.`,
    };
  }

  return null;
}

/** Validate a set of branch picks against the candidates that actually exist. */
export function validatePicks(
  picks: { candidateId: string; name: string; summary: string }[],
  validCandidateIds: readonly string[],
  engineData: unknown
): ValidationFailure | null {
  const valid = new Set(validCandidateIds);
  const seen = new Set<string>();

  for (const pick of picks) {
    if (!valid.has(pick.candidateId)) {
      return {
        gate: 'schema',
        detail: `candidateId ${pick.candidateId} is not one of: ${validCandidateIds.join(', ')}`,
      };
    }
    if (seen.has(pick.candidateId)) {
      return { gate: 'schema', detail: `candidateId ${pick.candidateId} is picked twice` };
    }
    seen.add(pick.candidateId);

    const nameFailure = validateText(pick.name, engineData, {
      maxLength: MAX_BRANCH_NAME,
      label: `name "${pick.name}"`,
    });
    if (nameFailure) return nameFailure;

    const summaryFailure = validateText(pick.summary, engineData, {
      maxLength: MAX_BRANCH_SUMMARY,
      label: `summary for ${pick.candidateId}`,
    });
    if (summaryFailure) return summaryFailure;
  }

  return null;
}
