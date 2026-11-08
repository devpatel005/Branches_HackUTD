import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Loading } from '../../src/components';
import { AddGoalSheet } from '../../src/goal-picker';
import { GoalDetailSheet } from '../../src/plan-sheets';
import { Pulse } from '../../src/pulse';
import { goalIcon } from '../../src/icons';
import { memberColor, useHousehold, useHouseholdMembers, useMe } from '../../src/household';
import { goalResult, planMonthLabel, useGoals, useProjection } from '../../src/projection';
import { TreeTimeline, type TreeGoal } from '../../src/tree-timeline';

/**
 * Timeline — the ten years as a tree you climb (10 Screens#Timeline).
 *
 * The screen opens at the stump (today). Swipe up and each plan year is a
 * length of trunk; goals grow as branches in the year they settle, tight years
 * get a lichen band, and the crown is the end of the plan. Tap a branch for
 * Goal Detail; "Add a goal" sits at the stump.
 */
export default function TimelineScreen() {
  const { me } = useMe();
  const household = useHousehold();
  const members = useHouseholdMembers();
  const { projection, version, lastChangedBy } = useProjection();
  const { goals } = useGoals();

  const [addOpen, setAddOpen] = useState(false);
  const [openGoalId, setOpenGoalId] = useState<bigint | null>(null);

  if (!household) return <Loading label="Finding your household…" />;

  const actor =
    lastChangedBy !== undefined && lastChangedBy !== me?.id
      ? members.find(m => m.id === lastChangedBy)
      : undefined;
  const firstYear = Number(household.currentMonth.slice(0, 4));
  // A plan year starts at plan month 0, so unless that is January it spans two
  // calendar years ("2027–28"); a single year would contradict the goal dates.
  const startsInJanuary = household.currentMonth.slice(5, 7) === '01';
  const yearLabel = (year: number) => {
    const y = firstYear + year - 1;
    return startsInJanuary ? String(y) : `${y}–${String(y + 1).slice(2)}`;
  };

  const treeGoals: TreeGoal[] = goals.map(goal => {
    const result = goalResult(projection, goal.id);
    const addedBy = members.find(m => m.id === goal.createdBy);
    return {
      key: String(goal.id),
      title: goal.title,
      icon: goalIcon(goal.icon),
      priority: goal.priority,
      targetMonth: goal.targetMonth,
      targetLabel: planMonthLabel(household.currentMonth, goal.targetMonth),
      costTodayCents: goal.costTodayCents,
      monthlyCents: result ? Math.round(result.requiredMonthlyAtStart * 100) : undefined,
      funded: result?.funded !== false,
      color: addedBy ? memberColor(addedBy.colorKey) : undefined,
    };
  });

  return (
    <Pulse watch={version} color={actor ? memberColor(actor.colorKey) : undefined} style={styles.fill}>
      <TreeTimeline
        goals={treeGoals}
        tightYears={projection?.tightYears ?? []}
        yearLabel={yearLabel}
        startLabel={planMonthLabel(household.currentMonth, 0)}
        endLabel={planMonthLabel(household.currentMonth, 119)}
        onOpenGoal={key => setOpenGoalId(BigInt(key))}
        onAddGoal={() => setAddOpen(true)}
      />
      <AddGoalSheet visible={addOpen} onClose={() => setAddOpen(false)} />
      <GoalDetailSheet goalId={openGoalId} onClose={() => setOpenGoalId(null)} />
    </Pulse>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
