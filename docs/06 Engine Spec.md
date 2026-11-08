---
tags: [branches, spec, engine]
---
# 06 Engine Spec

`packages/engine` is pure TypeScript with no I/O. The SpacetimeDB module calls it inside reducers; verification scripts call it directly. Rules from [[02 Ground Rules]] apply: deterministic, no randomness, no wall-clock time, stable ordering, dollars as floats internally, rounded to cents only at output.

> [!important] Golden values
> The expected values in this spec were computed by a reference implementation of exactly the semantics written here. If your output differs, **re-read the semantics before changing anything**. If you believe the spec is wrong, report it in the Build Log; don't "fix" the expected numbers.

## Assumptions
| Assumption | Default | Notes |
|---|---|---|
| Savings rate | **4.00%** nominal annual, compounded monthly (`r = rate / 12`) | An *assumed* rate, not a PNC rate. OPEN(OD-7) |
| Inflation | **2.70%** annual | Applied to goal costs only |
| Loan rate | **6.25%** (mortgage), **7.00%** (car) | Used by templates that create loans |
| Emergency floor | **3 × (fixed + debt payments)** per month, computed from the pre-event baseline | |
| Window | **120 months** (plan months 0–119) | Month 0 = current month |

All assumptions are editable per household and appear in every "show the math."

## Formulas
| # | Formula | Golden input → expected |
|---|---|---|
| F1 | Savings, no interest: `PMT = FV / n` | FV 12,000, n 24 → **500.00** |
| F2 | Sinking fund: `PMT = FV · r / ((1+r)^n − 1)` | FV 20,000, n 36, 4% → **523.81** |
| F3 | Future value of series: `FV = PV(1+r)^n + PMT((1+r)^n − 1)/r` | PV 5,000, PMT 300, n 60, 4% → **25,994.68** |
| F4 | Loan payment: `M = P · r(1+r)^n / ((1+r)^n − 1)` | P 350,000, n 360, 6.25% → **2,155.01** |
| F5 | Inflation: `C_t = C_0 (1+i)^(months/12)` | C₀ 5,000, 60 months, 2.7% → **5,712.45** |

If `r = 0`, F2 becomes F1 and F4 becomes `P / n`.

## Monthly simulation
The single source of truth for every projection, impact, lever, and branch.

**Inputs:** baseline, goals, assumptions, active events, levers, starting liquid savings.

**Goal setup:** each goal has `T` = target month (1–120) and `C` = inflated cost = `costToday × (1 − shrinkPct/100) × (1+i)^(T/12)`. Contributions happen at the end of months `0 … T−1` (T deposits). The goal settles at the end of month `T−1`. Goals start with a balance of 0 (OPEN(OD-15): existing earmarked savings).

**Allocation order (stable):** must-have goals first, then flexible; within each, by `T` ascending; then by goal id ascending.

**Each month `m` (0–119):**
1. **Surplus** = Σ members' take-home income − fixed − debt payments − (flexible − saveMore) − Σ fun money − retirement − event recurring costs. Event changes apply only in the months the event specifies. Surplus may be negative.
2. **Available** = max(0, surplus).
3. **For each unsettled goal, in allocation order:**
   - `balance = balance × (1+r)`
   - `k = T − m` (deposits remaining, including this one)
   - `required = max(0, (C − balance·(1+r)^(k−1)) · r / ((1+r)^k − 1))`
   - `pay = min(required, available)`; `available −= pay`; `balance += pay`
   - The goal is **underfunded this month** if `pay < required − 0.005`.
   - If `m = T − 1`, settle: if `balance ≥ C − 0.005` the goal is **funded** and `excess = balance − C` goes to the emergency fund this month; otherwise the goal is **at risk** with `shortfall = C − balance`. Either way the goal's balance is spent.
4. **Emergency fund** = `emergency × (1+r) + (surplus ≥ 0 ? available : surplus) − one-time costs + excess`.
5. The month is **tight** if `emergency < floor − 0.005` or any goal was underfunded.

