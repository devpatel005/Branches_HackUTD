import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import {
  Avatar,
  Body,
  Button,
  Caption,
  Loading,
  Notice,
  Screen,
  SectionHeader,
  TitleBand,
} from '../../src/components';
import { Station } from '../../src/forest';
import { Icon, goalIcon } from '../../src/icons';
import { AddGoalSheet } from '../../src/goal-picker';
import { memberColor, useHousehold, useHouseholdMembers } from '../../src/household';
import { goalResult, planMonthLabel, useGoals, useProjection } from '../../src/projection';
import { dollars } from '../../src/format';
import { colors, line, space, tabularNums, type as typeScale } from '../../src/theme';

/**
 * "Goals (shared)" — 10 Screens#Onboarding, step 4, and the last step before
 * Home.
 *
 * The only shared step: goals added by either partner appear live for both
 * (03 User Journey#2. Onboarding), which is the first moment the app feels like
 * one plan rather than two sets of accounts.
 */
export default function GoalsScreen() {
  const router = useRouter();
  const household = useHousehold();
  const members = useHouseholdMembers();
  const { goals } = useGoals();
  const { projection } = useProjection();
  const finishOnboarding = useReducer(reducers.finishOnboarding);

  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Never-stuck (Stage 8): this was a bare `return null`, which renders an
  // empty screen mid-onboarding with nothing to read and nothing to tap.
  // `Loading` explains itself after a few seconds and offers a reload.
  if (!household) return <Loading label="Opening your plan…" />;

  return (
    <Screen>
      <TitleBand plate="Step 4 of 4 · Together" title="What are you saving for?" onBack={() => router.back()}>
        <Body dim>
          Add a few together. Either of you can add one, and you'll both see it straight away.
        </Body>
      </TitleBand>

      <View style={styles.avatars}>
        {members.map(m => (
          <Avatar
            key={String(m.id)}
            name={m.displayName}
            color={memberColor(m.colorKey)}
            online={m.online}
            size={28}
          />
        ))}
        <Caption>both of you, same list</Caption>
      </View>

      <Button label="Add a goal" variant="secondary" icon="plus" onPress={() => setAddOpen(true)} />

      {goals.length === 0 ? (
        <Text style={styles.empty}>
          Nothing yet. A house, a trip, a car: rough numbers are fine, and you can change them any
          time.
        </Text>
      ) : (
        <>
          <SectionHeader>Your plan so far</SectionHeader>
          {goals.map(goal => {
            const result = goalResult(projection, goal.id);
            const addedBy = members.find(m => m.id === goal.createdBy);
            const funded = result?.funded !== false;
            return (
              <View key={String(goal.id)} style={styles.goal}>
                <Icon name={goalIcon(goal.icon)} size={24} color={addedBy ? memberColor(addedBy.colorKey) : colors.ink2} />
                <View style={styles.goalText}>
                  <Text style={styles.goalTitle}>{goal.title}</Text>
                  <Text style={styles.goalMeta}>
                    {planMonthLabel(household.currentMonth, goal.targetMonth)} · {dollars(goal.costTodayCents)} today
                    {addedBy ? ` · added by ${addedBy.displayName}` : ''}
                  </Text>
                </View>
                <View style={styles.goalAmount}>
                  <Text style={[styles.goalMonthly, tabularNums]}>
                    {result ? dollars(Math.round(result.requiredMonthlyAtStart * 100), { showCents: true }) : '—'}
                  </Text>
                  <Text style={styles.goalMeta}>a month</Text>
                </View>
                <Station color={funded ? colors.accent : colors.error} filled={!funded} />
              </View>
            );
          })}

          {projection ? (
            <Caption>
              {projection.atRiskGoalIds.length === 0
                ? `The projection funds all ${goals.length} of these, with ${dollars(
                    Math.round(projection.freeToPlan * 100)
                  )} a month still unspoken for.`
                : `${projection.atRiskGoalIds.length} of these doesn't fit yet — you'll be able to work through that on Home.`}
            </Caption>
          ) : null}
        </>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Button
        label={goals.length === 0 ? 'Skip for now' : 'Done, show our plan'}
        variant={goals.length === 0 ? 'secondary' : 'primary'}
        onPress={async () => {
          setError(null);
          try {
            await finishOnboarding();
            router.replace('/');
          } catch (e) {
            const text = e instanceof Error ? e.message : String(e);
            setError(text.replace(/^.*SenderError:\s*/, ''));
          }
        }}
      />

      <AddGoalSheet visible={addOpen} onClose={() => setAddOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatars: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  empty: { ...typeScale.bodyItalic, color: colors.ink2, marginTop: space.lg },
  goal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingVertical: space.sm,
    borderBottomWidth: line.hair,
    borderBottomColor: colors.rule,
  },
  goalText: { flex: 1 },
  goalTitle: { ...typeScale.headline, fontSize: 17, color: colors.ink },
  goalMeta: { ...typeScale.caption, color: colors.ink2 },
  goalAmount: { alignItems: 'flex-end' },
  goalMonthly: { ...typeScale.numeral, fontSize: 18, color: colors.ink },
});
