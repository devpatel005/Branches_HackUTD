---
tags: [branches, spec, ux]
---
# 03 User Journey

Every feature must appear somewhere in this journey. If it doesn't, it's out of scope.

## Persona
A couple in their late 20s, recently married or engaged, two incomes, separate accounts. One partner handles the money; the other is reluctant. **Design every screen for the reluctant partner:** few taps, no homework, nothing to type that the app could infer.

## 1. Join
1. Partner A opens Branches → **Start a household** → gets a 6-character code.
2. Partner B opens Branches on their own device → **Join a household** → enters the code.
3. Both see each other's avatar appear in real time.

## 2. Onboarding
Each partner onboards **their own side, at the same time**. Each sees the other's progress live ("Jordan: 4 of 5").
1. **Confirm what we found:** cards inferred from transactions (paychecks, rent, bills, loan payments, transfers to brokerages). Tap ✓ or edit. Mostly tapping.
2. **Fill the gaps:** only questions the data can't answer, using ranges where possible (e.g., "About how much is in the account you send $400/month to?": under $10K / $10–50K / $50–100K / $100K+). Retirement money is "set aside, not available for goals"; no balance needed in v1.
3. **Fun money:** set your monthly amount (shared). Your purchases stay private.
4. **Goals (together):** tap goal cards (house, kids, travel, car, wedding, custom), set a rough cost and target year, mark must-have or flexible.

## 3. Home
A big number ("Free to plan: $X/mo"), the 10-year projection line, a few stats, and the goal list. The couple can see at a glance whether the plan works.

## 4. Life happens
Either partner tells the agent in the Chat tab: "We just found out we're pregnant!" The agent asks one or two follow-ups (as tap-able chips), then the engine computes the impact: which goals no longer fit and which years get tight.

## 5. Live planning session
Either partner starts a session; the other gets an in-app banner and joins. Branch cards arrive one by one. They pick, react, tune sliders, lock and reroll, pin non-negotiables if they disagree, and finish with the ready check. Full rules: [[08 Live Session Spec]].

## 6. Everyday questions
"Can we afford a $1,200 couch?" The agent asks the engine and answers in time, not just dollars: which goals move and by how much, or "no goal changes; emergency fund goes from 4.2 to 3.9 months."

## Example session
> **6:40 PM.** Maya (home) types in Chat: "We just found out we're pregnant!" Agent: "Congratulations! Is either of you taking unpaid leave? Daycare or staying home?" Maya taps chips: *8 weeks unpaid* · *Daycare*. She taps **Start planning session**.
>
> **6:42.** Jordan (at work) sees the banner and joins. Both phones show two avatars (Maya in her color, Jordan in his). Impact appears: *Japan 2028 and the house in 2030 no longer fit; 2029 gets tight.* Then "Building branch 1 of 3…" and cards arrive one at a time: **Protect the House**, **Protect Japan**, **Balanced**, each with stats.
>
> **6:45.** Maya selects Protect Japan; her avatar appears on that card on Jordan's phone. Jordan selects Protect the House. Banner: "You've picked different branches." Jordan reacts 😬 to Japan; Maya reacts ❤️.
>
> **6:47.** Each pins one thing: Maya *Japan before 2030*, Jordan *House by end of 2030*. "Building bridge branches…" Two arrive: one needs $260/mo more savings; the other moves the house to Dec 2030.
>
> **6:49.** Jordan drags the house slider two months earlier; Maya watches it move and both screens recalculate (+$95/mo, emergency fund 4.0 → 3.6 months). Maya types: "$95 is fine if we drop the second streaming service." The card updates.
>
> **6:51.** Both avatars are on the same card. **Hold to make this our plan.** Maya holds; Jordan's screen shows "Maya is ready." Jordan holds; the ring completes; the timeline updates on both phones. The agent posts a one-line summary.
