/**
 * The provider layer.
 *
 * Gemini is the only decision-maker (07 Agent Spec#Model configuration). It is
 * reached through the **Interactions API** of `@google/genai`, whose request and
 * response shapes are nothing like OpenAI's — so this file holds two adapters
 * behind one normalised result, rather than one request builder with flags.
 *
 * The normalised result is the whole point: `tasks.ts`, `validate.ts`,
 * `context.ts` and `fallbacks.ts` never learn which provider answered, so the
 * four validation gates and the retry policy cannot drift apart per provider.
 *
 * Shape notes that cost real time, and are not in the spec:
 *
 *  - **`interactions.create` ignores retry configuration passed to the
 *    constructor.** Neither `new GoogleGenAI({ retries })` nor
 *    `httpOptions.retryOptions` reaches it; it silently makes *five* attempts
 *    with backoff on a 429 or 5xx. On a free-tier rate limit that turns one
 *    failover into half a minute of waiting, and our own failover never gets a
 *    chance. Retries must be disabled **per request**, which does work:
 *    `create(params, { retries: { strategy: 'none' }, timeout_ms })`.
 *  - `timeout_ms` is also per request, and raises
 *    `APIConnectionTimeoutError` with no `status`.
 *  - A rejected call throws a named error (`RateLimitError`,
 *    `APIConnectionTimeoutError`, …) carrying `.status`, rather than returning
 *    a response — so HTTP status has to be read off the exception.
 *  - The SDK POSTs the request body **verbatim** to `{baseUrl}/v1/interactions`,
 *    which is what lets `GEMINI_BASE_URL` point at the bundled mock and
 *    exercise this adapter with no key.
 */
import { GoogleGenAI } from '@google/genai';

export const OPENAI_FALLBACK_MODEL = 'gpt-4o-mini';

/** 07 Agent Spec: primary is flash at low thinking, fallback is lite. */
export const GEMINI_PRIMARY_MODEL = 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

export type ProviderId = 'gemini' | 'openai';

/** `minimal` | `low` | `medium` | `high`, per the Interactions API. */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/**
 * The canonical tool declaration — deliberately **Gemini's** flat shape, since
 * Gemini is the primary. The OpenAI adapter nests it at call time.
 */
export type ToolSpec = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type Tier = {
  tier: number;
  label: string;
  provider: ProviderId;
  model: string;
  apiKey: string;
  /**
   * Gemini: empty for the real API, or a mock origin (no path). OpenAI: the
   * full `/v1` base.
   */
  baseUrl: string;
  /** Gemini only. Lower is faster and cheaper; never raise it to fix output. */
  thinkingLevel: ThinkingLevel;
};

/**
 * One model answer, in terms every task understands.
 *
 * `toolCall.arguments` is **already parsed** for both providers. Gemini hands
 * back an object; the OpenAI adapter does the `JSON.parse` so that a malformed
 * argument string is a provider concern and not every task's concern.
 */
export type NormalisedResult = {
  /**
   * `completed` — a text answer.
   * `requires_action` — a function call came back (the Gemini name, and what we
   *   actually want for every task that forces a tool).
   * `incomplete` — ran out of output budget; text or arguments are truncated.
   * `failed` — the provider gave up.
   */
  status: 'completed' | 'requires_action' | 'incomplete' | 'failed' | 'unknown';
  /** The provider's own status word, for the failure message. */
  rawStatus: string;
  toolCall: { id: string; name: string; arguments: unknown } | null;
  text: string;
  /**
   * Set when an OpenAI-compatible provider leaked chain-of-thought into the
   * answer, which means thinking is on and the token budget is being spent on
   * it. Gemini's thought steps are expected and are **not** reported here.
   */
  reasoning: string | null;
};

export type CallRequest = {
  /** The system prompt. Gemini: `system_instruction`; OpenAI: a system turn. */
  system: string;
  /** Everything else, as one block of text. */
  input: string;
  tools?: ToolSpec[];
  /** Force this exact tool — no model discretion (07 Agent Spec). */
  forceTool?: string;
  /**
   * Gemini counts thinking tokens against this, so a small value ends the
   * interaction `incomplete` with empty output. Left unset by default on
   * purpose; lower `thinkingLevel` instead.
   */
  maxTokens?: number;
};

