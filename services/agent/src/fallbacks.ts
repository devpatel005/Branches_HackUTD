/**
 * Deterministic fallbacks — 07 Agent Spec#Deterministic fallbacks.
 *
 * Every task has a path that needs no model at all, because the demo must work
 * end to end with the agent turned off. These are not error handling bolted on;
 * they are the behaviour the app already had in Stages 4 and 5, which the agent
 * sits on top of.
 */

export type FallbackPlan = {
  /** What the user is told, in template language with no invented numbers. */
  message: string;
  /** Whether the app should fall back to a form instead of waiting. */
  showForm?: boolean;
};

export function fallbackFor(kind: string): FallbackPlan {
  switch (kind) {
    case 'interpret_event':
      return {
        message:
          "I couldn't read that just now. Tap \"Something came up\" and pick what happened — the projection works exactly the same either way.",
        showForm: true,
      };
    case 'select_branches':
      // The engine already named the branches with templates when it generated
      // them, so there is literally nothing to repair here.
      return { message: 'Showing the paths the engine found.' };
    case 'translate_feedback':
      return {
        message:
          "I couldn't turn that into a change. You can lock an effect or pin what matters most using the chips on each card.",
        showForm: true,
      };
    case 'affordability':
      return {
        message: 'Use "Can we afford…?" and enter the amount — the engine answers it directly.',
        showForm: true,
      };
    default:
      return { message: "I'm not able to answer that right now." };
  }
}
