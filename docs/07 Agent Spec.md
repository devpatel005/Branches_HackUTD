---
tags: [branches, spec, agent]
---
# 07 Agent Spec

The agent is a Nemotron-powered participant in the household. It **interprets, selects, names, translates, and explains**. It never computes numbers and never changes the plan. Rules: [[02 Ground Rules]].

## Model configuration
*From team research; confirm with a live call in Stage 0.*
| Setting | Value |
|---|---|
| Endpoint | `https://integrate.api.nvidia.com/v1` (OpenAI-compatible) via the OpenAI Node SDK |
| Primary model | `nvidia/nemotron-3.5-bolt-e4b` (66K context; our turns are ~5,500 tokens) |
| Failover 1 | `nvidia/nemotron-3.5-lightning-30b-a3b` (same endpoint) |
| Failover 2 | `gpt-4o-mini` or `gemini-2.5-flash` (only on errors; Nemotron must stay primary for the NVIDIA track) |
| Thinking | **Off** for every structured call: `chat_template_kwargs: { enable_thinking: false }` |
| Temperature | `0.1`; do **not** also set `top_p` |
| max_tokens | `2048` |
| Tool choice | Force the specific tool for each task (`tool_choice: { type: "function", function: { name } }`), `parallel_tool_calls: false` |

> [!warning] Two things to verify with a live call in Stage 0
> 1. The exact model name works.
> 2. **Thinking is actually off.** The research sample passes `chat_template_kwargs` inside an `extra_body` field, which is a Python-SDK convention. In the Node SDK, put `chat_template_kwargs` at the top level of the request body instead, and confirm the response has no `reasoning_content` and a non-empty tool call. If thinking stays on, responses can come back empty with `finish_reason: "length"`.

Gateway rules: strict user/assistant alternation; every assistant message with tool calls must be followed by matching `tool` messages. Handle HTTP 429 (rate limit) and 402 (quota) by moving to the next failover tier.

## Job flow (through SpacetimeDB)
1. App calls `sendMessage` (or a session reducer) → creates `chat_message` + `agent_job` (`queued`).
2. Agent service sees the job, calls `claimJob` (`running`), and posts progress via `setJobProgress` ("Reading your event…", "Building branch 2 of 3…").
3. Agent builds context, calls the model, validates, and writes results through agent-only reducers, then `completeJob`.
4. On failure after all tiers: `failJob` + deterministic fallback (see below), so the user is never stuck.

Jobs are processed one at a time per household, in creation order.

## Tasks and tools
| Job kind | Trigger | Tool the model must call | What happens next |
|---|---|---|---|
| `interpret_event` | User describes something that happened | `classify_life_event { templateId (enum), params (known values only), followUps[] (from the template's *asked* params) }` | Reducer creates `life_event`; follow-ups posted as tap-able chips. When answered, engine computes impact |
| `select_branches` | Candidates generated (new, reroll, bridge) | `select_branches { picks: [ { candidateId, name, summary } ×3 ] }` | `nameBranches` writes the 3 branches; must be 3 distinct, existing candidate ids |
| `translate_feedback` | User types what they want in a session ("don't delay the house, cut eating out") | `set_constraints { locks[], saveMoreAtMost?, excludeCandidateIds[] }` using the constraint shapes in [[06 Engine Spec#Branch candidates]] | Constraints saved; engine rerolls |
| `affordability` | "Can we afford X?" | `check_affordability { amount, label }` | Engine runs the check; agent explains the result |
| `explain` | Any engine result needing a sentence | none (text only), but validated | Posted as a chat message |
| `general_chat` | Anything else | none | Short reply; steer back to planning; no numbers unless from the provided engine data |

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

On rejection: retry once on the same tier with the validation error appended, then move to the next tier.

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