export type CallResult =
  | { ok: true; result: NormalisedResult; tier: Tier }
  | {
      ok: false;
      status?: number;
      error: string;
      tier: Tier;
      /** True when another tier is worth trying rather than a retry here. */
      retryable: boolean;
    };

export function timeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.AGENT_TIMEOUT_MS ?? 20000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
}

/**
 * Tiers, in order: primary model, then fallback model, then any
 * OpenAI-compatible provider configured as a last resort.
 *
 * Provider selection, in priority order:
 *   1. `AGENT_PROVIDER` — explicit.
 *   2. `AGENT_BASE_URL` set — the OpenAI-compatible escape hatch, kept so any
 *      endpoint can be tried without touching code.
 *   3. Gemini.
 */
export function tiersFromEnv(env: NodeJS.ProcessEnv = process.env): Tier[] {
  const provider: ProviderId =
    env.AGENT_PROVIDER === 'openai'
      ? 'openai'
      : env.AGENT_PROVIDER === 'gemini'
        ? 'gemini'
        : env.AGENT_BASE_URL
          ? 'openai'
          : 'gemini';

  const tiers: Tier[] =
    provider === 'gemini' ? geminiTiers(env) : openaiPrimaryTiers(env);

  // A different provider entirely, used only after the primary chain errors.
  if (env.FALLBACK_LLM_BASE_URL && (env.FALLBACK_LLM_API_KEY || isLocal(env.FALLBACK_LLM_BASE_URL))) {
    tiers.push({
      tier: tiers.length + 1,
      label: `fallback (${env.FALLBACK_LLM_MODEL ?? OPENAI_FALLBACK_MODEL})`,
      provider: 'openai',
      model: env.FALLBACK_LLM_MODEL ?? OPENAI_FALLBACK_MODEL,
      apiKey: env.FALLBACK_LLM_API_KEY ?? '',
      baseUrl: env.FALLBACK_LLM_BASE_URL,
      thinkingLevel: 'minimal',
    });
  }

  // A tier with no key is no tier — except against a local mock, which is what
  // makes the whole path runnable with no key at all.
  return tiers
    .filter(tier => tier.apiKey !== '' || isLocal(tier.baseUrl))
    .map((tier, index) => ({ ...tier, tier: index + 1 }));
}

function geminiTiers(env: NodeJS.ProcessEnv): Tier[] {
  const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? '';
  // An origin, not a path: the SDK appends `/v1/interactions` itself.
  const baseUrl = env.GEMINI_BASE_URL ?? '';

  return [
    {
      tier: 1,
      label: 'gemini-flash',
      provider: 'gemini',
      model: env.GEMINI_MODEL ?? GEMINI_PRIMARY_MODEL,
      apiKey,
      baseUrl,
      thinkingLevel: thinkingLevelFrom(env.GEMINI_THINKING_LEVEL) ?? 'low',
    },
    {
      tier: 2,
      label: 'gemini-flash-lite',
      provider: 'gemini',
      model: env.GEMINI_FALLBACK_MODEL ?? GEMINI_FALLBACK_MODEL,
      apiKey,
      baseUrl,
      // Already the model's default; stated so a change to tier 1 cannot
      // silently raise the fallback's cost.
      thinkingLevel: 'minimal',
    },
  ];
}

function openaiPrimaryTiers(env: NodeJS.ProcessEnv): Tier[] {
  return [
    {
      tier: 1,
      label: 'openai-compatible',
      provider: 'openai',
      model: env.AGENT_MODEL ?? OPENAI_FALLBACK_MODEL,
      apiKey: env.AGENT_API_KEY ?? '',
      baseUrl: env.AGENT_BASE_URL ?? 'https://api.openai.com/v1',
      thinkingLevel: 'minimal',
    },
  ];
}

