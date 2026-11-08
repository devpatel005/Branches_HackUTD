import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import {
  Avatar,
  Body,
  Button,
  Caption,
  Field,
  Hero,
  Loading,
  Notice,
  ProgressPill,
  Row,
  Screen,
  SectionHeader,
  TitleBand,
} from '../../src/components';
import { Icon, type IconName } from '../../src/icons';
import {
  memberColor,
  shouldShowLoading,
  useHousehold,
  useHouseholdMembers,
  useMyItems,
  useProgress,
} from '../../src/household';
import { deviceSlotLabel } from '../../src/device-slot';
import { KIND_LABELS, KIND_ORDER, perMonth } from '../../src/format';
import { colors, fonts, space, radius } from '../../src/theme';

/**
 * "Confirm what we found" — 10 Screens#Onboarding, step 1 (Washington Evergreen & Ruled Ledger).
 *
 * Mostly tapping: inference already found these from transactions (06 Engine Spec#Baseline inference),
 * so the member only confirms, edits or rejects. Each partner sees only their own items (row-level security).
 */
export default function ConfirmScreen() {
  const router = useRouter();
  const { items, ready } = useMyItems();
  const progress = useProgress();
  const members = useHouseholdMembers();
  const household = useHousehold();

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
        <TitleBand plate="Step 1 of 4" title="Let's find what you already have.">
          <Body dim>
            Branches reads your transactions and works out your income, bills and loans, so you
            don't have to type them in.
          </Body>
        </TitleBand>
        {bothJoined ? (
          <>
            <Button
              label={busy ? 'Looking…' : 'Load demo household'}
              onPress={loadDemo}
              disabled={busy}
            />
            {error ? <Notice tone="warn">{error}</Notice> : null}
            <Notice>
              Dev only. Seeds the deterministic Test Household A fixture from 11 Mock Data and
              runs inference.
            </Notice>
          </>
        ) : (
          <WaitingForPartner joinCode={household?.joinCode} />
        )}
      </Screen>
    );
  }

  const grouped = KIND_ORDER.map(kind => ({
    kind,
    rows: items.filter(i => i.kind === kind && i.status !== 'rejected'),
  })).filter(g => g.rows.length > 0);

  return (
    <Screen>
      <TitleBand plate="Step 1 of 4" title="Here's what we found.">
        <Body dim>
          We read 12 months of transactions. Tap the check if it's right, the pencil to change
          it, or the cross to drop it.
        </Body>
      </TitleBand>

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
          label={`Confirm the other ${pending.length}`}
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
        <Button label="Looks right, continue" onPress={() => router.push('/onboarding/gaps')} />
      )}
    </Screen>
  );
}

/**
 * A solo member used to land here with nothing to do and no way to find their
 * join code again — the code only ever appeared on Welcome, which the route
 * gate skips once you are a member. So it lives here too.
 */
function WaitingForPartner({ joinCode }: { joinCode?: string }) {
  const members = useHouseholdMembers();
  const slot = deviceSlotLabel();

  return (
    <View style={styles.waiting}>
      {joinCode ? <Hero value={joinCode} caption="Share this join code" /> : null}
      <Body dim>
        Both of you need to be here before we read both sides of the plan.
      </Body>

      <View style={styles.waitingAvatars}>
        {members.map(m => (
          <Avatar
            key={String(m.id)}
            name={m.displayName}
            color={memberColor(m.colorKey)}
            online={m.online}
            size={40}
          />
        ))}
      </View>
      <Caption>Waiting for your partner…</Caption>

      <Notice>
        Testing on one laptop? Browser tabs share storage, so a second tab would
        connect as you. Open{' '}
        <Text style={styles.code}>?device=b</Text> for an independent identity —
        e.g. http://localhost:8081/?device=b — or use an incognito window.
        {slot ? ` This tab is ${slot}.` : ''}
      </Notice>
    </View>
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
            icon="check"
            active={confirmed}
            activeColor={colors.accent}
            onPress={() => run(() => confirmItem({ itemId: item.id }))}
            label={`Confirm ${item.label}`}
          />
          <IconAction icon="pencil" onPress={() => setEditing(true)} label={`Edit ${item.label}`} />
          <IconAction
            icon="close"
            onPress={() => run(() => rejectItem({ itemId: item.id }))}
            label={`Remove ${item.label}`}
          />
        </View>
      }
    />
  );
}

function IconAction({
  icon,
  onPress,
  active,
  activeColor,
  label,
}: {
  icon: IconName;
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
      style={({ pressed }) => [
        styles.iconAction,
        active && styles.iconActionActive,
        pressed && { opacity: 0.6 },
      ]}
    >
      <Icon name={icon} size={20} color={active && activeColor ? activeColor : colors.ink2} />
    </Pressable>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', gap: space.md, marginTop: space.md, flexWrap: 'wrap' },
  rowActions: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  iconAction: {
    width: 44,
    height: 44,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  editBlock: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingVertical: space.md,
  },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  waiting: { marginTop: space.lg },
  waitingAvatars: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, marginBottom: space.sm },
  code: { color: colors.accent, fontFamily: fonts.textSemi },
});
