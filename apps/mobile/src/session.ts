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
  tunedBy: bigint | undefined;
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
              tunedBy: b.tunedBy,
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

// ---------------------------------------------------------------------------
// Live session state (Stage 7)
// ---------------------------------------------------------------------------

export type SessionMemberView = {
  memberId: bigint;
  present: boolean;
  selectedBranchId: bigint | undefined;
  ready: boolean;
};

/**
 * Who is in the session, what they picked, and whether they are ready.
 *
 * Only `role === 'member'` rows appear: the agent is a member of the household
 * but has no hands to hold a button with, so including it would make the ready
 * check impossible to satisfy.
 */
export function useSessionMembers(sessionId: bigint | undefined) {
  const [rows] = useTable(tables.sessionMember);
  const [memberRows] = useTable(tables.member);
  const { me } = useMe();

  return useMemo(() => {
    if (sessionId === undefined || !me) return [];
    const humans = memberRows
      .filter(m => m.householdId === me.householdId && m.role === 'member')
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    return humans.map(member => {
      const state = rows.find(r => r.memberId === member.id && r.sessionId === sessionId);
      return {
        member,
        state: {
          memberId: member.id,
          present: state?.present ?? false,
          selectedBranchId: state?.selectedBranchId,
          ready: state?.ready ?? false,
        } satisfies SessionMemberView,
      };
    });
  }, [rows, memberRows, sessionId, me?.householdId]);
}

/** Reactions for a session, keyed by branch id then member id. */
export function useReactions(sessionId: bigint | undefined) {
  const [rows] = useTable(tables.reaction);
  return useMemo(() => {
    const byBranch = new Map<string, { memberId: bigint; emoji: string }[]>();
    if (sessionId === undefined) return byBranch;
    for (const row of rows.filter(r => r.sessionId === sessionId)) {
      const key = String(row.branchId);
      byBranch.set(key, [...(byBranch.get(key) ?? []), { memberId: row.memberId, emoji: row.emoji }]);
    }
    return byBranch;
  }, [rows, sessionId]);
}

export const REACTIONS = ['👍', '❤️', '😬'] as const;

/**
 * Whether the ready check should be on screen.
 *
 * Visible only when **every** household member is present and all of them have
 * picked the same branch (08 Live Session Spec#Ready check) — a decision this
 * size should not be reachable while a partner is away.
 */
export function readyCheckState(
  members: readonly { state: SessionMemberView }[]
): { visible: boolean; reason?: string; branchId?: bigint } {
  if (members.length === 0) return { visible: false };

  const absent = members.filter(m => !m.state.present);
  if (absent.length > 0) {
    return { visible: false, reason: 'waiting for your partner to open the session' };
  }

  const picks = members.map(m => m.state.selectedBranchId);
  if (picks.some(pick => pick === undefined)) {
    return { visible: false, reason: 'everyone needs to pick a path' };
  }
  if (new Set(picks.map(String)).size !== 1) {
    return { visible: false, reason: "you've picked different paths" };
  }
  return { visible: true, branchId: picks[0] };
}