function thinkingLevelFrom(value: string | undefined): ThinkingLevel | null {
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'
    ? value
    : null;
}

function isLocal(url: string | undefined): boolean {
  return !!url && (url.includes('127.0.0.1') || url.includes('localhost'));
}

/** 429 = rate limit, 402 = quota, 5xx = theirs; all mean "try the next tier". */
export function shouldFailover(status: number): boolean {
  return status === 429 || status === 402 || status >= 500;
}

/** One call against one tier, normalised. */
export async function callTier(tier: Tier, request: CallRequest): Promise<CallResult> {
  return tier.provider === 'gemini' ? callGemini(tier, request) : callOpenAI(tier, request);
}

// ======================================================================
// Gemini — the Interactions API
// ======================================================================

/**
 * One client per tier, kept because constructing it parses options and builds
 * an auth chain; the per-request options are where everything variable lives.
 */
const geminiClients = new Map<string, GoogleGenAI>();

function geminiClient(tier: Tier): GoogleGenAI {
  const cacheKey = `${tier.baseUrl}|${tier.apiKey}`;
  const cached = geminiClients.get(cacheKey);
  if (cached) return cached;

  const client = new GoogleGenAI({
    // `new GoogleGenAI({})` reads GEMINI_API_KEY itself, but passing it keeps
    // the tier the single source of truth. The placeholder is only ever used
    // against a local mock, which does not check it.
    apiKey: tier.apiKey || 'mock-key',
    ...(tier.baseUrl ? { httpOptions: { baseUrl: tier.baseUrl } } : {}),
  });
  geminiClients.set(cacheKey, client);
  return client;
}

/** The minimum of the response we rely on, so a schema change is visible here. */
type InteractionLike = {
  status?: string;
  output_text?: string;
  steps?: { type?: string; id?: string; name?: string; arguments?: unknown }[];
  errors?: { message?: string }[];
};

async function callGemini(tier: Tier, request: CallRequest): Promise<CallResult> {
  const params: Record<string, unknown> = {
    model: tier.model,
    // Every job is one self-contained call; SpacetimeDB is the source of truth
    // and the context builder supplies history (07 Agent Spec).
    store: false,
    input: request.input,
    system_instruction: request.system,
  };

  const generationConfig: Record<string, unknown> = { thinking_level: tier.thinkingLevel };

  if (request.tools && request.tools.length > 0) {
    params.tools = request.tools.map(tool => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
    if (request.forceTool) {
      generationConfig.tool_choice = {
        allowed_tools: { mode: 'any', tools: [request.forceTool] },
      };
    }
  }

  // Only when a task explicitly asks. See CallRequest.maxTokens.
  if (request.maxTokens !== undefined) generationConfig.max_output_tokens = request.maxTokens;

  params.generation_config = generationConfig;

  try {
    const interaction = (await geminiClient(tier).interactions.create(params as never, {
      // Per request, because the constructor's retry settings are ignored here.
      // See the file header.
      retries: { strategy: 'none' },
      timeout_ms: timeoutMs(),
    })) as unknown as InteractionLike;

    return { ok: true, result: normaliseInteraction(interaction), tier };
  } catch (error) {
    const status = statusOf(error);
    return {
      ok: false,
      status,
      error: messageOf(error),
      tier,
      retryable: status === undefined || shouldFailover(status),
    };
  }
}

export function normaliseInteraction(interaction: InteractionLike): NormalisedResult {
  const raw = interaction.status ?? 'unknown';

  const call = (interaction.steps ?? []).find(step => step.type === 'function_call');
  const toolCall =
    call && typeof call.name === 'string'
      ? { id: call.id ?? '', name: call.name, arguments: call.arguments ?? {} }
      : null;

  return {
    status: mapInteractionStatus(raw),
    rawStatus: raw,
    toolCall,
    text: interaction.output_text ?? '',
    // Gemini's thinking is configured, not leaked; thought steps are expected
    // and must not be reported as a failure.
    reasoning: null,
  };
}

function mapInteractionStatus(raw: string): NormalisedResult['status'] {
  switch (raw) {
    case 'completed':
      return 'completed';
    case 'requires_action':
      return 'requires_action';
    case 'incomplete':
      // 07 Agent Spec: the output budget was hit; text or arguments are
      // truncated. Treated as a failure, never as a usable answer.
      return 'incomplete';
    case 'failed':
    case 'cancelled':
    case 'budget_exceeded':
      return 'failed';
    default:
      // `in_progress`, `queued`, `requires_continuation` — we never ask for
      // streaming or background work, so seeing one means an assumption broke.
      return 'unknown';
  }
}

/** The HTTP status off a thrown SDK error, if it carried one. */
function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * A usable message out of a thrown SDK error.
 *
 * `error.message` alone is useless for diagnosis: a rejected key arrives as
 * `400 API error occurred: {"httpMeta":{"response":{},"request":{}}}`, with
 * Google's actual explanation ("API key not valid") only in `error.body`. That
 * cost a confusing debugging session, so the body is pulled out here once
 * rather than in each caller.
 */
function messageOf(error: unknown): string {
  const base = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const detail = googleErrorMessage((error as { body?: unknown })?.body);
  return (detail ? `${base.split(':')[0]}: ${detail}` : base).slice(0, 300);
}

/** The `error.message` buried in Google's error envelope, if there is one. */
function googleErrorMessage(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    // The body is sometimes an array of envelopes rather than one object.
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const message = (first as { error?: { message?: unknown } })?.error?.message;
    return typeof message === 'string' ? message : null;
  } catch {
    return null;
  }
}

