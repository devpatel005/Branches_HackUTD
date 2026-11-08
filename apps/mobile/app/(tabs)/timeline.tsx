import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Body,
  Button,
  Caption,
  Loading,
  Notice,
  Row,
  Screen,
  Title,
} from '../../src/components';
import { AddGoalSheet } from '../../src/goal-picker';
import { GoalDetailSheet } from '../../src/plan-sheets';
import { Pulse } from '../../src/pulse';
import { memberColor, useHousehold, useHouseholdMembers, useMe } from '../../src/household';
import { goalResult, planMonthLabel, useGoals, useProjection } from '../../src/projection';
import { dollars, perMonth } from '../../src/format';
import { colors, space, tabularNums, type as typeScale } from '../../src/theme';

const PLAN_YEARS = 10;

/**
 * Timeline — 10 Screens#Timeline.
 *
 * Vertical scroll by plan year, goals shown at their target month, applied life
 * events as markers (Stage 4), and **tight years tinted** with the caution
 * token — the only place that colour is used (09 Design System).
 *
 * This is also where goals are added after onboarding: 10 Screens puts the
 * picker in onboarding only, which would leave goals frozen afterwards.
 */
export default function TimelineScreen() {
  const { me } = useMe();
  const household = useHousehold();
  const members = useHouseholdMembers();
  const { projection, version, lastChangedBy } = useProjection();
  const { goals, ready } = useGoals();

  const [addOpen, setAddOpen] = useState(false);
  const [openGoalId, setOpenGoalId] = useState<bigint | null>(null);

  if (!household) return <Loading label="Connecting…" />;

  const actor =
    lastChangedBy !== undefined && lastChangedBy !== me?.id
      ? members.find(m => m.id === lastChangedBy)
      : undefined;
  const pulseColor = actor ? memberColor(actor.colorKey) : undefined;

  const tightYears = new Set(projection?.tightYears ?? []);

  return (
    <Screen>
      <Title>Ten years</Title>
      <Body dim>
        Every goal at the month it's due. Tap one to see its math or change it.
      </Body>

      <Button label="Add a goal" onPress={() => setAddOpen(true)} />

      {goals.length === 0 && ready ? (
        <Notice>
          No goals yet. Add a few — a house, a trip, a car — and the ten-year projection fills in.
        </Notice>
      ) : null}

      <Pulse watch={version} color={pulseColor} style={styles.years}>
        {Array.from({ length: PLAN_YEARS }, (_, i) => i + 1).map(year => {
          const yearGoals = goals.filter(
            g => Math.floor((g.targetMonth - 1) / 12) + 1 === year
          );
          const isTight = tightYears.has(year);
          const calendarYear = Number(household.currentMonth.slice(0, 4)) + (year - 1);

          return (
            <View key={year} style={[styles.year, isTight && styles.yearTight]}>
              <View style={styles.yearHeader}>
                <Text style={styles.yearLabel}>
                  Year {year} <Text style={styles.calendarYear}>· {calendarYear}</Text>
                </Text>
                {isTight ? <Text style={styles.tightBadge}>tight</Text> : null}
              </View>

              {yearGoals.length === 0 ? (
                <Text style={styles.empty}>—</Text>
              ) : (
                yearGoals.map(goal => {
                  const result = goalResult(projection, goal.id);
                  return (
                    <Row
                      key={String(goal.id)}
                      label={`${goal.icon} ${goal.title}`}
                      sublabel={`${planMonthLabel(household.currentMonth, goal.targetMonth)} · ${
                        goal.priority === 'must' ? 'must-have' : 'flexible'
                      } · ${dollars(goal.costTodayCents)} today`}
                      value={result ? perMonth(Math.round(result.requiredMonthlyAtStart * 100)) : '—'}
                      onPress={() => setOpenGoalId(goal.id)}
                      right={
                        <View
                          style={[
                            styles.statusDot,
                            {
                              backgroundColor:
                                result?.funded === false ? colors.negative : colors.accent,
                            },
                          ]}
                        />
                      }
                    />
                  );
                })
              )}
            </View>
          );
        })}
      </Pulse>

      {tightYears.size > 0 ? (
        <Caption color={colors.caution}>
          A tinted year has at least one month where the emergency fund dips below its floor, or a
          goal couldn't be paid in full.
        </Caption>
      ) : null}

      <AddGoalSheet visible={addOpen} onClose={() => setAddOpen(false)} />
      <GoalDetailSheet goalId={openGoalId} onClose={() => setOpenGoalId(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  years: { marginTop: space.lg },
  year: { paddingVertical: space.sm, borderRadius: 8, paddingHorizontal: space.sm },
  // Tight years are tinted, not outlined, so the whole band reads as the signal.
  yearTight: { backgroundColor: 'rgba(255, 184, 0, 0.08)' },
  yearHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  yearLabel: { ...typeScale.caption, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  calendarYear: { ...tabularNums, textTransform: 'none', letterSpacing: 0 },
  tightBadge: { ...typeScale.caption, color: colors.caution },
  empty: { ...typeScale.body, color: colors.hairline, paddingVertical: space.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
});
