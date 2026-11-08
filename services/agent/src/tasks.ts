import { buildContext, logPrompt, type AgentContextInput } from './context.ts';
import {
  callTier,
  finishReasonOf,
  reasoningOf,
  textOf,
  toolCallOf,
  type ChatMessage,
  type Tier,
  type ToolSpec,
} from './providers.ts';
import { shouldFailover } from './providers.ts';
import { SYSTEM_PROMPT } from './tools.ts';
import type { ValidationFailure } from './validate.ts';

/**
 * Running one task: build context once, call a tier, validate, retry once with
 * the error appended, then move to the next tier (07 Agent Spec#Validation).
 *
 * Every task goes through this one function, so the retry-then-failover policy
 * and the prompt logging cannot differ between tasks.
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

export async function runTask<T>(
  tiers: readonly Tier[],
  spec: TaskSpec<T>,
  onProgress?: (text: string) => void
): Promise<TaskOutcome<T>> {
  const context = buildContext(spec.context);
  let attempts = 0;
  let lastReason = 'no tier available';

  for (const tier of tiers) {
    // Two tries per tier: the first, then one retry with the validation error
    // appended so the model can correct itself (07 Agent Spec).
    let correction: string | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      attempts++;
      const messages = buildMessages(spec, context, correction);
      logPrompt({ jobKind: spec.kind, tier: tier.label, messages, context });
      onProgress?.(attempt === 0 ? 'Thinking…' : 'Having another look…');

      const result = await callTier(tier, {
        messages,
        tools: spec.tool ? [spec.tool] : undefined,
        forceTool: spec.tool?.function.name,
        maxTokens: spec.maxTokens,
      });

      if (!result.ok) {
        lastReason = `tier ${tier.tier} (${tier.label}): ${result.status ?? ''} ${result.error}`.trim();
        // A transport or quota failure is not the model's fault, so there is
        // nothing to correct — go straight to the next tier.
        if (result.status === undefined || shouldFailover(result.status)) break;
        break;
      }

      const completion = result.completion;

      // Thinking on would eat the token budget and return nothing usable, so
      // treat it as a tier failure rather than a validation failure.
      if (reasoningOf(completion)) {
        lastReason = `tier ${tier.tier}: returned reasoning content — thinking is not off`;
        break;
      }
      if (finishReasonOf(completion) === 'length') {
        lastReason = `tier ${tier.tier}: response hit the token limit`;
        break;
      }

      let args: unknown = {};
      if (spec.tool) {
        const call = toolCallOf(completion);
        if (!call) {
          correction = 'You must call the provided tool. Do not reply with prose.';
          lastReason = `tier ${tier.tier}: no tool call`;
          continue;
        }
        if (call.function.name !== spec.tool.function.name) {
          correction = `Call ${spec.tool.function.name}, not ${call.function.name}.`;
          lastReason = `tier ${tier.tier}: wrong tool`;
          continue;
        }
        try {
          args = JSON.parse(call.function.arguments);
        } catch (error) {
          correction = `Your tool arguments were not valid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`;
          lastReason = `tier ${tier.tier}: unparsable arguments`;
          continue;
        }
      }

      const parsed = spec.parse(args, textOf(completion));
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
 * The message list.
 *
 * The engine data goes in as JSON in the user turn, which keeps the numbers the
 * model is allowed to use in exactly one place — and lets the validator check
 * its reply against that same object.
 *
 * Strict user/assistant alternation, which the NVIDIA gateway requires
 * (14 Research Notes#Nemotron): a correction is appended to the user turn
 * rather than added as an extra turn.
 */
function buildMessages<T>(
  spec: TaskSpec<T>,
  context: unknown,
  correction: string | null
): ChatMessage[] {
  const parts = [spec.instruction, '', 'Data you may use:', JSON.stringify(context, null, 2)];
  if (correction) {
    parts.push('', `IMPORTANT: ${correction}`);
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ];
}
