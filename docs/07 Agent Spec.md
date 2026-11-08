---
tags: [branches, spec, agent]
---
---

## tags: [branches, spec, agent]

# 07 Agent Spec

The agent is a Gemini-powered participant in the household. It **interprets, selects, names, translates, and explains**. It never computes numbers and never changes the plan. Rules: [[02 Ground Rules]].

## Model configuration

_From Google's Gemini API docs (Interactions API, Nov 2026); confirm with a live call in Stage 0._

|Setting|Value|
|---|---|
|SDK|`@google/genai` (`npm install @google/genai`). **Never** the deprecated `@google/generative-ai` package|
|API|**Interactions API**: `ai.interactions.create({...})`. Google calls `generateContent` legacy; don't use it|
|Auth|`GEMINI_API_KEY` environment variable, read automatically by `new GoogleGenAI({})`. Agent service only; never in the app|
|Primary model|`gemini-3.8-flash` with `generation_config: { thinking_level: "low" }` (default is medium; low is faster)|
|Fallback model|`gemini-3.5-flash-lite` (defaults to minimal thinking; fastest)|
|Forcing a tool|`generation_config: { tool_choice: { allowed_tools: { mode: "any", tools: ["<tool_name>"] } } }`|
|Tool declaration|`tools: [{ type: "function", name, description, parameters: <JSON Schema> }]`|
|JSON without a tool|`response_format: { type: "text", mime_type: "application/json", schema: <JSON Schema> }` (works with Zod)|
|State|`store: false`. Every job is **one self-contained call**; the context builder supplies recent chat history. SpacetimeDB stays the single source of truth|
|Output limit|Don't set a small `max_output_tokens`: it includes thinking tokens, and hitting it ends the interaction with status `incomplete` and truncated or empty output. Lower `thinking_level` instead|

**Reading the response**

- `interaction.status`: `completed`, `requires_action` (the model returned a function call), `incomplete`, or `failed`. Treat `incomplete` and `failed` as failures.
- Function calls arrive in `interaction.steps` as steps with `type === "function_call"`, plus `name`, `arguments` (already-parsed object), and `id`.
- Plain text: `interaction.output_text`.
- We **don't** send `function_result` back for our task tools: the tool arguments _are_ the output. The agent service validates them and writes results through SpacetimeDB reducers.

**Example (shape only):**

```ts
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({}); // reads GEMINI_API_KEY

const interaction = await ai.interactions.create({
  model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
  store: false,
  input: contextText, // built by the context builder
  tools: [selectBranchesTool],
  generation_config: {
    thinking_level: "low",
    tool_choice: { allowed_tools: { mode: "any", tools: ["select_branches"] } },
  },
});
const call = interaction.steps.find((s) => s.type === "function_call");
// → Zod-validate call.arguments, then run the checks in "Validation"
```

**Free tier notes**

- Rate limits apply **per Google Cloud project**, not per key, and differ by model; AI Studio shows the active limits. Give each developer their own project/key during development and keep a separate project for the demo so testing can't exhaust it.
- Google requires account or project verification by phone to use the free tier.
- Free-tier content may be used by Google to improve its products. We only send mock data, and the context builder never sends private purchases.

**Failover chain:** primary model → (on validation failure) one retry with the error appended → fallback model → deterministic fallback. On HTTP 429 (rate limit) or a 5xx error, skip straight to the fallback model.

## Job flow (through SpacetimeDB)

1. App calls `sendMessage` (or a session reducer) → creates `chat_message` + `agent_job` (`queued`).
2. Agent service sees the job, calls `claimJob` (`running`), and posts progress via `setJobProgress` ("Reading your event…", "Building branch 2 of 3…").
3. Agent builds context, calls the model, validates, and writes results through agent-only reducers, then `completeJob`.
4. On failure after all tiers: `failJob` + deterministic fallback (see below), so the user is never stuck.

Jobs are processed one at a time per household, in creation order.

## Tasks and tools

|Job kind|Trigger|Tool the model must call|What happens next|
|---|---|---|---|
|`interpret_event`|User describes something that happened|`classify_life_event { templateId (enum), params (known values only), followUps[] (from the template's *asked* params) }`|Reducer creates `life_event`; follow-ups posted as tap-able chips. When answered, engine computes impact|
|`select_branches`|Candidates generated (new, reroll, bridge)|`select_branches { picks: [ { candidateId, name, summary } ×3 ] }`|`nameBranches` writes the 3 branches; must be 3 distinct, existing candidate ids|
|`translate_feedback`|User types what they want in a session ("don't delay the house, cut eating out")|`set_constraints { locks[], saveMoreAtMost?, excludeCandidateIds[] }` using the constraint shapes in [[06 Engine Spec#Branch candidates]]|Constraints saved; engine rerolls|
|`affordability`|"Can we afford X?"|`check_affordability { amount, label }`|Engine runs the check; agent explains the result|
|`explain`|Any engine result needing a sentence|none (text only), but validated|Posted as a chat message|
|`general_chat`|Anything else|none|Short reply; steer back to planning; no numbers unless from the provided engine data|

Branch names: short, warm, plain ("Protect the House", "Japan First", "Balanced"). Summaries: one or two sentences, projection language only.

## Context builder

**One function** builds every prompt's context, from an allowlist:

- Household: member display names and colors.
- Baseline totals: income per member, fixed, debt, flexible, retirement set-aside, fun-money **amounts only**, emergency fund.
- Goals: title, cost today, target month/date, priority, funded/at-risk.
- Current engine output relevant to the task (impact, candidates with stats, affordability result).
- Active constraints and the last ~8 chat messages of the session.

**Never included:** transactions, counterparties, inferred-item details, fun-money status history, anything from the device-local private purchases store. Log every final prompt in development so verification can grep it ([[12 Verification#V5 Agent contract]]).

## Validation

Every model response passes all checks or is rejected:

1. **Schema:** Zod-validate tool arguments (enums, required fields, 3 distinct candidate ids that exist).
2. **Numbers whitelist:** extract every number in names/summaries/messages (regex for amounts, percents, years, month counts); each must equal a number present in the engine data provided in that request (normalize `$`, commas, `.00`). Dates must match engine dates.
3. **Language:** reject "should", "recommend", "best option", "advice" (case-insensitive) in agent text.
4. **Length:** names ≤ 30 characters; summaries ≤ 200 characters.

On rejection: follow the failover chain in [[07 Agent Spec#Model configuration]].

## Deterministic fallbacks (agent unavailable)

- `interpret_event` → the app shows the event form (template picker + parameter fields).
- `select_branches` → engine fallback picks and template names ([[06 Engine Spec]]).
- `translate_feedback` → lock/pin chips in the UI do the same job.
- `affordability` / `explain` → template sentences filled with engine numbers.

The demo must work end to end with the agent turned off.

## System prompt essentials

- You are the planning assistant for a couple using Branches.
- You never calculate. You only use numbers given to you in the data.
- You describe projections ("if…, the projection shows…"), never advice.
- You are warm and brief. Celebrate good news; be calm about bad news.
- You never mention or ask about individual purchases.