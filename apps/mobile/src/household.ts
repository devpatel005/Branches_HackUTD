import { useTable } from 'spacetimedb/react';
import { tables } from '@branches/bindings';
import { useIdentity } from './spacetime';
import { colors } from './theme';

/**
 * Household hooks.
 *
 * Note what is *not* here: there is no hook for "my partner's transactions" or
 * "my partner's inferred items", because row-level security means those rows
 * never arrive on this client at all (05 Data Model#Visibility). Partner state
 * comes from `useProgress`, which the module exposes as counts only.
 */

export function useMe() {
  const { identity } = useIdentity();
  const [members, ready] = useTable(tables.member);
  const me = identity
    ? members.find(m => m.identity.toHexString() === identity.toHexString())
    : undefined;
  return { me, members, ready };
}

export function useHousehold() {
  const { me } = useMe();
  const [households] = useTable(tables.household);
  const household = me ? households.find(h => h.id === me.householdId) : undefined;
  return household;
}

/** Everyone in my household, in join order, agent excluded. */
export function useHouseholdMembers() {
  const { me, members } = useMe();
  if (!me) return [];
  return members
    .filter(m => m.householdId === me.householdId && m.role === 'member')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Onboarding progress for every member — counts only, from the module's view.
 * This is how "Jordan: 4 of 5" works without exposing a single amount.
 */
export function useProgress() {
  const { me } = useMe();
  const [rows, ready] = useTable(tables.onboardingProgress);
  const mine = me ? rows.filter(r => r.householdId === me.householdId) : [];
  return {
    ready,
    all: mine,
    me: me ? mine.find(r => r.memberId === me.id) : undefined,
    partners: me ? mine.filter(r => r.memberId !== me.id) : [],
  };
}

/** My own inferred items. Row-level security means these are the only ones here. */
export function useMyItems() {
  const [items, ready] = useTable(tables.inferredItem);
  const sorted = [...items].sort((a, b) => a.sortIndex - b.sortIndex);
  return { items: sorted, ready };
}

/** My own gap questions, unanswered first. */
export function useMyGaps() {
  const [gaps, ready] = useTable(tables.gapQuestion);
  const sorted = [...gaps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    gaps: sorted,
    unanswered: sorted.filter(g => g.answer === undefined),
    ready,
  };
}

export function useMyFunMoney() {
  const { me } = useMe();
  const [rows, ready] = useTable(tables.funMoney);
  return { funMoney: me ? rows.find(r => r.memberId === me.id) : undefined, ready };
}

export function useBaseline() {
  const { me } = useMe();
  const [rows, ready] = useTable(tables.baseline);
  return { baseline: me ? rows.find(r => r.householdId === me.householdId) : undefined, ready };
}

/** A member's colour from 09 Design System. Partner colours mean *who*. */
export function memberColor(colorKey: string): string {
  return colorKey === 'a' ? colors.memberA : colorKey === 'b' ? colors.memberB : colors.agent;
}

/**
 * Show a loading state only when there is genuinely nothing to render.
 *
 * 14 Research Notes#SpacetimeDB: calling a reducer briefly flips `isReady` to
 * false, so `if (!isReady) return <Loading/>` makes screens flash on every tap.
 */
export function shouldShowLoading(ready: boolean, rowCount: number): boolean {
  return !ready && rowCount === 0;
}
