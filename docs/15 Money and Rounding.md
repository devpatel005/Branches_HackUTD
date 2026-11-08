---
tags: [branches, spec, engine, decision]
---
# 15 Money and Rounding

How the engine turns floating-point dollars into cents. Parked for now — see
OD-17 in [[13 Open Decisions]]. Raised during [[Stage 0 - Foundations and Risk Checks]].

## The rule
`toCents` in `packages/engine/src/money.ts` is the **only** place money becomes
a cent value. Two things about it are deliberate, and neither is obvious.

```ts
export function toCents(dollars: number): number {
  const scaled = Number((dollars * 100).toPrecision(12));
  return (Math.sign(scaled) * Math.round(Math.abs(scaled))) / 100;
}
```

## 1. Precision is normalised before rounding (settled — required by the spec)
[[06 Engine Spec]] E1 expects Japan's inflated cost to be **5,273.65**. The
exact value is an exact half-cent tie:

```
5,000 x 1.027^2 = 5,000 x 1.054729 = 5,273.645
```

But `Math.pow(1.027, 2)` in IEEE-754 is `1.0547289999999998`, which lands just
*below* the tie. So `Math.round(x * 100) / 100` returns **5,273.64** and E1
fails. `Math.round`, `toFixed(2)` and floor-half-up all get this wrong.

Normalising to 12 significant digits first restores the true decimal tie. 12 is
comfortably inside f64's ~15–17 significant digits, so it only ever removes
accumulated binary error, never real precision at our magnitudes. All of F1–F5
and E1–E3 were checked numerically and match the spec with this helper.

[[06 Engine Spec]] forbids editing the goldens to match an implementation, so
this is not optional. **Do not simplify it to `Math.round(x * 100) / 100`.**

## 2. Ties round half away from zero (OPEN — OD-17)
`Math.round` breaks ties toward **+Infinity**, not away from zero:

| Value | `Math.round` | Half away from zero |
|---|---|---|
| `2.345` | 2.35 | 2.35 |
| `-2.345` | **-2.34** | **-2.35** |

The engine rounds negative money — `freeToPlan` and the monthly surplus can both
be negative ([[06 Engine Spec#Outputs]]), and shortfalls are differences. Under
`Math.round`, a $2.345 shortfall and a $2.345 surplus would round to different
magnitudes, which is hard to explain in a "show the math" sheet.

Stage 0 chose **half away from zero**, so `toCents(-x) === -toCents(x)` holds.

### Why this is still open
[[06 Engine Spec]] is silent on negatives, and every golden in it is positive,
so **no golden distinguishes the two choices today**. That is exactly why it
should be settled before Stage 1 bakes it in: the engine's goldens are the
project's source of truth, and they currently can't catch a change here.

### If the team wants to flip it
One line in `packages/engine/src/money.ts`, plus check `M3` in
`scripts/verify/math.ts` (`npm run verify:math`). Nothing else depends on it
yet. The longer Stage 1 runs, the more derived goldens inherit the choice.

### What would make the decision for us
A golden with a negative half-cent tie — for example a `freeToPlan` expected
value — added to [[06 Engine Spec#Golden scenarios]]. Then the spec decides and
this note becomes a footnote.