// ======================================================================
// OpenAI-compatible — the secondary path
// ======================================================================

type Completion = {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
      reasoning_content?: string | null;
    };
  }[];
};

async function callOpenAI(tier: Tier, request: CallRequest): Promise<CallResult> {
  const body: Record<string, unknown> = {
    model: tier.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.input },
    ],
    temperature: 0.1,
    max_tokens: request.maxTokens ?? 2048,
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    body.parallel_tool_calls = false;
    if (request.forceTool) {
      body.tool_choice = { type: 'function', function: { name: request.forceTool } };
    }
  }

  try {
    const response = await fetch(`${tier.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(tier.apiKey ? { authorization: `Bearer ${tier.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs()),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        status: response.status,
        error: text.slice(0, 300),
        tier,
        retryable: shouldFailover(response.status),
      };
    }
    return {
      ok: true,
      result: normaliseCompletion((await response.json()) as Completion),
      tier,
    };
  } catch (error) {
    // A transport failure, not a status — nothing here to correct, so the next
    // tier is the only useful move.
    return { ok: false, error: messageOf(error), tier, retryable: true };
  }
}

export function normaliseCompletion(completion: Completion): NormalisedResult {
  const choice = completion.choices?.[0];
  const message = choice?.message;
  const finish = choice?.finish_reason ?? '';

  const raw = message?.tool_calls?.[0];
  let toolCall: NormalisedResult['toolCall'] = null;
  // An unparsable argument string is this layer's problem, not every task's:
  // it is reported as no tool call plus a `failed` status, which `tasks.ts`
  // already knows how to correct.
  let argumentsBroken = false;
  if (raw?.function?.name) {
    try {
      toolCall = {
        id: raw.id ?? '',
        name: raw.function.name,
        arguments: JSON.parse(raw.function.arguments ?? '{}') as unknown,
      };
    } catch {
      argumentsBroken = true;
    }
  }

  const status: NormalisedResult['status'] = argumentsBroken
    ? 'failed'
    : // The OpenAI spelling of Gemini's `incomplete`.
      finish === 'length'
      ? 'incomplete'
      : toolCall
        ? 'requires_action'
        : 'completed';

  return {
    status,
    rawStatus: argumentsBroken ? 'unparsable tool arguments' : finish || 'stop',
    toolCall,
    text: message?.content ?? '',
    reasoning: message?.reasoning_content ?? null,
  };
}
