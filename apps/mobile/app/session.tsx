import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import type { Constraint } from '@branches/engine';
import {
  Avatar,
  Body,
  Button,
  Caption,
  Chip,
  Loading,
  Notice,
  Row,
  Screen,
  SectionHeader,
  Title,
} from '../src/components';
import { Sheet } from '../src/sheets';
import {
  branchStatLine,
  constraintLabel,
  useBranches,
  useConstraints,
  useOpenSession,
  type BranchView,
} from '../src/session';
import { useActiveEvent, useImpact } from '../src/events';
import { memberColor, useHouseholdMembers, useMe } from '../src/household';
import { useGoals } from '../src/projection';
import { dollars } from '../src/format';
import { colors, space, tabularNums, type as typeScale } from '../src/theme';

/**
 * The planning session — 10 Screens#Session.
 *
 * Stage 5 drives it from one device: pick a path, lock an effect, reroll, pin a
 * non-negotiable, tune a slider, and commit with a temporary single-user
 * confirm. Stage 7 replaces that confirm with the simultaneous ready check and
 * adds presence, live selections and reactions to these same rows.
 */
export default function SessionScreen() {
  const router = useRouter();
  const { me } = useMe();
  const members = useHouseholdMembers();
  const { session, ready } = useOpenSession();
  const { event } = useActiveEvent();
  const { impact } = useImpact(event?.id);
  const { branches } = useBranches(session?.id);
  const constraints = useConstraints(session?.id);
  const { goals } = useGoals();

  const generateCandidates = useReducer(reducers.generateCandidates);
  const reroll = useReducer(reducers.reroll);
  const addConstraint = useReducer(reducers.addConstraint);
  const removeConstraint = useReducer(reducers.removeConstraint);
  const requestBridge = useReducer(reducers.requestBridge);
  const commitBranch = useReducer(reducers.commitBranch);
  const closeSession = useReducer(reducers.closeSession);

  const [selected, setSelected] = useState<bigint | null>(null);
  const [openDetail, setOpenDetail] = useState<bigint | null>(null);
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const titleOf = (goalId: string) =>
    goals.find(g => String(g.id) === goalId)?.title ?? 'a goal';

  // Generate the first batch once, when the session has none.
  const generated = useRef(new Set<string>());
  useEffect(() => {
    if (!session || branches.length > 0) return;
    const key = String(session.id);
    if (generated.current.has(key)) return;
    generated.current.add(key);
    generateCandidates({ sessionId: session.id }).catch(e => setError(messageOf(e)));
  }, [session?.id, branches.length, generateCandidates]);

  if (!ready && !session) return <Loading label="Opening the session…" />;
  if (!session) {
    return (
      <Screen>
        <Title>No session open</Title>
        <Body dim>Start one from an impact card in Chat.</Body>
        <Button label="Back to Chat" onPress={() => router.replace('/chat')} />
      </Screen>
    );
  }

  const myPin = constraints.find(c => c.kind === 'pin' && c.memberId === me?.id);
  const locks = constraints.filter(c => c.kind === 'lock');
  const pins = constraints.filter(c => c.kind === 'pin');
  const selectedBranch = branches.find(x => x.id === selected);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

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
              size={28}
            />
          ))}
        </View>
        <Pressable onPress={() => run(async () => { await closeSession({ sessionId: session.id }); router.replace('/chat'); })}>
          <Caption>Close</Caption>
        </Pressable>
      </View>

      <Title>Paths forward</Title>
      {impact ? (
        <Body dim>
          {impact.noImpact
            ? 'Nothing is at risk — you can keep the plan as it is.'
            : `${impact.newlyAtRiskGoalIds.map(titleOf).join(' and ')} stopped fitting. Here's what would make it work.`}
        </Body>
      ) : null}

      {locks.length > 0 ? (
        <>
          <SectionHeader>Keeping</SectionHeader>
          <View style={styles.chipRow}>
            {locks.map(lock => (
              <Chip
                key={String(lock.id)}
                label={`🔒 ${constraintLabel(lock.target, titleOf)}`}
                selected
                tint={memberColor(members.find(m => m.id === lock.memberId)?.colorKey ?? 'a')}
                onPress={() => run(() => removeConstraint({ constraintId: lock.id }))}
              />
            ))}
          </View>
        </>
      ) : null}

      {pins.length > 0 ? (
        <>
          <SectionHeader>Non-negotiables</SectionHeader>
          <View style={styles.chipRow}>
            {pins.map(pin => (
              <Chip
                key={String(pin.id)}
                label={`📌 ${constraintLabel(pin.target, titleOf)} · ${
                  members.find(m => m.id === pin.memberId)?.displayName ?? ''
                }`}
                selected
                tint={memberColor(members.find(m => m.id === pin.memberId)?.colorKey ?? 'a')}
                onPress={() => run(() => removeConstraint({ constraintId: pin.id }))}
              />
            ))}
          </View>
          <Button
            label="Find a path that honours both"
            variant="secondary"
            onPress={() => run(() => requestBridge({ sessionId: session.id }))}
          />
        </>
      ) : null}

      <SectionHeader>{branches.length === 0 ? 'Working it out' : 'Pick one'}</SectionHeader>
      {branches.length === 0 ? (
        <Caption>Looking for paths forward…</Caption>
      ) : (
        branches.map(branch => (
          <BranchCard
            key={String(branch.id)}
            branch={branch}
            selected={selected === branch.id}
            titleOf={titleOf}
            onSelect={() => setSelected(branch.id)}
            onOpen={() => setOpenDetail(branch.id)}
            onLock={target =>
              run(() =>
                addConstraint({
                  sessionId: session.id,
                  kind: 'lock',
                  target: JSON.stringify(target),
                })
              )
            }
          />
        ))
      )}

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <View style={styles.actions}>
        <Button
          label="Show me other paths"
          variant="secondary"
          onPress={() => run(() => reroll({ sessionId: session.id }))}
          disabled={busy}
        />
        <Button
          label={myPin ? 'Change what matters most' : 'Pin what matters most'}
          variant="quiet"
          onPress={() => setPinSheetOpen(true)}
        />
      </View>

      {selectedBranch ? (
        <>
          <SectionHeader>Make it the plan</SectionHeader>
          <Notice>
            A single tap for now. From Stage 7 this becomes a press-and-hold that both of you do
            at the same time.
          </Notice>
          <Button
            label={`Make "${selectedBranch.name}" our plan`}
            onPress={() =>
              run(async () => {
                await commitBranch({ branchId: selectedBranch.id });
                router.replace('/');
              })
            }
            disabled={busy}
          />
        </>
      ) : null}

      <BranchDetailSheet
        branch={branches.find(x => x.id === openDetail)}
        onClose={() => setOpenDetail(null)}
        titleOf={titleOf}
      />
      <PinSheet
        visible={pinSheetOpen}
        onClose={() => setPinSheetOpen(false)}
        sessionId={session.id}
        goals={goals.map(g => ({ id: String(g.id), title: g.title, priority: g.priority }))}
      />
    </Screen>
  );
}

