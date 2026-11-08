/**
 * Nemotron configuration from 07 Agent Spec#Model configuration.
 * Values here are the spec's; Stage 0 confirms them with a live call.
 */
export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/** Tier order: Nemotron must stay primary for the NVIDIA track. */
export const MODEL_TIERS = [
  { tier: 1, model: 'nvidia/nemotron-3.5-bolt-e4b' },
  { tier: 2, model: 'nvidia/nemotron-3.5-lightning-30b-a3b' },
] as const;

export const PRIMARY_MODEL = MODEL_TIERS[0].model;

/**
 * Shared request shape for every structured call.
 *
 * Thinking off matters: with thinking on, max_tokens covers reasoning *and*
 * tool arguments, so responses come back empty with finish_reason "length"
 * (14 Research Notes#Nemotron).
 *
 * The research sample passed chat_template_kwargs inside `extra_body`, which is
 * a Python-SDK convention. In the Node SDK there is no extra_body, so it goes
 * at the TOP LEVEL of the request body. 07 Agent Spec flags this as a Stage 0
 * thing to verify.
 */
export const BASE_REQUEST = {
  temperature: 0.1,
  // Deliberately no top_p: setting both temperature and top_p is a documented
  // Nemotron quirk (14 Research Notes#Nemotron).
  max_tokens: 2048,
  parallel_tool_calls: false,
  chat_template_kwargs: { enable_thinking: false },
} as const;

/** 429 = rate limit, 402 = quota. Both mean "move to the next tier". */
export function shouldFailover(status: number | undefined): boolean {
  return status === 429 || status === 402 || (status !== undefined && status >= 500);
}
