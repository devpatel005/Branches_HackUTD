import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import { Button, Caption, Chip, Field, Notice, SectionHeader } from './components';
import { Sheet } from './sheets';
import { space } from './theme';

/**
 * The shared goal picker — 10 Screens#Onboarding, step 4.
 *
 * Chips over forms: tap a goal type, then a rough cost and a target year
 * (03 User Journey#Persona — nothing to type that the app could infer, and as
 * few taps as possible for the reluctant partner).
 *
 * Used in two places: the onboarding step, and the add-goal control on Timeline
 * so goals are not frozen once onboarding ends.
 */

export type GoalTemplate = {
  key: string;
  title: string;
  icon: string;
  /** A starting cost in dollars, so the picker opens with something sensible. */
  suggestedCost: number;
  suggestedYear: number;
  priority: 'must' | 'flex';
};

export const GOAL_TEMPLATES: readonly GoalTemplate[] = [
  { key: 'house', title: 'House', icon: '🏠', suggestedCost: 40000, suggestedYear: 5, priority: 'must' },
  { key: 'baby', title: 'Baby', icon: '🍼', suggestedCost: 10000, suggestedYear: 2, priority: 'must' },
  { key: 'travel', title: 'Travel', icon: '✈️', suggestedCost: 5000, suggestedYear: 2, priority: 'flex' },
  { key: 'car', title: 'Car', icon: '🚗', suggestedCost: 25000, suggestedYear: 4, priority: 'flex' },
  { key: 'wedding', title: 'Wedding', icon: '💍', suggestedCost: 20000, suggestedYear: 2, priority: 'flex' },
  { key: 'custom', title: 'Something else', icon: '⭐', suggestedCost: 5000, suggestedYear: 3, priority: 'flex' },
];

export function AddGoalSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const addGoal = useReducer(reducers.addGoal);

  const [template, setTemplate] = useState<GoalTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [cost, setCost] = useState('');
  const [year, setYear] = useState('');
  const [priority, setPriority] = useState<'must' | 'flex'>('flex');
  const [error, setError] = useState<string | null>(null);

  function pick(next: GoalTemplate) {
    setTemplate(next);
    setTitle(next.key === 'custom' ? '' : next.title);
    setCost(String(next.suggestedCost));
    setYear(String(next.suggestedYear));
    setPriority(next.priority);
    setError(null);
  }

  function reset() {
    setTemplate(null);
    setTitle('');
    setCost('');
    setYear('');
    setError(null);
  }

  async function save() {
    setError(null);
    const costDollars = Number(cost);
    const years = Number(year);
    if (!title.trim()) {
      setError('Give the goal a name.');
      return;
    }
    if (!Number.isFinite(costDollars) || costDollars <= 0) {
      setError('Enter a cost above zero.');
      return;
    }
    if (!Number.isInteger(years) || years < 1 || years > 10) {
      setError('Pick a year between 1 and 10.');
      return;
    }
    try {
      await addGoal({
        title: title.trim(),
        icon: template?.icon ?? '⭐',
        costTodayCents: Math.round(costDollars * 100),
        // "By year N" means the end of plan year N.
        targetMonth: years * 12,
        priority,
      });
      reset();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add a goal"
    >
      {!template ? (
        <>
          <Caption>What are you saving for?</Caption>
          <View style={styles.grid}>
            {GOAL_TEMPLATES.map(item => (
              <Chip key={item.key} label={`${item.icon}  ${item.title}`} onPress={() => pick(item)} />
            ))}
          </View>
        </>
      ) : (
        <>
          <SectionHeader>Name</SectionHeader>
          <Field value={title} onChangeText={setTitle} placeholder="Japan trip" />

          <SectionHeader>Roughly what will it cost, in today's money?</SectionHeader>
          <Field value={cost} onChangeText={setCost} keyboardType="number-pad" />
          <Caption>
            The projection grows this by inflation to the target date, so a rough figure is fine.
          </Caption>

          <SectionHeader>By which plan year?</SectionHeader>
          <Field value={year} onChangeText={setYear} keyboardType="number-pad" />
          <Caption>1 is the next twelve months; 10 is the end of the plan.</Caption>

          <SectionHeader>How firm is it?</SectionHeader>
          <View style={styles.chips}>
            <Chip label="Must-have" selected={priority === 'must'} onPress={() => setPriority('must')} />
            <Chip label="Flexible" selected={priority === 'flex'} onPress={() => setPriority('flex')} />
          </View>
          <Caption>
            Must-have goals are funded first, and can't be made smaller later — only moved.
          </Caption>

          {error ? <Notice tone="warn">{error}</Notice> : null}
          <Button label="Add it" onPress={save} />
          <Button label="Pick something else" variant="quiet" onPress={reset} />
        </>
      )}
    </Sheet>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  chips: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
});
