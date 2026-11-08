---
tags: [branches, spec, data]
---
# 11 Mock Data

`packages/mock-data` generates households deterministically (fixed seed, no randomness at runtime beyond a seeded generator). All names are fictional. All data is fake.

Two kinds of profiles:
- **Test Household A**: exact numbers, used by verification. Never change it without updating [[06 Engine Spec#Golden scenarios]] and [[12 Verification]].
- **Demo profiles**: tuned for the stage demo (OPEN(OD-1)).

## Test Household A
**Members:** A and B. **Window:** 12 months of transactions ending the month before plan month 0. **Starting liquid savings:** $15,000.00.

| Kind | Owner | Counterparty (type) | Schedule | Amount |
|---|---|---|---|---|
| income | A | Northwind Corp (employer) | 1st and 15th | +2,500.00 each |
| income | B | Brightline Health (employer) | 1st and 15th | +1,900.00 each |
| fixed | A | Oakridge Apartments (landlord) | 1st | −2,200.00 |
| fixed | A | Shieldway Insurance (insurer) | 5th | −300.00 |
| fixed | A | StreamBox (subscription) | 8th | −20.00 |
| fixed | A | TuneHub (subscription) | 12th | −10.00 |
| fixed | B | Lone Star Energy (utility) | 10th | −250.00 |
| fixed | B | Metro Wireless (telecom) | 18th | −150.00 |
| fixed | B | Cinewave (subscription) | 9th | −30.00 |
| fixed | B | FitCore Gym (subscription) | 3rd | −40.00 |
| debt | A | Lakeside Auto Finance (lender) | 20th | −350.00 |
| debt | B | Summit Loan Servicing (lender) | 22nd | −150.00 |
| retirement | A | Harborview Investments (brokerage) | 16th | −250.00 |
| retirement | B | Harborview Investments (brokerage) | 16th | −150.00 |
| flexible | A | assorted merchants (merchant) | varied, seeded | totals exactly −800.00 per month |
| flexible | B | assorted merchants (merchant) | varied, seeded | totals exactly −700.00 per month |

Merchant transactions must vary enough (beyond ±5%) that **no merchant group is detected as recurring**.

**Onboarding answers for the fixture:** fun money A $300, B $300; both brokerage items answered "retirement."

**Resulting baseline:** income 8,800 (A 5,000 / B 3,800) · fixed 3,000 · debt 500 · flexible 1,500 · fun money 600 · retirement 400 · **monthly surplus 2,800** · emergency floor 10,500.

**Goals (for engine scenarios):** Japan $5,000 at month 24 (flexible); House $40,000 at month 60 (must-have).

### Expected inference output
Sorted by owner, then kind (income, fixed, debt, retirement, flexible), then label:

| Owner | Kind | Label | Monthly |
|---|---|---|---|
| A | income | Northwind Corp | 5,000.00 |
| A | fixed | Oakridge Apartments | 2,200.00 |
| A | fixed | Shieldway Insurance | 300.00 |
| A | fixed | StreamBox | 20.00 |
| A | fixed | TuneHub | 10.00 |
| A | debt | Lakeside Auto Finance | 350.00 |
| A | retirement | Harborview Investments | 250.00 |
| A | flexible | Everyday spending | 800.00 |
| B | income | Brightline Health | 3,800.00 |
| B | fixed | Cinewave | 30.00 |
| B | fixed | FitCore Gym | 40.00 |
| B | fixed | Lone Star Energy | 250.00 |
| B | fixed | Metro Wireless | 150.00 |
| B | debt | Summit Loan Servicing | 150.00 |
| B | retirement | Harborview Investments | 150.00 |
| B | flexible | Everyday spending | 700.00 |

Plus **2 gap questions** (one per brokerage item: retirement or investing? + balance range).

## Private purchases
Each member has a list of fun-money purchases generated on-device from the seed (e.g., "Pixel Arcade $59.99", "Paperleaf Books $24.00"). Rules:
- Stored only in local app storage on the owner's device. **Never written to SpacetimeDB, never sent to the agent.**
- The owner's client computes the month's total and calls `setFunMoneyStatus(within|over)`.
- These merchant names are the "canaries" for the privacy check in [[12 Verification#V5 Agent contract]].

## Demo profiles
Requirements for the stage demo couple (e.g., "Maya & Jordan"):
- Two members with noticeably different habits (one saver, one spender) so the merged baseline is interesting.
- 3–4 goals mixing must-have and flexible (house, Japan trip, car, wedding/other).
- Tuned so the `baby` event puts **two goals** at risk and produces three meaningfully different branches.
- At least one brokerage transfer per member (shows inference + gap question).
- A reset command that reseeds the demo household to its starting state in seconds.

The team will set final numbers after the system works; until then, reuse Test Household A with display names "Maya" and "Jordan."
