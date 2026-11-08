import { buildContext, logPrompt, type AgentContextInput } from './context.ts';
import {
  callTier,
  timeoutMs,
  type CallRequest,
  type NormalisedResult,
  type Tier,
  type ToolSpec,
} from './providers.ts';
import { SYSTEM_PROMPT } from './tools.ts';
import type { ValidationFailure } from './validate.ts';

/**
 * Running one task: build context once, call a tier, validate, retry once with
 * the error appended, then move to the next tier (07 Agent Spec#Validation).
 *
 * Every task goes through this one function, so the retry-then-failover policy
 * and the prompt logging cannot differ between tasks — and because `callTier`
 * normalises both providers, they cannot differ between providers either.
 *
 * The whole task is bounded in wall-clock time as well as in attempts. Attempts
 * alone are not a bound: two tiers × two attempts × a 20s timeout is 80
 * seconds, during which the job sits `running` and the couple sits watching a
 * spinner. `AGENT_TASK_BUDGET_MS` caps the lot, and a tier whose timeout cannot
 * fit in what is left is not started at all.
 */

export type TaskOutcome<T> =
  | { ok: true; value: T; modelUsed: string; attempts: number }
  | { ok: false; reason: string; attempts: number };

export type TaskSpec<T> = {
  kind: string;
  /** Allowlisted context for this task. */
  context: AgentContextInput;
  /** Plain-language instruction, prepended to the data. */
  instruction: string;
  tool?: ToolSpec;
  /** Parse and validate the tool arguments (or the text, for `explain`). */
  parse: (args: unknown, text: string) => { ok: true; value: T } | { ok: false; failure: ValidationFailure };
  maxTokens?: number;
};

export function taskBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.AGENT_TASK_BUDGET_MS ?? 60000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
}

export async function runTask<T>(
  tiers: readonly Tier[],
  spec: TaskSpec<T>,
  onProgress?: (text: string) => void
): Promise<TaskOutcome<T>> {
  const context = buildContext(spec.context);
  const deadline = Date.now() + taskBudgetMs();
  let attempts = 0;
  let lastReason = 'no model tier is configured';

  for (const tier of tiers) {
    // Two tries per tier: the first, then one retry with the validation error
    // appended so the model can correct itself (07 Agent Spec).
    let correction: string | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() + timeoutMs() > deadline) {
        // Starting a call that cannot finish inside the budget only delays the
        // fallback the user actually needs.
        lastReason = `out of time after ${attempts} attempt(s): ${lastReason}`;
        return { ok: false, reason: lastReason, attempts };
      }

      attempts++;
      const input = buildInput(spec, context, correction);
      logPrompt({
        jobKind: spec.kind,
        tier: tier.label,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
        context,
      });
      onProgress?.(attempt === 0 ? 'Thinking…' : 'Having another look…');

      const request: CallRequest = {
        system: SYSTEM_PROMPT,
        input,
        tools: spec.tool ? [spec.tool] : undefined,
        forceTool: spec.tool?.name,
        maxTokens: spec.maxTokens,
      };

      const call = await callTier(tier, request);

      if (!call.ok) {
        lastReason = `tier ${tier.tier} (${tier.label}): ${call.status ?? ''} ${call.error}`.trim();
        // A transport, quota or rate-limit failure is not the model's fault, so
        // there is nothing to correct — the next tier is the only useful move.
        break;
      }

      const result = call.result;
      const tierFailure = unusable(result, tier);
      if (tierFailure) {
        lastReason = tierFailure;
        break;
      }

      let args: unknown = {};
      if (spec.tool) {
        if (!result.toolCall) {
          correction = 'You must call the provided tool. Do not reply with prose.';
          lastReason = `tier ${tier.tier}: no tool call (status ${result.rawStatus})`;
          continue;
        }
        if (result.toolCall.name !== spec.tool.name) {
          correction = `Call ${spec.tool.name}, not ${result.toolCall.name}.`;
          lastReason = `tier ${tier.tier}: wrong tool (${result.toolCall.name})`;
          continue;
        }
        args = result.toolCall.arguments;
      }

      const parsed = spec.parse(args, result.text);
      if (parsed.ok) {
        return { ok: true, value: parsed.value, modelUsed: tier.model, attempts };
      }

      correction = `Your previous answer was rejected (${parsed.failure.gate}): ${parsed.failure.detail}`;
      lastReason = `tier ${tier.tier}: ${parsed.failure.gate} — ${parsed.failure.detail}`;
    }
  }

  return { ok: false, reason: lastReason, attempts };
}

/**
 * Whether an answer is unusable for reasons no correction can fix — in which
 * case the next tier, not a retry, is the right move.
 *
 * `incomplete` is the one that matters in practice: the output budget includes
 * thinking tokens, so hitting it returns truncated or empty content with a
 * 200 OK (07 Agent Spec#Model configuration). Retrying the same tier would hit
 * the same ceiling; the next tier thinks less, so it may not.
 */
function unusable(result: NormalisedResult, tier: Tier): string | null {
  if (result.status === 'incomplete') {
    return `tier ${tier.tier}: ended incomplete — output budget hit, answer truncated`;
  }
  if (result.status === 'failed') {
    return `tier ${tier.tier}: provider reported ${result.rawStatus}`;
  }
  if (result.status === 'unknown') {
    return `tier ${tier.tier}: unexpected status ${result.rawStatus}`;
  }
  // An OpenAI-compatible provider with thinking left on spends the token budget
  // on reasoning and returns nothing usable. Gemini never reports this — its
  // thinking is configured by `thinking_level`, not leaked into the answer.
  if (result.reasoning) {
    return `tier ${tier.tier}: returned reasoning content — thinking is not off`;
  }
  return null;
}

/**
 * The prompt body.
 *
 * The engine data goes in as JSON, which keeps the numbers the model is allowed
 * to use in exactly one place — and lets the validator check its reply against
 * that same object.
 *
 * A correction is appended to this one block rather than added as another turn,
 * which is both what Gemini's single `input` wants and what keeps strict
 * user/assistant alternation for OpenAI-compatible gateways.
 */
function buildInput<T>(spec: TaskSpec<T>, context: unknown, correction: string | null): string {
  const parts = [spec.instruction, '', 'Data you may use:', JSON.stringify(context, null, 2)];
  if (correction) {
    parts.push('', `IMPORTANT: ${correction}`);
  }
  return parts.join('\n');
}