/** A branch card — the thing you choose, so the one place cards are used. */
function BranchCard({
  branch,
  selected,
  titleOf,
  onSelect,
  onOpen,
  onLock,
}: {
  branch: BranchView;
  selected: boolean;
  titleOf: (goalId: string) => string;
  onSelect: () => void;
  onOpen: () => void;
  onLock: (target: Constraint) => void;
}) {
  const atRisk = branch.stats.atRiskGoalIds.length > 0;
  const lockables: Constraint[] = Object.keys(branch.stats.goalDateChanges).length === 0
    ? []
    : Object.keys(branch.stats.goalDateChanges).map(goalId => ({ kind: 'goalOnTime', goalId }));

  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.cardName}>{branch.name}</Text>
        {branch.source === 'custom' ? <Caption>tuned</Caption> : null}
        {branch.source === 'bridge' ? <Caption>bridge</Caption> : null}
      </View>
      <Text style={styles.cardSummary}>{branch.summary}</Text>

      <View style={styles.statChips}>
        {branchStatLine(branch.stats, titleOf).map(part => (
          <Text key={part} style={[styles.statChip, tabularNums, atRisk && styles.statChipAtRisk]}>
            {part}
          </Text>
        ))}
      </View>

      {atRisk ? (
        <Caption color={colors.negative}>
          Still short: {branch.stats.atRiskGoalIds.map(titleOf).join(', ')}
        </Caption>
      ) : null}

      <View style={styles.cardActions}>
        <Chip label="Adjust" onPress={onOpen} />
        {lockables.map(target => (
          <Chip
            key={JSON.stringify(target)}
            label={`🔒 Keep ${titleOf((target as { goalId: string }).goalId)} on time`}
            onPress={() => onLock(target)}
          />
        ))}
      </View>
    </Pressable>
  );
}

/**
 * Sliders for a branch's levers — 08 Live Session Spec#Live tuning.
 *
 * Stepper buttons rather than a drag track: a slider needs a gesture library
 * for a good feel, and Stage 8 owns that. The reducer clamps every value to the
 * lever's domain, so neither this nor a real slider can send something invalid.
 */
