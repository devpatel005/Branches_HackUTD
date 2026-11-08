import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '@branches/bindings';
import type { ProvenanceRecord, SimulationOutput } from '@branches/engine';
import { useMe } from './household';

/**
 * Reads the projection the **engine** produced inside a reducer.
 *
 * The app never computes a plan number. It parses what
 * `recomputeProjection` stored and renders it, which is what makes
 * 02 Ground Rules #1 true rather than aspirational: there is no arithmetic here
 * to get wrong.
 */

export type Projection = SimulationOutput;

export function useProjection(): {
  projection: Projection | undefined;
  version: number;
  lastChangedBy: bigint | undefined;
  ready: boolean;
} {
  const { me } = useMe();
  const [rows, ready] = useTable(tables.planProjection);
  const row = me ? rows.find(r => r.householdId === me.householdId) : undefined;

  // Parsing ~13 KB of JSON on every render would be wasteful; `version` changes
  // on every recompute, so it is the right cache key.
  const projection = useMemo(() => {
    if (!row) return undefined;
    try {
      return JSON.parse(row.json) as Projection;
    } catch {
      return undefined;
    }
  }, [row?.version, row?.json]);

  return {
    projection,
    version: row?.version ?? 0,
    lastChangedBy: row?.lastChangedBy,
    ready,
  };
}

/** The household's goals. Shared — both partners see all of them. */
export function useGoals() {
  const { me } = useMe();
  const [rows, ready] = useTable(tables.goal);
  const goals = me
    ? rows
        .filter(g => g.householdId === me.householdId && g.status === 'active')
        .sort((a, b) => a.targetMonth - b.targetMonth || (a.id < b.id ? -1 : 1))
    : [];
  return { goals, ready };
}

export function useAssumptions() {
  const { me } = useMe();
  const [rows, ready] = useTable(tables.assumption);
  return {
    assumptions: me ? rows.find(a => a.householdId === me.householdId) : undefined,
    ready,
  };
}

/** The engine's result for one goal, keyed by its row id as a string. */
export function goalResult(projection: Projection | undefined, goalId: bigint) {
  return projection?.goals.find(g => g.id === String(goalId));
}

/** A provenance record by path, for the "Show the Math" sheet. */
export function provenanceFor(
  projection: Projection | undefined,
  path: string
): ProvenanceRecord | undefined {
  return projection?.provenance[path];
}

/**
 * Calendar label for a plan month, e.g. month 24 from `2026-11` -> `Nov 2028`.
 *
 * Plan months are indexes, not dates; the household's `currentMonth` is month 0.
 */
export function planMonthLabel(currentMonth: string, planMonth: number): string {
  const [yearStr, monthStr] = currentMonth.split('-');
  const base = Number(yearStr) * 12 + (Number(monthStr) - 1) + planMonth;
  const year = Math.floor(base / 12);
  const month = (base % 12 + 12) % 12;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[month]} ${year}`;
}

/** 1-based plan year for a month index. Months 0-11 are year 1. */
export function planYear(planMonth: number): number {
  return Math.floor(planMonth / 12) + 1;
}