Recomputing `required` every month means missed payments are caught up automatically when money is available.

**Event costs and income changes are in today's dollars and are not inflated.**

## Outputs
| Output | Definition |
|---|---|
| `goals[]` | id, inflatedCost, requiredMonthlyAtStart (`required` at m=0), funded, shortfall, settleMonth |
| `atRiskGoalIds` | goals with shortfall > 0.005, in allocation order |
| `tightMonths` | sorted month indexes |
| `tightYears` | sorted 1-based plan years containing a tight month (months 0–11 = year 1) |
| `freeToPlan` | surplus at month 0 − Σ requiredMonthlyAtStart (may be negative) |
| `emergencyMonthsNow` | starting emergency ÷ (fixed + debt) |
| `emergencyMonthsMin` | lowest end-of-month emergency ÷ (fixed + debt), and the month it occurs |
| `goalsOnTrack` | count of funded goals / total |
| `series` | end-of-year emergency fund and goal balances (for the chart; monthly available if needed) |
| `provenance` | for every displayed number: formula id, inputs, assumptions (powers "show the math") |

**Card stats / health indicators** (used on Home and on every branch card): free to plan per month, emergency-fund months (min), tight years, goals on track, plus each goal's date change versus the current plan.

## Baseline inference
Deterministic rules over mock transactions (no LLM). See [[11 Mock Data]] for the counterparty registry and expected results.
1. Group transactions by (owner, counterparty).
2. A group is **recurring** if it has ≥ 3 occurrences across ≥ 3 distinct months and every amount is within ±5% of the group's median.
3. Monthly amount = group total over the window ÷ 12, rounded to cents.
4. Kind from counterparty type: `employer → income`; `landlord, utility, insurer, telecom, subscription → fixed`; `lender → debt`; `brokerage → retirement` (plus a gap question: retirement or investing? + balance range); non-recurring `merchant` outflows → summed into one `flexible` item.
5. Output items sorted by owner, then kind (`income, fixed, debt, retirement, flexible`), then label.

## Life event templates
All values are **placeholders** (OPEN(OD-2)). Parameters marked *asked* come from the agent's follow-up questions or the event form.

| Template | Parameters | Effects |
|---|---|---|
| `baby` | monthsUntilBirth (default 9), leaveMember, leaveMonths (*asked*, 0–6, default 2), care (*asked*: `daycare`/`home`) | One-time $3,000 at birth month; +$800/mo from birth month onward; leaveMember income = 0 for leaveMonths starting at birth; if `daycare`, +$1,200/mo starting after leave; if `home`, leaveMember income = 0 from birth onward (no childcare cost) |
| `job_loss` | member, monthsWithoutIncome (*asked*, default 4), startMonth (default 0) | Member income = 0 for those months |
| `medical_bill` | amount (*asked*), month (default 0) | One-time cost |
| `car_replacement` | price (*asked*), downPaymentPct (default 20), month (default 0) | One-time down payment; loan payment (F4, 60 months, car rate) for 60 months |
| `raise` | member, monthlyIncrease (*asked*), startMonth (default 0) | Member income + increase from startMonth |
| `windfall` | amount (*asked*), month (default 0) | One-time negative cost (adds to emergency fund) |

## Impact
`computeImpact(event)` = simulation with the event versus without. Output: newly at-risk goals (with shortfalls), tight months/years before and after, emergency-fund months before/after/min, freeToPlan before/after. If nothing becomes at risk, the impact says so (no branches needed; offer "keep plan").

