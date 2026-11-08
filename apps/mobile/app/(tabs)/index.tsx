import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Loading, Screen } from '../../src/components';
import { HomeView, type HomeGoal } from '../../src/home-view';
import { ShowTheMath } from '../../src/sheets';
import { AssumptionsSheet, GoalDetailSheet } from '../../src/plan-sheets';
import { memberColor, useHousehold, useHouseholdMembers, useMe } from '../../src/household';
import {
  goalResult,
  planMonthLabel,
  provenanceFor,
  useGoals,
  useProjection,
} from '../../src/projection';

/**
 * Home — "what do we have, and does the plan work?" (10 Screens#Home).
 *
 * This file only gathers data. Every number it passes on is engine output
 * (02 Ground Rules #1); the layout lives in src/home-view.tsx.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { me } = useMe();
  const household = useHousehold();
  const members = useHouseholdMembers();
  const { projection, version, lastChangedBy, ready } = useProjection();
  const { goals } = useGoals();

  const [math, setMath] = useState<{ label: string; path: string } | null>(null);
  const [openGoalId, setOpenGoalId] = useState<bigint | null>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  if (!household) return <Loading label="Finding your household…" />;
  if (!projection && !ready) return <Loading label="Working out your plan…" />;

  const actor =
    lastChangedBy !== undefined && lastChangedBy !== me?.id
      ? members.find(m => m.id === lastChangedBy)
      : undefined;

  const monthLabel = (m: number) => planMonthLabel(household.currentMonth, m);
  const titleOf = (goalId: string) => goals.find(g => String(g.id) === goalId)?.title ?? 'A goal';

  const homeGoals: HomeGoal[] = goals.map(goal => {
    const result = goalResult(projection, goal.id);
    return {
      key: String(goal.id),
      title: goal.title,
      priority: goal.priority,
      targetLabel: monthLabel(goal.targetMonth),
      costTodayCents: goal.costTodayCents,
      monthlyCents: result ? Math.round(result.requiredMonthlyAtStart * 100) : undefined,
      funded: result?.funded !== false,
    };
  });

  return (
    <Screen>
      <HomeView
        members={members
          .filter(m => m.role === 'member')
          .map(m => ({ name: m.displayName, color: memberColor(m.colorKey) }))}
        points={projection?.series.monthly.map(s => ({ month: s.month, value: s.totalSavings })) ?? []}
        markers={
          projection?.goals.map(g => ({
            month: g.settleMonth,
            label: titleOf(g.id),
            // Label with the target month so it matches the goal rows below
            // (the station sits on the settle month, the deposit before it).
            dateStr: monthLabel(goals.find(x => String(x.id) === g.id)?.targetMonth ?? g.settleMonth + 1),
            cost: g.inflatedCost,
            shortfall: g.funded ? undefined : g.shortfall,
            atRisk: !g.funded,
          })) ?? []
        }
        tightYears={projection?.tightYears ?? []}
        startYear={Number(household.currentMonth.slice(0, 4))}
        freeToPlan={projection?.freeToPlan ?? 0}
        cushionMonths={projection?.emergencyMonthsMin.months ?? 0}
        goalsFunded={projection?.goalsOnTrack.funded ?? 0}
        goalsTotal={projection?.goalsOnTrack.total ?? goals.length}
        atRiskTitles={(projection?.atRiskGoalIds ?? []).map(titleOf)}
        goals={homeGoals}
        monthLabel={monthLabel}
        pulseVersion={version}
        pulseColor={actor ? memberColor(actor.colorKey) : undefined}
        onShowMath={(label, path) => setMath({ label, path })}
        onOpenAssumptions={() => setAssumptionsOpen(true)}
        onOpenGoal={key => setOpenGoalId(BigInt(key))}
        // 10 Screens#Home: the primary action opens Chat with the event prompt.
        onSomethingCameUp={() => router.push('/chat')}
        onAddGoal={() => router.push('/timeline')}
        onOpenWrapped={() => router.push('/wrapped')}
      />

      <ShowTheMath
        visible={math !== null}
        onClose={() => setMath(null)}
        label={math?.label ?? ''}
        record={math ? provenanceFor(projection, math.path) : undefined}
      />
      <GoalDetailSheet goalId={openGoalId} onClose={() => setOpenGoalId(null)} />
      <AssumptionsSheet visible={assumptionsOpen} onClose={() => setAssumptionsOpen(false)} />
    </Screen>
  );
}
