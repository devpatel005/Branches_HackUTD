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
  Field,
  Loading,
  Notice,
  Row,
  Screen,
  SectionHeader,
  Title,
} from '../src/components';
import { Sheet } from '../src/sheets';
import { ReadyRing, type RingMember } from '../src/ready-ring';
import {
  REACTIONS,
  branchStatLine,
  constraintLabel,
  readyCheckState,
  useBranches,
  useConstraints,
  useOpenSession,
  useReactions,
  useSessionMembers,
  type BranchView,
} from '../src/session';
import { useActiveEvent, useAgentActivity, useImpact } from '../src/events';
import { memberColor, useHouseholdMembers, useMe } from '../src/household';
import { useGoals } from '../src/projection';
import { dollars } from '../src/format';
import { colors, space, tabularNums, type as typeScale } from '../src/theme';

/**
 * The live planning session — 10 Screens#Session, 08 Live Session Spec.
 *
 * Two people deciding together: presence, selections that appear on each
 * other's screens, reactions, shared tuning marked "Tuned by …", locks and
 * rerolls, pins and bridges, and a ready check that commits only while both are
 * holding.
 *
 * Nothing here decides anything. Every state change goes through a reducer and
 * comes back over the subscription, which is why both devices agree.
 */
export default function SessionScreen() {
  const router = useRouter();
  const { me } = useMe();
  const householdMembers = useHouseholdMembers();
  const { session, ready } = useOpenSession();
  const { event } = useActiveEvent();
  const { impact } = useImpact(event?.id);
  const { branches } = useBranches(session?.id);
  const constraints = useConstraints(session?.id);
  const participants = useSessionMembers(session?.id);
  const reactions = useReactions(session?.id);
  const { goals } = useGoals();
  const agent = useAgentActivity();

  const generateCandidates = useReducer(reducers.generateCandidates);
  const reroll = useReducer(reducers.reroll);
  const addConstraint = useReducer(reducers.addConstraint);
  const removeConstraint = useReducer(reducers.removeConstraint);
  const requestBridge = useReducer(reducers.requestBridge);
  const requestBranchNaming = useReducer(reducers.requestBranchNaming);
  const joinSession = useReducer(reducers.joinSession);
  const leaveSession = useReducer(reducers.leaveSession);
  const selectBranch = useReducer(reducers.selectBranch);
  const react = useReducer(reducers.react);
  const setReady = useReducer(reducers.setReady);
  const commitSolo = useReducer(reducers.commitBranchSolo);
  const sendMessage = useReducer(reducers.sendMessage);

  const [openDetail, setOpenDetail] = useState<bigint | null>(null);
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const titleOf = (goalId: string) => goals.find(g => String(g.id) === goalId)?.title ?? 'a goal';
  const nameOf = (memberId: bigint) =>
    householdMembers.find(m => m.id === memberId)?.displayName ?? 'Partner';
  const colourOf = (memberId: bigint) =>
    memberColor(householdMembers.find(m => m.id === memberId)?.colorKey ?? 'a');

  // Join on arrival, leave on departure. Presence is what gates the ready
  // check, so it has to track the screen being open rather than the connection.
  useEffect(() => {
    if (!session) return;
    const id = session.id;
    joinSession({ sessionId: id }).catch(() => undefined);
    return () => {
      leaveSession({ sessionId: id }).catch(() => undefined);
    };
  }, [session?.id, joinSession, leaveSession]);

  // Generate the first batch once, when the session has none.
  const generated = useRef(new Set<string>());
  useEffect(() => {
    if (!session || branches.length > 0) return;
    const key = String(session.id);
    if (generated.current.has(key)) return;
    generated.current.add(key);
    generateCandidates({ sessionId: session.id })
      .then(() => requestBranchNaming({ sessionId: session.id }).catch(() => undefined))
      .catch(e => setError(messageOf(e)));
  }, [session?.id, branches.length, generateCandidates, requestBranchNaming]);

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

  const myState = participants.find(p => p.member.id === me?.id)?.state;
  const myPin = constraints.find(c => c.kind === 'pin' && c.memberId === me?.id);
  const locks = constraints.filter(c => c.kind === 'lock');
  const pins = constraints.filter(c => c.kind === 'pin');
  const committed = session.status !== 'open';
  const check = readyCheckState(participants);
  const selectedBranch = branches.find(b => b.id === check.branchId);
  const disagreement =
    participants.length > 1 &&
    participants.every(p => p.state.present && p.state.selectedBranchId !== undefined) &&
    new Set(participants.map(p => String(p.state.selectedBranchId))).size > 1;
  const soloMode = participants.filter(p => p.state.present).length === 1;

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

  const ringMembers: RingMember[] = participants.map(p => ({
    memberId: String(p.member.id),
    name: p.member.displayName,
    colour: memberColor(p.member.colorKey),
    ready: p.state.ready,
    isMe: p.member.id === me?.id,
  }));

  // ---- post-commit ------------------------------------------------------
  if (committed) {
    const chosen = branches.find(b => b.id === session.committedBranchId);
    return (
      <Screen>
        <Title>This is your plan now</Title>
        {chosen ? (
          <>
            <Body>{chosen.name}</Body>
            <Caption>{chosen.summary}</Caption>
            <SectionHeader>What it does</SectionHeader>
            {branchStatLine(chosen.stats, titleOf).map(part => (
              <Row key={part} label={part} />
            ))}
          </>
        ) : null}
        {agent.progressText ? <Caption>{agent.progressText}</Caption> : null}
        <Button label="View timeline" onPress={() => router.replace('/timeline')} />
        <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Presence header: avatars in member colours, absent ones dimmed. */}
      <View style={styles.header}>
        <View style={styles.avatars}>
          {participants.map(p => (
            <View key={String(p.member.id)} style={styles.presenceItem}>
              <Avatar
                name={p.member.displayName}
                color={memberColor(p.member.colorKey)}
                online={p.state.present}
                size={30}
              />
              {p.state.ready ? <Text style={styles.readyPip}>✓</Text> : null}
            </View>
          ))}
          {agent.running ? <Text style={styles.agentPip}>◇</Text> : null}
        </View>
        <Pressable
          onPress={() =>
            run(async () => {
              await leaveSession({ sessionId: session.id });
              router.replace('/chat');
            })
          }
        >
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

      {agent.progressText ? (
        <View style={styles.progressRow}>
          <Text style={styles.agentPip}>◇</Text>
          <Caption>{agent.progressText}</Caption>
        </View>
      ) : null}

      {/*
        The cards below carry engine template names whether or not the agent
        ever answers, so a quiet assistant costs the naming and nothing else.
        Saying so is what stops it reading as a frozen screen.
      */}
      {agent.stalled ? (
        <Notice tone="warn">
          The assistant has been quiet for {agent.quietSeconds} seconds. The paths below are
          the engine's own and are safe to choose — only their names would have changed.
        </Notice>
      ) : null}

      {disagreement ? (
        <Notice tone="warn">
          You've picked different paths. Each of you can pin the one thing that matters most, and
          the engine will look for a path that honours both.
        </Notice>
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
                tint={colourOf(lock.memberId)}
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
                label={`📌 ${constraintLabel(pin.target, titleOf)} · ${nameOf(pin.memberId)}`}
                selected
                tint={colourOf(pin.memberId)}
                onPress={
                  pin.memberId === me?.id
                    ? () => run(() => removeConstraint({ constraintId: pin.id }))
                    : undefined
                }
              />
            ))}
          </View>
          {pins.length >= participants.length ? (
            <Button
              label="Find a path that honours both"
              variant="secondary"
              onPress={() => run(() => requestBridge({ sessionId: session.id }))}
            />
          ) : null}
        </>
      ) : null}

      <SectionHeader>{branches.length === 0 ? 'Working it out' : 'Pick one'}</SectionHeader>
      {branches.length === 0 ? (
        <>
          <Caption>Looking for paths forward…</Caption>
          {/*
            Never-stuck (Stage 8). Branch cards normally arrive with engine
            template names the moment candidates are generated, so an empty list
            means generation itself produced nothing or never ran. Neither
            resolves by waiting, and this was the one screen where waiting was
            the only thing on offer.
          */}
          <Notice tone="warn">
            No paths yet. Try again, or go back and adjust what's locked — the engine needs
            at least one path that fits every constraint.
          </Notice>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() =>
              run(async () => {
                await generateCandidates({ sessionId: session.id });
                await requestBranchNaming({ sessionId: session.id }).catch(() => undefined);
              })
            }
            disabled={busy}
          />
          <Button label="Back to Chat" variant="quiet" onPress={() => router.replace('/chat')} />
        </>
      ) : (
        branches.map(branch => (
          <BranchCard
            key={String(branch.id)}
            branch={branch}
            selectedBy={participants.filter(p => p.state.selectedBranchId === branch.id)}
            reactions={reactions.get(String(branch.id)) ?? []}
            myReaction={
              (reactions.get(String(branch.id)) ?? []).find(r => r.memberId === me?.id)?.emoji
            }
            titleOf={titleOf}
            nameOf={nameOf}
            colourOf={colourOf}
            onSelect={() => run(() => selectBranch({ sessionId: session.id, branchId: branch.id }))}
            onReact={emoji =>
              run(() => react({ sessionId: session.id, branchId: branch.id, emoji }))
            }
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
          onPress={() =>
            run(async () => {
              await reroll({ sessionId: session.id });
              await requestBranchNaming({ sessionId: session.id }).catch(() => undefined);
            })
          }
          disabled={busy}
        />
        <Button
          label={myPin ? 'Change what matters most' : 'Pin what matters most'}
          variant="quiet"
          onPress={() => setPinSheetOpen(true)}
        />
      </View>

      <SectionHeader>None of these fit?</SectionHeader>
      <Field
        value={feedback}
        onChangeText={setFeedback}
        placeholder="Don't delay the house, we can cut eating out"
      />
      <Button
        label="Tell us what you want"
        variant="secondary"
        onPress={() =>
          run(async () => {
            if (!feedback.trim()) return;
            await sendMessage({ text: feedback });
            setFeedback('');
          })
        }
      />
      <Caption>
        {agent.running
          ? 'Branches is reading that…'
          : 'With no agent running, use the lock and pin chips on each card instead.'}
      </Caption>

      {/* The ready check. Visible only when everyone is here and agreed. */}
      {check.visible && selectedBranch ? (
        <>
          <SectionHeader>Make it the plan</SectionHeader>
          <ReadyRing
            members={ringMembers}
            branchName={selectedBranch.name}
            committed={false}
            onReady={isReady =>
              setReady({ sessionId: session.id, ready: isReady }).catch(e =>
                setError(messageOf(e))
              )
            }
          />
        </>
      ) : (
        <>
          <SectionHeader>Make it the plan</SectionHeader>
          <Notice>
            {check.reason
              ? `Not yet — ${check.reason}.`
              : 'Pick a path to see the hold-to-confirm control.'}
          </Notice>
          {soloMode && myState?.selectedBranchId !== undefined ? (
            <>
              <Button
                label="Commit on my own (dev)"
                variant="quiet"
                onPress={() =>
                  run(async () => {
                    await commitSolo({ branchId: myState.selectedBranchId! });
                  })
                }
              />
              <Notice>
                Dev only, and refused the moment your partner opens the session. The real path is
                the press-and-hold you both do at once.
              </Notice>
            </>
          ) : null}
        </>
      )}

      <BranchDetailSheet
        branch={branches.find(b => b.id === openDetail)}
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
  selectedBy,
  reactions,
  myReaction,
  titleOf,
  nameOf,
  colourOf,
  onSelect,
  onReact,
  onOpen,
  onLock,
}: {
  branch: BranchView;
  selectedBy: { member: { id: bigint; displayName: string; colorKey: string }; state: { present: boolean } }[];
  reactions: { memberId: bigint; emoji: string }[];
  myReaction: string | undefined;
  titleOf: (goalId: string) => string;
  nameOf: (memberId: bigint) => string;
  colourOf: (memberId: bigint) => string;
  onSelect: () => void;
  onReact: (emoji: string) => void;
  onOpen: () => void;
  onLock: (target: Constraint) => void;
}) {
  const atRisk = branch.stats.atRiskGoalIds.length > 0;
  const lockables: Constraint[] = Object.keys(branch.stats.goalDateChanges).map(goalId => ({
    kind: 'goalOnTime',
    goalId,
  }));

  // Both partners on one card: split the border between their colours by
  // showing the first and tinting the background (09 Design System).
  const borderColour =
    selectedBy.length === 0 ? 'transparent' : memberColor(selectedBy[0]!.member.colorKey);

  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.card,
        selectedBy.length > 0 && { backgroundColor: colors.surfaceRaised, borderColor: borderColour },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.cardName}>{branch.name}</Text>
        {branch.source === 'bridge' ? <Caption>bridge</Caption> : null}
        {branch.tunedBy !== undefined ? (
          <Caption color={colourOf(branch.tunedBy)}>Tuned by {nameOf(branch.tunedBy)}</Caption>
        ) : null}
      </View>
      <Text style={styles.cardSummary}>{branch.summary}</Text>

      <View style={styles.statChips}>
        {branchStatLine(branch.stats, titleOf).map(part => (
          <Text key={part} style={[styles.statChip, tabularNums]}>
            {part}
          </Text>
        ))}
      </View>

      {atRisk ? (
        <Caption color={colors.negative}>
          Still short: {branch.stats.atRiskGoalIds.map(titleOf).join(', ')}
        </Caption>
      ) : null}

      {/* Whoever picked this card, with their reaction beside them. */}
      {selectedBy.length > 0 ? (
        <View style={styles.pickedBy}>
          {selectedBy.map(p => {
            const emoji = reactions.find(r => r.memberId === p.member.id)?.emoji;
            return (
              <View key={String(p.member.id)} style={styles.pickedItem}>
                <Avatar
                  name={p.member.displayName}
                  color={memberColor(p.member.colorKey)}
                  online={p.state.present}
                  size={22}
                />
                {emoji ? <Text style={styles.reaction}>{emoji}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.cardActions}>
        {REACTIONS.map(emoji => (
          <Chip
            key={emoji}
            label={emoji}
            selected={myReaction === emoji}
            onPress={() => onReact(emoji)}
          />
        ))}
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
 * Steppers rather than a drag track: a slider needs a gesture library for a
 * decent feel, which is Stage 8's call. The reducer clamps every value to the
 * lever's domain, so neither form can send something invalid — and any change
 * clears both partners' ready flags.
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
      <Caption>
        Both of you see this move, and any change clears the ready check.
      </Caption>

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
  avatars: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  presenceItem: { flexDirection: 'row', alignItems: 'center' },
  readyPip: { ...typeScale.caption, color: colors.accent, marginLeft: 2 },
  agentPip: { ...typeScale.caption, color: colors.agent },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
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
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  cardName: { ...typeScale.headline, color: colors.textPrimary, flex: 1 },
  cardSummary: { ...typeScale.body, color: colors.textSecondary, marginTop: space.xs, lineHeight: 21 },
  statChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  statChip: { ...typeScale.caption, color: colors.textSecondary },
  pickedBy: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  pickedItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  reaction: { fontSize: 14 },
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
