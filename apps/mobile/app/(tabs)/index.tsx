import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Avatar,
  Body,
  Button,
  Caption,
  Loading,
  Notice,
  Row,
  Screen,
  SectionHeader,
} from '../../src/components';
import { ProjectionChart, type ChartPoint } from '../../src/chart';
import { Pulse } from '../../src/pulse';
import { ShowTheMath } from '../../src/sheets';
import { GoalDetailSheet, AssumptionsSheet } from '../../src/plan-sheets';
import { memberColor, useHousehold, useHouseholdMembers, useMe } from '../../src/household';
import {
  goalResult,
  planMonthLabel,
  provenanceFor,
  useGoals,
  useProjection,
} from '../../src/projection';
import { dollars, perMonth } from '../../src/format';
import { colors, space, tabularNums, type as typeScale } from '../../src/theme';

/**
 * Home — 10 Screens#Home.
 *
 * One big number (free to plan), the scrubbable projection line, a stat row and
 * the goal list. Every number here opens "Show the Math" from the engine's
 * provenance; none of them is computed in this file.
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
  const [scrub, setScrub] = useState<ChartPoint | null>(null);

  if (!household) return <Loading label="Connecting…" />;
  if (!projection && !ready) return <Loading label="Working out your plan…" />;

  // The actor's colour, but only when it was the *other* partner — your own
  // edits should not pulse back at you.
  const actor = lastChangedBy !== undefined && lastChangedBy !== me?.id
    ? members.find(m => m.id === lastChangedBy)
    : undefined;
  const pulseColor = actor ? memberColor(actor.colorKey) : undefined;

  const points: ChartPoint[] =
    projection?.series.monthly.map(s => ({ month: s.month, value: s.totalSavings })) ?? [];

  const markers =
    projection?.goals.map(g => {
      const row = goals.find(x => String(x.id) === g.id);
      return { month: g.settleMonth, label: row?.title ?? g.id, atRisk: !g.funded };
    }) ?? [];

  const atRisk = (projection?.atRiskGoalIds.length ?? 0) > 0;

  // While scrubbing, the hero shows the value at that point and the date
  // replaces the caption (09 Design System#Signature components).
  const heroValue = scrub ? dollars(Math.round(scrub.value * 100)) : dollars(Math.round((projection?.freeToPlan ?? 0) * 100));
  const heroCaption = scrub
    ? `Projected savings · ${planMonthLabel(household.currentMonth, scrub.month)}`
    : 'Free to plan each month';

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.avatars}>
          {members.map(m => (
            <Avatar
              key={String(m.id)}
              name={m.displayName}
              color={memberColor(m.colorKey)}
              online={m.online}
            />
          ))}
        </View>
        <Pressable onPress={() => setAssumptionsOpen(true)}>
          <Caption>Assumptions</Caption>
        </Pressable>
      </View>

      <Pulse watch={version} color={pulseColor} style={styles.heroBlock}>
        <Pressable
          onPress={() => (scrub ? undefined : setMath({ label: 'Free to plan', path: 'freeToPlan' }))}
        >
          <Text style={[styles.display, tabularNums, atRisk && !scrub ? styles.displayAtRisk : null]}>
            {heroValue}
          </Text>
          <Caption>{heroCaption}</Caption>
        </Pressable>
      </Pulse>

      <ProjectionChart
        points={points}
        markers={markers}
        atRisk={atRisk}
        floor={projection?.emergencyFloor}
        onScrub={setScrub}
      />
      <Caption>
        Total set aside over ten years. Drag to scrub; dots are goals being paid for.
      </Caption>

      <View style={styles.statRow}>
        <Stat
          label="Emergency fund"
          value={`${projection?.emergencyMonthsMin.months.toFixed(1) ?? '—'} mo`}
          hint="lowest point"
          onPress={() => setMath({ label: 'Emergency-fund months', path: 'emergencyMonthsMin' })}
        />
        <Stat
          label="Tight years"
          value={String(projection?.tightYears.length ?? 0)}
          tone={(projection?.tightYears.length ?? 0) > 0 ? colors.caution : undefined}
          onPress={() => setMath({ label: 'Tight years', path: 'tightYears' })}
        />
        <Stat
          label="Goals on track"
          value={`${projection?.goalsOnTrack.funded ?? 0}/${projection?.goalsOnTrack.total ?? 0}`}
          onPress={() => setMath({ label: 'Goals on track', path: 'goalsOnTrack' })}
        />
      </View>

      <SectionHeader>Goals</SectionHeader>
      {goals.length === 0 ? (
        <>
          <Notice>No goals yet. Add them on the Timeline tab to see the plan take shape.</Notice>
          <Button label="Go to Timeline" variant="secondary" onPress={() => router.push('/timeline')} />
        </>
      ) : (
        goals.map(goal => {
          const result = goalResult(projection, goal.id);
          return (
            <Row
              key={String(goal.id)}
              label={`${goal.title}${goal.priority === 'must' ? ' · must-have' : ''}`}
              sublabel={`${planMonthLabel(household.currentMonth, goal.targetMonth)} · ${dollars(goal.costTodayCents)} today`}
              value={result ? perMonth(Math.round(result.requiredMonthlyAtStart * 100)) : '—'}
              onPress={() => setOpenGoalId(goal.id)}
              right={
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: result?.funded === false ? colors.negative : colors.accent },
                  ]}
                />
              }
            />
          );
        })
      )}

      <SectionHeader>Something came up?</SectionHeader>
      <Body dim>Life events and branches arrive in the next stage.</Body>

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

function Stat({
  label,
  value,
  hint,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Show the math.`}
      style={({ pressed }) => [styles.stat, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tabularNums, tone ? { color: tone } : null]}>{value}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  avatars: { flexDirection: 'row', gap: space.sm },
  heroBlock: { marginBottom: space.sm },
  display: { ...typeScale.display, color: colors.textPrimary },
  displayAtRisk: { color: colors.negative },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.lg,
    gap: space.sm,
  },
  stat: { flex: 1 },
  statLabel: { ...typeScale.caption, color: colors.textSecondary },
  statValue: { ...typeScale.headline, color: colors.textPrimary, marginTop: 2 },
  statHint: { ...typeScale.caption, color: colors.textSecondary, marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
});
