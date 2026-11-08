import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '@branches/bindings';
import type { CandidateStats, Constraint, Levers } from '@branches/engine';
import { useMe } from './household';

/**
 * Session, candidates, branches and constraints.
 *
 * Stage 5 drives all of this from one device; Stage 7 adds presence,
 * selections, reactions and the ready check on top of the same rows.
 */

export type BranchView = {
  id: bigint;
  candidateId: bigint;
  name: string;
  summary: string;
  nameSource: string;
  position: number;
  signature: string;
  source: string;
  levers: Levers;
  stats: CandidateStats;
};

export function useOpenSession() {
  const { me } = useMe();
  const [rows, ready] = useTable(tables.session);
  const session = me
    ? rows
        .filter(s => s.householdId === me.householdId && s.status === 'open')
        .sort((a, b) => (a.id < b.id ? 1 : -1))[0]
    : undefined;
  return { session, ready };
}

/** The most recent session for an event, open or settled. */
export function useSessionForEvent(eventId: bigint | undefined) {
  const { me } = useMe();
  const [rows] = useTable(tables.session);
  if (!me || eventId === undefined) return undefined;
  return rows
    .filter(s => s.householdId === me.householdId && s.eventId === eventId)
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0];
}

/**
 * The named branches on screen, joined to their candidate's levers and stats.
 *
 * Branches and candidates are two tables because a candidate is a path the
 * engine found and a branch is one the couple was shown and named
 * (05 Data Model).
 */
export function useBranches(sessionId: bigint | undefined) {
  const [branchRows, branchReady] = useTable(tables.branch);
  const [candidateRows] = useTable(tables.branchCandidate);

  const branches = useMemo<BranchView[]>(() => {
    if (sessionId === undefined) return [];
    const candidates = new Map(candidateRows.map(c => [c.id, c]));
    return branchRows
      .filter(b => b.sessionId === sessionId)
      .sort((a, b) => a.position - b.position)
      .flatMap(b => {
        const candidate = candidates.get(b.candidateId);
        if (!candidate) return [];
        try {
          return [
            {
              id: b.id,
              candidateId: b.candidateId,
              name: b.name,
              summary: b.summary,
              nameSource: b.nameSource,
              position: b.position,
              signature: candidate.signature,
              source: candidate.source,
              levers: JSON.parse(candidate.levers) as Levers,
              stats: JSON.parse(candidate.stats) as CandidateStats,
            },
          ];
        } catch {
          return [];
        }
      });
  }, [branchRows, candidateRows, sessionId]);

  return { branches, ready: branchReady };
}

export type ConstraintView = {
  id: bigint;
  memberId: bigint;
  kind: 'lock' | 'pin';
  target: Constraint;
};

export function useConstraints(sessionId: bigint | undefined) {
  const [rows] = useTable(tables.constraint);

  return useMemo<ConstraintView[]>(() => {
    if (sessionId === undefined) return [];
    return rows
      .filter(c => c.sessionId === sessionId && c.active)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .flatMap(c => {
        try {
          return [
            {
              id: c.id,
              memberId: c.memberId,
              kind: c.kind === 'pin' ? ('pin' as const) : ('lock' as const),
              target: JSON.parse(c.target) as Constraint,
            },
          ];
        } catch {
          return [];
        }
      });
  }, [rows, sessionId]);
}

/** What the couple has committed, kept separate from what was observed. */
export function useCommitment() {
  const { me } = useMe();
  const [rows] = useTable(tables.planCommitment);
  return me ? rows.find(c => c.householdId === me.householdId) : undefined;
}

/** Plain-language label for a constraint, for its chip. */
export function constraintLabel(
  target: Constraint,
  goalTitle: (goalId: string) => string
): string {
  switch (target.kind) {
    case 'goalOnTime':
      return `${goalTitle(target.goalId)} on time`;
    case 'goalFullSize':
      return `${goalTitle(target.goalId)} full size`;
    case 'noExtraSaving':
      return 'No extra saving';
    case 'saveMoreAtMost':
      return `Save at most $${target.amount}/mo`;
  }
}

/** The stat row shown on every branch card (06 Engine Spec#Outputs). */
export function branchStatLine(
  stats: CandidateStats,
  goalTitle: (goalId: string) => string
): string[] {
  const parts: string[] = [];
  for (const [goalId, months] of Object.entries(stats.goalDateChanges)) {
    parts.push(`${goalTitle(goalId)} ${months > 0 ? '+' : ''}${months} mo`);
  }
  if (stats.saveMore > 0) parts.push(`+$${stats.saveMore}/mo`);
  parts.push(`${stats.emergencyMonthsMin.toFixed(1)} mo safety net`);
  parts.push(
    stats.tightYears === 0
      ? 'no tight years'
      : `${stats.tightYears} tight year${stats.tightYears === 1 ? '' : 's'}`
  );
  parts.push(`${stats.goalsFunded}/${stats.goalsTotal} goals`);
  return parts;
}
