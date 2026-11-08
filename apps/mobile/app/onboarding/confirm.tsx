import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import {
  Body,
  Button,
  Caption,
  Field,
  Loading,
  Notice,
  ProgressPill,
  Row,
  Screen,
  SectionHeader,
  Title,
} from '../../src/components';
import {
  memberColor,
  shouldShowLoading,
  useHouseholdMembers,
  useMyItems,
  useProgress,
} from '../../src/household';
import { KIND_LABELS, KIND_ORDER, perMonth } from '../../src/format';
import { colors, space, type as typeScale } from '../../src/theme';

/**
 * "Confirm what we found" — 10 Screens#Onboarding, step 1.
 *
 * Mostly tapping: inference already found these from the transactions
 * (06 Engine Spec#Baseline inference), so the member only confirms, edits or
 * rejects. Each partner sees **only their own items** — that is enforced by
 * row-level security in the module, not by this screen (05 Data Model).
 *
 * The partner's progress still shows, from a view that exposes counts only.
 */
export default function ConfirmScreen() {
  const router = useRouter();
  const { items, ready } = useMyItems();
  const progress = useProgress();
  const members = useHouseholdMembers();

  const seedMockData = useReducer(reducers.seedMockData);
  const runInference = useReducer(reducers.runInference);
  const confirmAll = useReducer(reducers.confirmAllMyItems);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pending = items.filter(i => i.status === 'pending');
  const bothJoined = members.length >= 2;

  async function loadDemo() {
    setError(null);
    setBusy(true);
    try {
      await seedMockData({ profileId: 'test-household-a' });
      await runInference();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (shouldShowLoading(ready, items.length)) return <Loading label="Reading your accounts…" />;

  if (items.length === 0) {
    return (
      <Screen>
        <Title>Let's find what you already have</Title>
        <Body dim>
          Branches reads your transactions and works out your income, bills and loans, so you
          don't have to type them in.
        </Body>
        {bothJoined ? (
          <Button
            label={busy ? 'Looking…' : 'Load demo household'}
            onPress={loadDemo}
            disabled={busy}
          />
        ) : (
          <Notice>Waiting for your partner to join before we read both sides.</Notice>
        )}
        {error ? <Notice tone="warn">{error}</Notice> : null}
        <Notice>
          Dev only. Seeds the deterministic Test Household A fixture from 11 Mock Data and runs
          inference.
        </Notice>
      </Screen>
    );
  }

  const grouped = KIND_ORDER.map(kind => ({
    kind,
    rows: items.filter(i => i.kind === kind && i.status !== 'rejected'),
  })).filter(g => g.rows.length > 0);

  return (
    <Screen>
      <Title>Does this look right?</Title>
      <Body dim>Tap the check if it's right, the pencil to change it, or the cross to drop it.</Body>

      <View style={styles.progressRow}>
        {progress.partners.map(p => (
          <ProgressPill
            key={String(p.memberId)}
            name={p.displayName}
            color={memberColor(p.colorKey)}
            done={p.itemsConfirmed}
            total={p.itemsTotal}
            online={p.online}
          />
        ))}
      </View>

      {grouped.map(group => (
        <View key={group.kind}>
          <SectionHeader>{KIND_LABELS[group.kind] ?? group.kind}</SectionHeader>
          {group.rows.map(item => (
            <ItemRow key={String(item.id)} item={item} onError={setError} />
          ))}
        </View>
      ))}

      {error ? <Notice tone="warn">{error}</Notice> : null}

      {pending.length > 0 ? (
        <Button
          label={`Looks right — confirm ${pending.length} remaining`}
          onPress={async () => {
            setError(null);
            try {
              await confirmAll();
            } catch (e) {
              setError(messageOf(e));
            }
          }}
        />
      ) : (
        <Button label="Next" onPress={() => router.push('/onboarding/gaps')} />
      )}
    </Screen>
  );
}

type Item = ReturnType<typeof useMyItems>['items'][number];

function ItemRow({ item, onError }: { item: Item; onError: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.round(item.monthlyCents / 100)));

  const confirmItem = useReducer(reducers.confirmItem);
  const editItem = useReducer(reducers.editItem);
  const rejectItem = useReducer(reducers.rejectItem);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      onError(messageOf(e));
    }
  };

  if (editing) {
    return (
      <View style={styles.editBlock}>
        <Caption>{item.label} — monthly amount</Caption>
        <Field
          value={draft}
          onChangeText={setDraft}
          keyboardType="number-pad"
          placeholder="0"
        />
        <View style={styles.editActions}>
          <Button
            label="Save"
            onPress={async () => {
              const dollarsValue = Number(draft);
              if (!Number.isFinite(dollarsValue) || dollarsValue < 0) {
                onError('Enter a whole dollar amount.');
                return;
              }
              await run(() => editItem({ itemId: item.id, monthlyCents: Math.round(dollarsValue * 100) }));
              setEditing(false);
            }}
          />
          <Button label="Cancel" variant="quiet" onPress={() => setEditing(false)} />
        </View>
      </View>
    );
  }

  const confirmed = item.status === 'confirmed' || item.status === 'edited';

  return (
    <Row
      label={item.label}
      sublabel={item.status === 'edited' ? 'edited by you' : undefined}
      value={perMonth(item.monthlyCents)}
      right={
        <View style={styles.rowActions}>
          <IconAction
            glyph="✓"
            active={confirmed}
            activeColor={colors.accent}
            onPress={() => run(() => confirmItem({ itemId: item.id }))}
            label={`Confirm ${item.label}`}
          />
          <IconAction glyph="✎" onPress={() => setEditing(true)} label={`Edit ${item.label}`} />
          <IconAction
            glyph="✕"
            onPress={() => run(() => rejectItem({ itemId: item.id }))}
            label={`Remove ${item.label}`}
          />
        </View>
      }
    />
  );
}

function IconAction({
  glyph,
  onPress,
  active,
  activeColor,
  label,
}: {
  glyph: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconAction, pressed && { opacity: 0.5 }]}
    >
      <Text
        style={[
          styles.iconGlyph,
          active && activeColor ? { color: activeColor } : null,
        ]}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', gap: space.md, marginTop: space.md, flexWrap: 'wrap' },
  rowActions: { flexDirection: 'row', gap: space.xs },
  iconAction: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  iconGlyph: { ...typeScale.body, color: colors.textSecondary, fontSize: 18 },
  editBlock: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingVertical: space.md,
  },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
