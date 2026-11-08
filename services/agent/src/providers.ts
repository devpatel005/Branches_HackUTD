/**
 * The provider layer.
 *
 * Nemotron is tier 1 by default and must stay the primary decision-maker for
 * the NVIDIA track (14 Research Notes#Nemotron). But every tier is
 * `{ baseUrl, model, apiKey }` from the environment, so any OpenAI-compatible
 * endpoint drops in without touching code — including a local mock, which is
 * what makes the whole bus, validation and failover path testable with no key
 * at all.
 *
 * Request shape notes that cost real debugging time, per 07 Agent Spec:
 *  - `chat_template_kwargs` goes at the **top level** of the body. The research
 *    sample nested it under `extra_body`, which is a Python-SDK convention and
 *    is silently ignored by a raw fetch or the Node SDK.
 *  - thinking must be **off**: with it on, `max_tokens` covers reasoning *and*
 *    tool arguments, and responses come back empty with
 *    `finish_reason: "length"`.
 *  - set `temperature` **or** `top_p`, never both.
 */

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export type Tier = {
  tier: number;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Nemotron-specific knobs are skipped for other providers. */
  nemotron: boolean;
};

export type ToolSpec = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'tool'; content: string; tool_call_id: string };

export type ToolCall = { id: string; function: { name: string; arguments: string } };

export type Completion = {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
      reasoning_content?: string | null;
    };
  }[];
};

/**
 * Tiers, in order.
 *
 * Tier 1 is Nemotron unless `AGENT_BASE_URL` overrides it, which is the hook
 * for trying another provider before committing. Tiers 2 and 3 are optional
 * failovers; an unset key simply removes that tier rather than failing.
 */
export function tiersFromEnv(env: NodeJS.ProcessEnv = process.env): Tier[] {
  const tiers: Tier[] = [];

  const primaryKey = env.AGENT_API_KEY ?? env.NVIDIA_API_KEY ?? '';
  const primaryBase = env.AGENT_BASE_URL ?? NVIDIA_BASE_URL;
  const primaryModel = env.AGENT_MODEL ?? 'nvidia/nemotron-3.5-bolt-e4b';

  tiers.push({
    tier: 1,
    label: env.AGENT_BASE_URL ? 'primary (override)' : 'nemotron',
    baseUrl: primaryBase,
    model: primaryModel,
    apiKey: primaryKey,
    nemotron: primaryBase === NVIDIA_BASE_URL,
  });

  // Nemotron's own lightweight sibling, same endpoint and key.
  if (!env.AGENT_BASE_URL && primaryKey) {
    tiers.push({
      tier: 2,
      label: 'nemotron-lightning',
      baseUrl: NVIDIA_BASE_URL,
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      apiKey: primaryKey,
      nemotron: true,
    });
  }

  // A different provider entirely, used only after Nemotron errors.
  if (env.FALLBACK_LLM_API_KEY && env.FALLBACK_LLM_BASE_URL) {
    tiers.push({
      tier: tiers.length + 1,
      label: `fallback (${env.FALLBACK_LLM_MODEL ?? 'unknown'})`,
      baseUrl: env.FALLBACK_LLM_BASE_URL,
      model: env.FALLBACK_LLM_MODEL ?? 'gpt-4o-mini',
      apiKey: env.FALLBACK_LLM_API_KEY,
      nemotron: false,
    });
  }

  return tiers.filter(tier => tier.apiKey !== '' || tier.baseUrl.includes('127.0.0.1') || tier.baseUrl.includes('localhost'));
}

/** 429 = rate limit, 402 = quota; both mean "try the next tier". */
export function shouldFailover(status: number): boolean {
  return status === 429 || status === 402 || status >= 500;
}

export type CallResult =
  | { ok: true; completion: Completion; tier: Tier }
  | { ok: false; status?: number; error: string; tier: Tier };

/** One forced tool call against one tier. */
export async function callTier(
  tier: Tier,
  request: {
    messages: ChatMessage[];
    tools?: ToolSpec[];
    /** Force this exact tool — no model discretion (07 Agent Spec). */
    forceTool?: string;
    maxTokens?: number;
  }
): Promise<CallResult> {
  const body: Record<string, unknown> = {
    model: tier.model,
    messages: request.messages,
    temperature: 0.1,
    max_tokens: request.maxTokens ?? 2048,
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    body.parallel_tool_calls = false;
    if (request.forceTool) {
      body.tool_choice = { type: 'function', function: { name: request.forceTool } };
    }
  }

  if (tier.nemotron) {
    // Top level, not inside extra_body. See the file header.
    body.chat_template_kwargs = { enable_thinking: false };
  }

  try {
    const response = await fetch(`${tier.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(tier.apiKey ? { authorization: `Bearer ${tier.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.AGENT_TIMEOUT_MS ?? 20000)),
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, status: response.status, error: text.slice(0, 300), tier };
    }
    return { ok: true, completion: (await response.json()) as Completion, tier };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      tier,
    };
  }
}

/** The first tool call in a completion, or null. */
export function toolCallOf(completion: Completion): ToolCall | null {
  return completion.choices?.[0]?.message?.tool_calls?.[0] ?? null;
}

export function textOf(completion: Completion): string {
  return completion.choices?.[0]?.message?.content ?? '';
}

export function reasoningOf(completion: Completion): string | null {
  return completion.choices?.[0]?.message?.reasoning_content ?? null;
}

export function finishReasonOf(completion: Completion): string {
  return completion.choices?.[0]?.finish_reason ?? '';
}
