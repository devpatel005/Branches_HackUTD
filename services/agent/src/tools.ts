import type { ToolSpec } from './providers.ts';
import { LIFE_EVENT_TEMPLATE_IDS } from './validate.ts';

/**
 * Tool definitions — 07 Agent Spec#Tasks and tools.
 *
 * Every task forces one specific tool rather than letting the model choose. A
 * model that can only fill in one known shape has far less room to invent.
 *
 * The declaration shape here is Gemini's flat `{ type, name, description,
 * parameters }` — Gemini is the primary, so it is the canonical form, and the
 * OpenAI adapter nests it at call time.
 */

export const classifyLifeEventTool: ToolSpec = {
  type: 'function',
  name: 'classify_life_event',
  description:
    'Classify what the user said into exactly one life-event template. Fill only parameters the user actually stated. Never calculate or estimate a cost — the engine does that.',
  parameters: {
    type: 'object',
    properties: {
      templateId: { type: 'string', enum: [...LIFE_EVENT_TEMPLATE_IDS] },
      params: {
        type: 'object',
        description: 'Only parameters whose values the user explicitly gave.',
        additionalProperties: true,
      },
      followUps: {
        type: 'array',
        description:
          "Questions for the template's asked parameters that are still unknown. Keep them short and give tap-able chips.",
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
};

export const selectBranchesTool: ToolSpec = {
  type: 'function',
  name: 'select_branches',
  description:
    'Choose exactly three of the given candidates and name them. Use only candidateIds from the data. Names are short and warm; summaries describe the projection and never give advice.',
  parameters: {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            candidateId: { type: 'string' },
            name: { type: 'string', description: 'At most 30 characters.' },
            summary: { type: 'string', description: 'One or two sentences, at most 200 characters.' },
          },
          required: ['candidateId', 'name', 'summary'],
        },
      },
    },
    required: ['picks'],
  },
};

export const setConstraintsTool: ToolSpec = {
  type: 'function',
  name: 'set_constraints',
  description:
    "Translate what the couple said into constraints the engine understands. 'Don't delay the house' is goalOnTime; 'we can cut eating out' is saveMoreAtMost or no constraint at all.",
  parameters: {
    type: 'object',
    properties: {
      locks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['goalOnTime', 'goalFullSize', 'noExtraSaving', 'saveMoreAtMost'],
            },
            goalId: { type: 'string', description: 'Required for goalOnTime and goalFullSize.' },
            amount: { type: 'number', description: 'Required for saveMoreAtMost.' },
          },
          required: ['kind'],
        },
      },
      excludeCandidateIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['locks'],
  },
};

export const checkAffordabilityTool: ToolSpec = {
  type: 'function',
  name: 'check_affordability',
  description: 'Extract the amount and a short label from an "can we afford X?" question.',
  parameters: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'In dollars, as the user said it.' },
      label: { type: 'string', description: 'What it is, e.g. "a couch".' },
    },
    required: ['amount', 'label'],
  },
};

/** 07 Agent Spec#System prompt essentials. */
export const SYSTEM_PROMPT = [
  'You are the planning assistant for a couple using Branches, a shared financial planner.',
  'You never calculate. Every number you write must already appear in the data you were given; if a number is not there, do not state one.',
  'You describe projections — "if you push Japan to 2029, the projection shows both goals funded" — and never give advice. Never write "should", "recommend", "best option" or "advice".',
  'You are warm and brief. Celebrate good news; be calm about bad news.',
  'You never mention or ask about individual purchases.',
  'You are not a financial adviser and must not claim to be.',
].join(' ');
