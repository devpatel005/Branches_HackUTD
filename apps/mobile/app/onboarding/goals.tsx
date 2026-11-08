import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
  Row,
  Screen,
  SectionHeader,
  Title,
} from '../../src/components';
import { AddGoalSheet } from '../../src/goal-picker';
import { memberColor, useHousehold, useHouseholdMembers } from '../../src/household';
import { goalResult, planMonthLabel, useGoals, useProjection } from '../../src/projection';
import { dollars, perMonth } from '../../src/format';
import { colors, space } from '../../src/theme';

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
      <Title>What are you saving for?</Title>
      <Body dim>
        Add a few together. Either of you can add one, and you'll both see it straight away.
      </Body>

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

      <Button label="Add a goal" onPress={() => setAddOpen(true)} />

      {goals.length === 0 ? (
        <Notice>
          Nothing yet. A house, a trip, a car — rough numbers are fine, and you can change them
          any time.
        </Notice>
      ) : (
        <>
          <SectionHeader>Your plan so far</SectionHeader>
          {goals.map(goal => {
            const result = goalResult(projection, goal.id);
            const addedBy = members.find(m => m.id === goal.createdBy);
            return (
              <Row
                key={String(goal.id)}
                label={`${goal.icon} ${goal.title}`}
                sublabel={`${planMonthLabel(household.currentMonth, goal.targetMonth)} · ${dollars(
                  goal.costTodayCents
                )} today${addedBy ? ` · added by ${addedBy.displayName}` : ''}`}
                value={result ? perMonth(Math.round(result.requiredMonthlyAtStart * 100)) : '—'}
                right={
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          result?.funded === false ? colors.negative : colors.accent,
                      },
                    ]}
                  />
                }
              />
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

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <Button
        label={goals.length === 0 ? 'Skip for now' : 'Done'}
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
  avatars: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
