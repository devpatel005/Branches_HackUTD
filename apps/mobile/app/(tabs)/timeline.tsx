import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Loading, Screen, TitleBand } from '../../src/components';
import { Station } from '../../src/forest';
import { AddGoalSheet } from '../../src/goal-picker';
import { GoalDetailSheet } from '../../src/plan-sheets';
import { Pulse } from '../../src/pulse';
import { memberColor, useHousehold, useHouseholdMembers, useMe } from '../../src/household';
import { goalResult, planMonthLabel, useGoals, useProjection } from '../../src/projection';
import { dollars } from '../../src/format';
import { colors, line, space, tabularNums, type as typeScale } from '../../src/theme';

const PLAN_YEARS = 10;

/**
 * Timeline — the ten years drawn as one path with a stop per year
 * (10 Screens#Timeline). Goals sit at the year they settle; a tight year gets a
 * flat lichen band, never a box.
 */
export default function TimelineScreen() {
  const { me } = useMe();
  const household = useHousehold();
  const members = useHouseholdMembers();
  const { projection, version, lastChangedBy } = useProjection();
  const { goals, ready } = useGoals();

  const [addOpen, setAddOpen] = useState(false);
  const [openGoalId, setOpenGoalId] = useState<bigint | null>(null);

  if (!household) return <Loading label="Finding your household…" />;

  const actor =
    lastChangedBy !== undefined && lastChangedBy !== me?.id
      ? members.find(m => m.id === lastChangedBy)
      : undefined;
  const pulseColor = actor ? memberColor(actor.colorKey) : undefined;
  const tightYears = new Set(projection?.tightYears ?? []);
  const firstYear = Number(household.currentMonth.slice(0, 4));
  // A plan year starts at plan month 0, so unless that is January it spans two
  // calendar years ("2027–28"); a single year would contradict the goal dates.
  const startsInJanuary = household.currentMonth.slice(5, 7) === '01';
  const yearLabel = (year: number) => {
    const y = firstYear + year - 1;
    return startsInJanuary ? String(y) : `${y}–${String(y + 1).slice(2)}`;
  };

  return (
    <Screen>
      <TitleBand plate="No. 2 · Timeline" title="Your ten years">
        <Body dim>
          Every goal sits at the month it settles. A lichen band marks a tight year.
        </Body>
      </TitleBand>

      <Button label="Add a goal" variant="secondary" icon="plus" onPress={() => setAddOpen(true)} />

      {goals.length === 0 && ready ? (
        <Text style={styles.emptyLine}>Your timeline fills in as you add goals.</Text>
      ) : null}

      <Pulse watch={version} color={pulseColor} style={styles.path}>
        <View style={styles.spine} />
        {Array.from({ length: PLAN_YEARS }, (_, i) => i + 1).map(year => {
          const yearGoals = goals.filter(g => Math.floor((g.targetMonth - 1) / 12) + 1 === year);
          const tight = tightYears.has(year);
          return (
            <View key={year} style={[styles.year, tight && styles.yearTight]}>
              <View style={styles.yearHead}>
                <View style={styles.stop}>
                  <Station color={tight ? colors.warn : colors.ruleStrong} size={9} />
                </View>
                <Text style={[styles.calendarYear, tabularNums]}>{yearLabel(year)}</Text>
                <Text style={styles.yearIndex}>Year {year}</Text>
                {tight ? <Text style={styles.tightLabel}>Tight year</Text> : null}
              </View>

              {yearGoals.map(goal => {
                const result = goalResult(projection, goal.id);
                const funded = result?.funded !== false;
                const monthly = result
                  ? dollars(Math.round(result.requiredMonthlyAtStart * 100), { showCents: true })
                  : '—';
                const when = planMonthLabel(household.currentMonth, goal.targetMonth);
                return (
                  <Pressable
                    key={String(goal.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${goal.title}, ${when}, ${funded ? 'funded' : "doesn't fit yet"}. ${monthly} a month. Open details.`}
                    onPress={() => setOpenGoalId(goal.id)}
                    style={({ pressed }) => [styles.goal, pressed && styles.pressed]}
                  >
                    <View style={styles.stop}>
                      <Station color={funded ? colors.accent : colors.error} filled={!funded} />
                    </View>
                    <View style={styles.goalText}>
                      <Text style={styles.goalTitle} numberOfLines={2}>
                        {goal.title}
                      </Text>
                      <Text style={styles.goalMeta}>
                        {when} · {dollars(goal.costTodayCents)} today ·{' '}
                        {goal.priority === 'must' ? 'Must-have' : 'Flexible'}
                      </Text>
                    </View>
                    <View style={styles.goalAmount}>
                      <Text style={[styles.goalMonthly, tabularNums]}>{monthly}</Text>
                      <Text style={styles.goalUnit}>a month</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </Pulse>

      <AddGoalSheet visible={addOpen} onClose={() => setAddOpen(false)} />
      <GoalDetailSheet goalId={openGoalId} onClose={() => setOpenGoalId(null)} />
    </Screen>
  );
}

const GUTTER = 22;

const styles = StyleSheet.create({
  emptyLine: { ...typeScale.bodyItalic, color: colors.ink2, marginTop: space.lg },
  pressed: { backgroundColor: colors.surface },

  path: { marginTop: space.xxl, position: 'relative' },
  spine: {
    position: 'absolute',
    left: GUTTER / 2 - line.path / 2,
    top: 14,
    bottom: 14,
    width: line.path,
    backgroundColor: colors.ruleStrong,
  },

  year: { paddingVertical: space.md, borderBottomWidth: line.hair, borderBottomColor: colors.rule },
  yearTight: { backgroundColor: colors.warnBand },
  yearHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, minHeight: 32 },
  stop: { width: GUTTER, alignItems: 'center', alignSelf: 'center' },
  calendarYear: { ...typeScale.title, fontSize: 24, lineHeight: 30, color: colors.ink },
  yearIndex: { ...typeScale.caption, color: colors.ink2 },
  tightLabel: { ...typeScale.caption, color: colors.warn, marginLeft: 'auto', paddingRight: space.sm },

  goal: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 64, paddingVertical: space.sm },
  goalText: { flex: 1 },
  goalTitle: { ...typeScale.headline, fontSize: 17, color: colors.ink },
  goalMeta: { ...typeScale.caption, color: colors.ink2, marginTop: 2 },
  goalAmount: { alignItems: 'flex-end', paddingRight: space.xs },
  goalMonthly: { ...typeScale.numeral, fontSize: 18, color: colors.ink },
  goalUnit: { ...typeScale.caption, color: colors.ink2 },
});
