/**
 * Tool definitions. Each task forces one specific tool
 * (07 Agent Spec#Tasks and tools), never free-form JSON.
 */
export const LIFE_EVENT_TEMPLATE_IDS = [
  'baby',
  'job_loss',
  'medical_bill',
  'car_replacement',
  'raise',
  'windfall',
] as const;

export const classifyLifeEventTool = {
  type: 'function' as const,
  function: {
    name: 'classify_life_event',
    description:
      'Classify what the user said into one life-event template. Only fill params you were explicitly told. Never calculate or invent numbers.',
    parameters: {
      type: 'object',
      properties: {
        templateId: { type: 'string', enum: [...LIFE_EVENT_TEMPLATE_IDS] },
        params: {
          type: 'object',
          description: 'Only parameters whose values the user actually stated.',
          additionalProperties: true,
        },
        followUps: {
          type: 'array',
          description: "Questions for the template's *asked* params that are still unknown.",
          items: {
            type: 'object',
            properties: {
              param: { type: 'string' },
              prompt: { type: 'string' },
              chips: { type: 'array', items: { type: 'string' } },
            },
            required: ['param', 'prompt'],
          },
        },
      },
      required: ['templateId', 'followUps'],
    },
  },
};

/** Force this exact tool — no model discretion (07 Agent Spec). */
export function forceTool(name: string) {
  return { type: 'function' as const, function: { name } };
}

export const SYSTEM_PROMPT = [
  'You are the planning assistant for a couple using Branches, a shared financial planner.',
  'You never calculate. You only use numbers given to you in the data.',
  'You describe projections ("if..., the projection shows..."), never advice.',
  'You are warm and brief. Celebrate good news; be calm about bad news.',
  'You never mention or ask about individual purchases.',
].join(' ');
