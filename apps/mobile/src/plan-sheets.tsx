import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import { Body, Button, Caption, Chip, Field, Notice, Row, SectionHeader } from './components';
import { Sheet, ShowTheMath } from './sheets';
import { useHousehold } from './household';
import {
  goalResult,
  planMonthLabel,
  provenanceFor,
  useAssumptions,
  useGoals,
  useProjection,
} from './projection';
import { dollars, perMonth } from './format';
import { space } from './theme';

/**
 * Goal Detail and Assumptions — 10 Screens#Sheets.
 *
 * Both are editable, and both route every number through the engine's
 * provenance for "Show the Math".
 */

export function GoalDetailSheet({
  goalId,
  onClose,
}: {
  goalId: bigint | null;
  onClose: () => void;
}) {
  const household = useHousehold();
  const { goals } = useGoals();
  const { projection } = useProjection();
  const editGoal = useReducer(reducers.editGoal);
  const removeGoal = useReducer(reducers.removeGoal);

  const goal = goals.find(g => g.id === goalId);

  const [cost, setCost] = useState('');
  const [year, setYear] = useState('');
  const [priority, setPriority] = useState<'must' | 'flex'>('flex');
  const [math, setMath] = useState<{ label: string; path: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hooks must run before the early return, so this re-reads `goal` defensively
  // rather than relying on the narrowing below.
  const costCents = goal?.costTodayCents;
  const targetMonth = goal?.targetMonth;
  const goalPriority = goal?.priority;

  useEffect(() => {
    if (costCents === undefined || targetMonth === undefined) return;
    setCost(String(Math.round(costCents / 100)));
    setYear(String(Math.max(1, Math.ceil(targetMonth / 12))));
    setPriority(goalPriority === 'must' ? 'must' : 'flex');
    setError(null);
  }, [goal?.id, costCents, targetMonth, goalPriority]);

  if (!goal || !household) return null;
  const result = goalResult(projection, goal.id);

  async function save() {
    if (!goal) return;
    setError(null);
    const costDollars = Number(cost);
    const years = Number(year);
    if (!Number.isFinite(costDollars) || costDollars <= 0) {
      setError('Enter a cost above zero.');
      return;
    }
    if (!Number.isInteger(years) || years < 1 || years > 10) {
      setError('Pick a year between 1 and 10.');
      return;
    }
    try {
      await editGoal({
        goalId: goal.id,
        title: goal.title,
        costTodayCents: Math.round(costDollars * 100),
        // A target *year* becomes the last month of that plan year, so "year 2"
        // means "by the end of year 2" rather than its first month.
        targetMonth: years * 12,
        priority,
      });
      onClose();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <>
      <Sheet visible={goalId !== null} onClose={onClose} title={goal.title}>
        <SectionHeader>The projection</SectionHeader>
        <Row
          label="Cost today"
          value={dollars(goal.costTodayCents)}
          onPress={() => setMath({ label: 'Cost at the target date', path: `goals.${goal.id}.inflatedCost` })}
        />
        <Row
          label="Cost at the target date"
          sublabel="today's cost grown by inflation"
          value={result ? dollars(Math.round(result.inflatedCost * 100)) : '—'}
          onPress={() => setMath({ label: 'Cost at the target date', path: `goals.${goal.id}.inflatedCost` })}
        />
        <Row
          label="Needed each month"
          value={result ? perMonth(Math.round(result.requiredMonthlyAtStart * 100)) : '—'}
          onPress={() =>
            setMath({ label: 'Needed each month', path: `goals.${goal.id}.requiredMonthlyAtStart` })
          }
        />
        <Row
          label="Target"
          value={planMonthLabel(household.currentMonth, goal.targetMonth)}
        />
        <Row
          label="On track?"
          value={result ? (result.funded ? 'Funded' : 'Doesn’t fit yet') : '—'}
          sublabel={
            result && !result.funded
              ? `short by ${dollars(Math.round(result.shortfall * 100))}`
              : undefined
          }
          onPress={
            result && !result.funded
              ? () => setMath({ label: 'Shortfall', path: `goals.${goal.id}.shortfall` })
              : undefined
          }
        />
        <Caption>Tap any number to see how it's worked out.</Caption>

        <SectionHeader>Change it</SectionHeader>
        <Caption>Cost today (dollars)</Caption>
        <Field value={cost} onChangeText={setCost} keyboardType="number-pad" label="Cost today in dollars" />
        <Caption>Target plan year (1-10)</Caption>
        <Field value={year} onChangeText={setYear} keyboardType="number-pad" label="Target plan year, 1 to 10" />
        <Caption>Priority</Caption>
        <View style={styles.chips}>
          <Chip label="Must-have" selected={priority === 'must'} onPress={() => setPriority('must')} />
          <Chip label="Flexible" selected={priority === 'flex'} onPress={() => setPriority('flex')} />
        </View>

        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button label="Save changes" onPress={save} />
        <Button
          label="Remove this goal"
          variant="quiet"
          onPress={async () => {
            setError(null);
            try {
              await removeGoal({ goalId: goal.id });
              onClose();
            } catch (e) {
              setError(messageOf(e));
            }
          }}
        />
      </Sheet>

      <ShowTheMath
        visible={math !== null}
        onClose={() => setMath(null)}
        label={math?.label ?? ''}
        record={math ? provenanceFor(projection, math.path) : undefined}
      />
    </>
  );
}

/**
 * Assumptions — editing one recomputes the plan live for both partners
 * (10 Screens#Sheets).
 *
 * Labelled as assumptions, not quoted rates: the savings rate in particular is
 * an *assumed* rate and not a PNC figure (02 Ground Rules #8, OPEN(OD-7)).
 */
export function AssumptionsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { assumptions } = useAssumptions();
  const setAssumptions = useReducer(reducers.setAssumptions);

  const [savings, setSavings] = useState('');
  const [inflation, setInflation] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assumptions) return;
    setSavings((assumptions.savingsRateBps / 100).toFixed(2));
    setInflation((assumptions.inflationBps / 100).toFixed(2));
    setError(null);
  }, [assumptions?.savingsRateBps, assumptions?.inflationBps]);

  async function save() {
    if (!assumptions) return;
    setError(null);
    const savingsPct = Number(savings);
    const inflationPct = Number(inflation);
    if (!Number.isFinite(savingsPct) || savingsPct < 0 || savingsPct > 50) {
      setError('Savings rate must be between 0% and 50%.');
      return;
    }
    if (!Number.isFinite(inflationPct) || inflationPct < 0 || inflationPct > 50) {
      setError('Inflation must be between 0% and 50%.');
      return;
    }
    try {
      await setAssumptions({
        savingsRateBps: Math.round(savingsPct * 100),
        inflationBps: Math.round(inflationPct * 100),
        mortgageRateBps: assumptions.mortgageRateBps,
        carRateBps: assumptions.carRateBps,
      });
      onClose();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Assumptions">
      <Body dim>
        These are assumptions, not quoted rates. Change them and the projection updates for both
        of you.
      </Body>

      <SectionHeader>Savings rate (assumed, annual %)</SectionHeader>
      <Field value={savings} onChangeText={setSavings} keyboardType="number-pad" label="Savings rate, annual percent" />
      <Caption>What set-aside money is assumed to earn. Compounded monthly.</Caption>

      <SectionHeader>Inflation (annual %)</SectionHeader>
      <Field value={inflation} onChangeText={setInflation} keyboardType="number-pad" label="Inflation, annual percent" />
      <Caption>Applied to goal costs only, so a goal costs more the later it lands.</Caption>

      {assumptions ? (
        <>
          <SectionHeader>Loan rates</SectionHeader>
          <Row label="Mortgage" value={`${(assumptions.mortgageRateBps / 100).toFixed(2)}%`} />
          <Row label="Car loan" value={`${(assumptions.carRateBps / 100).toFixed(2)}%`} />
          <Caption>Used by life events that create a loan. Editable from Stage 4.</Caption>
        </>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label="Apply to our plan" onPress={save} />
    </Sheet>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
});