## Levers
| Lever | Domain | Eligible goals |
|---|---|---|
| `delay(goalId, d)` | d = 1–36 months, T + d ≤ 120 | any goal |
| `shrink(goalId, p)` | p = 1–30 (% of today's cost), integer | flexible goals only |
| `saveMore(s)` | s in $25 steps, up to 25% of flexible spending (rounded down to $25) | reduces flexible spending from month 0 |

**Minimal lever search:** for each lever type and each eligible goal (or once for `saveMore`), search values in ascending order and return the first value where `atRiskGoalIds` is empty, with the event and all active constraints applied. Return `null` if no value in range works. Note that a lever on one goal can fix a different goal (delaying the house frees money for Japan).

## Branch candidates
*Version 1 rules — expected to change (OPEN(OD-3)).*
1. **Single-lever fixes:** every non-null minimal lever.
2. **Balanced pairs:** for each single delay fix `delay(g, d)` with d ≥ 2: `delay(g, ⌈d/2⌉)` plus the minimal `saveMore` that then fixes the plan (skip if none).
3. Drop candidates that violate an active lock or pin, or that repeat a lever set already shown in this session.
4. **Order:** goals whose date changes (asc) → total months delayed (asc) → saveMore (asc) → total shrink % (asc) → canonical lever-set string (asc).
5. Keep at most 8. The agent selects and names 3 ([[07 Agent Spec]]). **Fallback without the agent:** take the first 3 in order and name them with templates: delay-only → "Move {Goal} to {Mon YYYY}"; saveMore-only → "Save ${s} more a month"; shrink-only → "Smaller {Goal}"; pairs → "Balanced".

**Constraints:**
- **Lock** (one member, reroll): `goalOnTime(goalId)` (no delay), `goalFullSize(goalId)` (no shrink), `noExtraSaving`, `saveMoreAtMost(s)`.
- **Pin** (one per member, disagreement): same shapes as locks. Bridge branches = candidates honoring all members' pins.
- If fewer than 3 candidates exist, show what exists with the message "These are all the paths that fit what you've locked."

**Closest option (no candidate honors the pins):** report two deterministic statements: (a) the minimal `saveMore` above the normal cap (steps of $25, up to $2,000) that would honor all pins; (b) for each pin that restricts a goal's date, the minimal delay of that goal that would make a candidate possible. If neither exists, say no adjustment within range makes both work.

**Slider tuning:** `tuneLever(branchId, lever, value)` re-runs the simulation and replaces the branch's levers and stats for everyone (source `custom`). Values outside the domain are clamped. A tuned branch may become infeasible; it then shows its at-risk goals instead of blocking.

## Affordability check
`checkAffordability(amount, label)` = simulate a one-time cost at month 0. Report: at-risk goals before/after, emergency-fund months now and minimum (before/after), and, if any goal becomes at risk, the minimal delay for each affected goal and the minimal `saveMore`, so answers can be phrased in time ("pushes Japan back 3 months").

## Golden scenarios
Household numbers are in [[11 Mock Data#Test Household A]]. Goals: **Japan** $5,000, T = 24, flexible; **House** $40,000, T = 60, must-have.

| ID | Scenario | Expected |
|---|---|---|
| E1 | Baseline costs | Japan inflated **5,273.65**; House inflated **45,699.58** |
| E2 | Baseline required monthly at m=0 | Japan **211.43**; House **689.30** |
| E3 | Baseline result | `atRiskGoalIds = []`; `tightMonths = []`; `freeToPlan = 1,899.28` |
| E4 | `medical_bill` $6,000 at month 3 | `atRiskGoalIds = []`; `tightMonths = []` |
| E5 | `baby` (birth month 9, leave member B, 2 months, daycare) | `atRiskGoalIds = ["japan"]`; Japan shortfall **2,183.97**; House funded; `tightMonths = 9–23` |
| E6 | Minimal levers for E5 | `delay(japan)` = **null**; `shrink(japan)` = **null**; `delay(house)` = **18**; `saveMore` = **175** |
| E7 | Balanced pair for E5 | `delay(house, 9)` + `saveMore(75)` fixes the plan |
| E8 | Candidate order for E5 | 1) saveMore 175 · 2) delay house 9 + saveMore 75 · 3) delay house 18 |
| E9 | E5 + each candidate applied | `atRiskGoalIds = []`; `tightMonths = [9, 10]` for all three |
| E10 | Determinism | Running any scenario twice produces byte-identical JSON |
