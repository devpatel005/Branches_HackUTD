import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import type { PrivatePurchase } from '@branches/mock-data';
import {
  Body,
  Button,
  Caption,
  Hero,
  Notice,
  ProgressPill,
  Row,
  Screen,
  SectionHeader,
  TitleBand,
} from '../../src/components';
import { Icon } from '../../src/icons';
import {
  memberColor,
  useHousehold,
  useMe,
  useMyFunMoney,
  useProgress,
} from '../../src/household';
import { dollars } from '../../src/format';
import {
  funMoneyStatus,
  loadPrivatePurchases,
  totalCents,
} from '../../src/private-purchases';
import { colors, space, tabularNums, type as typeScale, radius } from '../../src/theme';

const STEP_CENTS = 2500;
const DEFAULT_CENTS = 30000;

/**
 * "Your fun money" — 10 Screens#Onboarding, step 3 (Washington Evergreen & Privacy Architecture).
 *
 * The amount is shared. The purchases are not, and never will be: they live
 * only in device-local storage, and the only thing this screen reports upward
 * is a `within` / `over` status (02 Ground Rules #3).
 */
export default function FunMoneyScreen() {
  const router = useRouter();
  const { me } = useMe();
  const household = useHousehold();
  const { funMoney } = useMyFunMoney();
  const progress = useProgress();

  const setFunMoney = useReducer(reducers.setFunMoney);
  const setFunMoneyStatus = useReducer(reducers.setFunMoneyStatus);

  const [cents, setCents] = useState(funMoney?.monthlyCents ?? DEFAULT_CENTS);
  const [purchases, setPurchases] = useState<PrivatePurchase[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load this member's own purchases from local storage only.
  useEffect(() => {
    if (!me || !household) return;
    let cancelled = false;
    loadPrivatePurchases(String(me.id), household.currentMonth).then(list => {
      if (!cancelled) setPurchases(list);
    });
    return () => {
      cancelled = true;
    };
  }, [me?.id, household?.currentMonth]);

  useEffect(() => {
    if (funMoney) setCents(funMoney.monthlyCents);
  }, [funMoney?.monthlyCents]);

  const spent = totalCents(purchases);
  const { status, carryoverCents } = funMoneyStatus(purchases, cents);

  async function saveAndContinue() {
    setError(null);
    try {
      await setFunMoney({ monthlyCents: cents });
      await setFunMoneyStatus({ status, carryoverCents });
      router.push('/onboarding/goals');
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <Screen>
      <TitleBand plate="Step 3 of 4" title="Your fun money." onBack={() => router.back()}>
        <Body dim>
          A monthly amount that's yours to spend without a conversation. Your partner sees the
          amount and whether you're within it, never what you buy.
        </Body>
      </TitleBand>

      <View style={styles.stepper}>
        <StepButton
          icon="minus"
          onPress={() => setCents(c => Math.max(0, c - STEP_CENTS))}
          label="Decrease fun money"
        />
        <View style={styles.amount}>
          <Hero value={dollars(cents)} caption="a month, each" />
        </View>
        <StepButton
          icon="plus"
          onPress={() => setCents(c => c + STEP_CENTS)}
          label="Increase fun money"
        />
      </View>

      <SectionHeader>My purchases this month</SectionHeader>
      <View style={styles.privateNote}>
        <Icon name="lock" size={16} color={colors.ink2} />
        <Caption>On this device only. Not in the shared plan, and never shown to the assistant.</Caption>
      </View>

      {purchases.map(p => (
        <Row
          key={p.id}
          label={p.merchant}
          sublabel={p.date}
          value={dollars(Math.round(p.amount * 100))}
        />
      ))}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Spent so far</Text>
        <Text
          style={[
            styles.totalValue,
            tabularNums,
            status === 'over' ? { color: colors.negative } : null,
          ]}
        >
          {dollars(spent)}
        </Text>
      </View>

      {status === 'over' ? (
        <Notice tone="warn">
          You're {dollars(carryoverCents)} over this month, so next month's fun money drops by
          that much. The shared plan doesn't change, and your partner isn't told.
        </Notice>
      ) : null}

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <Button label="Set my fun money" onPress={saveAndContinue} />

      <View style={styles.progressRow}>
        {progress.partners.map(p => (
          <ProgressPill
            key={String(p.memberId)}
            name={p.displayName}
            color={memberColor(p.colorKey)}
            done={p.funMoneySet ? 1 : 0}
            total={1}
            online={p.online}
          />
        ))}
      </View>
    </Screen>
  );
}

function StepButton({
  icon,
  onPress,
  label,
}: {
  icon: 'plus' | 'minus';
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.stepButton, pressed && { backgroundColor: colors.surfaceHover }]}
    >
      <Icon name={icon} size={22} color={colors.ink} />
    </Pressable>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xl,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  amount: { flex: 1, alignItems: 'center' },
  stepButton: {
    width: 56,
    height: 56,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.ruleStrong,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateNote: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  totalLabel: { ...typeScale.body, color: colors.textSecondary },
  totalValue: { ...typeScale.numeral, fontSize: 18, color: colors.textPrimary },
  progressRow: { flexDirection: 'row', gap: space.md, marginTop: space.xl, flexWrap: 'wrap' },
});