function BranchDetailSheet({
  branch,
  onClose,
  titleOf,
}: {
  branch: BranchView | undefined;
  onClose: () => void;
  titleOf: (goalId: string) => string;
}) {
  const tuneLever = useReducer(reducers.tuneLever);
  const { goals } = useGoals();
  const [error, setError] = useState<string | null>(null);

  if (!branch) return null;

  const tune = async (lever: string, goalId: bigint | undefined, value: number) => {
    setError(null);
    try {
      await tuneLever({ branchId: branch.id, lever, goalId, value });
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const saveMore = branch.stats.saveMore;

  return (
    <Sheet visible onClose={onClose} title={branch.name}>
      <Body dim>{branch.summary}</Body>

      <SectionHeader>Save more each month</SectionHeader>
      <Stepper
        value={`$${saveMore}`}
        onDown={() => tune('saveMore', undefined, Math.max(0, saveMore - 25))}
        onUp={() => tune('saveMore', undefined, saveMore + 25)}
      />
      <Caption>In $25 steps, up to a quarter of your everyday spending.</Caption>

      {goals.map(goal => {
        const key = String(goal.id);
        const delay = branch.levers.delays?.[key] ?? 0;
        const shrink = branch.levers.shrinks?.[key] ?? 0;
        return (
          <View key={key}>
            <SectionHeader>{goal.title}</SectionHeader>
            <Stepper
              label="Move it later"
              value={`${delay} mo`}
              onDown={() => tune('delay', goal.id, Math.max(0, delay - 1))}
              onUp={() => tune('delay', goal.id, delay + 1)}
            />
            {goal.priority === 'flex' ? (
              <Stepper
                label="Make it smaller"
                value={`${shrink}%`}
                onDown={() => tune('shrink', goal.id, Math.max(0, shrink - 1))}
                onUp={() => tune('shrink', goal.id, shrink + 1)}
              />
            ) : (
              <Caption>A must-have goal can be moved, but not made smaller.</Caption>
            )}
          </View>
        );
      })}

      <SectionHeader>What it does</SectionHeader>
      <Row label="Free to plan" value={`${dollars(Math.round(branch.stats.freeToPlan * 100))}/mo`} />
      <Row label="Emergency fund, lowest" value={`${branch.stats.emergencyMonthsMin.toFixed(1)} mo`} />
      <Row label="Tight years" value={String(branch.stats.tightYears)} />
      <Row
        label="Goals funded"
        value={`${branch.stats.goalsFunded}/${branch.stats.goalsTotal}`}
        sublabel={
          branch.stats.atRiskGoalIds.length > 0
            ? `still short: ${branch.stats.atRiskGoalIds.map(titleOf).join(', ')}`
            : undefined
        }
      />

      {error ? <Notice tone="warn">{error}</Notice> : null}
    </Sheet>
  );
}

function Stepper({
  label,
  value,
  onDown,
  onUp,
}: {
  label?: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <View style={styles.stepper}>
      {label ? <Text style={styles.stepperLabel}>{label}</Text> : null}
      <View style={styles.stepperControls}>
        <Pressable onPress={onDown} style={styles.stepButton} accessibilityLabel={`decrease ${label ?? 'value'}`}>
          <Text style={styles.stepGlyph}>−</Text>
        </Pressable>
        <Text style={[styles.stepperValue, tabularNums]}>{value}</Text>
        <Pressable onPress={onUp} style={styles.stepButton} accessibilityLabel={`increase ${label ?? 'value'}`}>
          <Text style={styles.stepGlyph}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** One pin per member — a single non-negotiable (08 Live Session Spec). */
function PinSheet({
  visible,
  onClose,
  sessionId,
  goals,
}: {
  visible: boolean;
  onClose: () => void;
  sessionId: bigint;
  goals: { id: string; title: string; priority: string }[];
}) {
  const addConstraint = useReducer(reducers.addConstraint);
  const [error, setError] = useState<string | null>(null);

  const options: { label: string; target: Constraint }[] = [
    ...goals.map(g => ({ label: `${g.title} on time`, target: { kind: 'goalOnTime' as const, goalId: g.id } })),
    ...goals
      .filter(g => g.priority === 'flex')
      .map(g => ({ label: `${g.title} at full size`, target: { kind: 'goalFullSize' as const, goalId: g.id } })),
    { label: 'No extra saving', target: { kind: 'noExtraSaving' as const } },
    { label: 'Save at most $100/mo', target: { kind: 'saveMoreAtMost' as const, amount: 100 } },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title="What matters most?">
      <Body dim>
        Pick the one thing you don't want to move. You get one — and so does your partner.
      </Body>
      <View style={styles.chipRow}>
        {options.map(option => (
          <Chip
            key={option.label}
            label={option.label}
            onPress={async () => {
              setError(null);
              try {
                await addConstraint({
                  sessionId,
                  kind: 'pin',
                  target: JSON.stringify(option.target),
                });
                onClose();
              } catch (e) {
                setError(messageOf(e));
              }
            }}
          />
        ))}
      </View>
      {error ? <Notice tone="warn">{error}</Notice> : null}
    </Sheet>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  avatars: { flexDirection: 'row', gap: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  actions: { marginTop: space.md },

  // Cards are used only for branches — the thing you choose
  // (09 Design System#Layout).
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: space.md,
    marginBottom: space.sm,
  },
  cardSelected: { backgroundColor: colors.surfaceRaised, borderColor: colors.accent },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { ...typeScale.headline, color: colors.textPrimary, flex: 1 },
  cardSummary: { ...typeScale.body, color: colors.textSecondary, marginTop: space.xs, lineHeight: 21 },
  statChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  statChip: { ...typeScale.caption, color: colors.textSecondary },
  statChipAtRisk: { color: colors.textSecondary },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },

  stepper: { marginTop: space.sm },
  stepperLabel: { ...typeScale.caption, color: colors.textSecondary, marginBottom: space.xs },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: { ...typeScale.headline, color: colors.textPrimary },
  stepperValue: { ...typeScale.body, color: colors.textPrimary, minWidth: 70, textAlign: 'center' },
});
