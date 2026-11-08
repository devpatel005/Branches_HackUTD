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
  Hero,
  Notice,
  Row,
  Screen,
  SectionHeader,
  Title,
} from '../../src/components';
import {
  memberColor,
  useBaseline,
  useHousehold,
  useHouseholdMembers,
  useMyFunMoney,
} from '../../src/household';
import { dollars, perMonth } from '../../src/format';
import { space } from '../../src/theme';

/**
 * Home — a Stage 2 placeholder.
 *
 * It shows the confirmed baseline so onboarding can be seen to have worked.
 * The real Home (hero "Free to plan", the scrubbable projection chart, the stat
 * row and the goal list) arrives in Stage 3, once goals exist and the engine
 * runs inside `recomputeProjection` (10 Screens#Home).
 */
export default function HomeScreen() {
  const router = useRouter();
  const household = useHousehold();
  const members = useHouseholdMembers();
  const { baseline } = useBaseline();
  const { funMoney } = useMyFunMoney();

  const reseed = useReducer(reducers.reseedHousehold);
  const [error, setError] = useState<string | null>(null);

  if (!household) return <Screen><Caption>Connecting…</Caption></Screen>;

  const incomeTotal = (baseline?.incomeByMember ?? []).reduce((sum, m) => sum + m.cents, 0);
  const funMoneyTotal = members.length * (funMoney?.monthlyCents ?? 0);

  // Shown, not computed here: Stage 3 moves this to the engine's `freeToPlan`,
  // which carries provenance. Until then it is labelled as a raw subtotal so
  // nobody mistakes it for a projection (02 Ground Rules #1).
  const surplus = baseline
    ? incomeTotal -
      baseline.fixedCents -
      baseline.debtCents -
      baseline.flexibleCents -
      baseline.retirementCents -
      funMoneyTotal
    : 0;

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
        <Caption>Code {household.joinCode}</Caption>
      </View>

      {baseline ? (
        <>
          <Hero value={dollars(surplus)} caption="left over each month, before goals" />

          <SectionHeader>Every month</SectionHeader>
          {(baseline.incomeByMember ?? []).map(entry => {
            const member = members.find(m => m.id === entry.memberId);
            return (
              <Row
                key={String(entry.memberId)}
                label={`${member?.displayName ?? 'Partner'} — income`}
                value={perMonth(entry.cents)}
              />
            );
          })}
          <Row label="Bills" value={perMonth(baseline.fixedCents)} />
          <Row label="Loan payments" value={perMonth(baseline.debtCents)} />
          <Row label="Everyday spending" value={perMonth(baseline.flexibleCents)} />
          <Row label="Set aside for retirement" value={perMonth(baseline.retirementCents)} />
          <Row
            label="Fun money"
            sublabel="amount shared, purchases private"
            value={perMonth(funMoneyTotal)}
          />

          <SectionHeader>Savings</SectionHeader>
          <Row label="Liquid savings" value={dollars(baseline.liquidSavingsCents)} />
        </>
      ) : (
        <Notice>No confirmed baseline yet. Finish onboarding to see it here.</Notice>
      )}

      <SectionHeader>Next</SectionHeader>
      <Body dim>
        Goals, the ten-year projection and "show the math" arrive in the next stage.
      </Body>

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <SectionHeader>Dev</SectionHeader>
      <Button
        label="Reset onboarding (keeps the household)"
        variant="secondary"
        onPress={async () => {
          setError(null);
          try {
            await reseed();
            router.replace('/onboarding/confirm');
          } catch (e) {
            const text = e instanceof Error ? e.message : String(e);
            setError(text.replace(/^.*SenderError:\s*/, ''));
          }
        }}
      />
      <Notice>
        Clears inferred items, gap answers and fun money, then sends both devices back through
        onboarding. The join code and both members survive, so the two devices stay paired.
      </Notice>
    </Screen>
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
});
