import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
  TitleBand,
} from '../src/components';
import { BranchPaths, type Lane } from '../src/forest';
import { Icon, REACTION_ICON } from '../src/icons';
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
import { breakpoints, colors, fonts, line, radius, space, tabularNums, type as typeScale } from '../src/theme';

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
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.laptop;

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
        <TitleBand plate="Planning session" title="No session open">
          <Body dim>Start one from an impact card in Chat, after you tell us what happened.</Body>
        </TitleBand>
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
      // Own key: open at the top, so the celebration is in view.
      <Screen key="committed">
        <TitleBand plate="Planning session · Done" title="This is your plan now.">
          {/* The decision, replayed: the chosen branch regrows and blooms while the
              others fade. Falls back to a single branch if the paths are gone. */}
          {chosen && branches.length > 0 ? (
            <BranchPaths
              lanes={branches.map(b => ({ color: b.id === chosen.id ? colors.accent : colors.ink3, chosen: b.id === chosen.id }))}
              celebrate={branches.findIndex(b => b.id === chosen.id)}
            />
          ) : (
            <BranchPaths lanes={[{ color: colors.accent, chosen: true }]} merged height={90} />
          )}
        </TitleBand>
        {chosen ? (
          <>
            <Text style={styles.cardName}>{chosen.name}</Text>
            <Text style={styles.cardSummary}>{chosen.summary}</Text>
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

  // One lane per branch card, coloured by who picked it (both = accent).
  const lanes: Lane[] = branches.map(b => {
    const pickers = participants.filter(p => p.state.selectedBranchId === b.id);
    if (pickers.length > 1) return { color: colors.accent, chosen: true };
    if (pickers.length === 1) return { color: memberColor(pickers[0]!.member.colorKey), chosen: true };
    return { color: colors.ink3 };
  });

  return (
    <Screen wide={wide}>
      <TitleBand
        plate="Planning session"
        title="Paths forward"
        top={
          <>
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
                    {p.state.ready ? <Icon name="check" size={16} color={colors.accent} /> : null}
                  </View>
                ))}
                {agent.running ? <View style={styles.agentDot} accessibilityLabel="Assistant is working" /> : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Leave session"
                style={({ pressed }) => [styles.leave, pressed && { backgroundColor: colors.surfaceHover }]}
                onPress={() =>
                  run(async () => {
                    await leaveSession({ sessionId: session.id });
                    router.replace('/chat');
                  })
                }
              >
                <Icon name="close" size={18} color={colors.ink2} />
                <Text style={styles.leaveText}>Leave</Text>
              </Pressable>
            </View>
          </>
        }
      >
        {impact ? (
          <Body dim>
            {impact.noImpact
              ? 'Nothing is at risk. You can keep the plan as it is.'
              : `${impact.newlyAtRiskGoalIds.map(titleOf).join(' and ')} stopped fitting. Here are the paths that make it work.`}
          </Body>
        ) : null}
      </TitleBand>

      {agent.progressText ? (
        <View style={styles.progressRow}>
          <View style={styles.agentDot} />
          <Text style={styles.progressText}>{agent.progressText}</Text>
        </View>
      ) : null}

      {/* The cards carry engine template names whether or not the assistant ever
          answers, so a quiet assistant costs the naming and nothing else.
          Saying so stops it reading as a frozen screen (verify:screens S4). */}
      {agent.stalled ? (
        <Notice tone="warn">
          The assistant has been quiet for {agent.quietSeconds} seconds. The paths below are the
          engine's own and are safe to choose. Only their names would have changed.
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
                icon="lock"
                label={constraintLabel(lock.target, titleOf)}
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
                icon="pin"
                label={`${constraintLabel(pin.target, titleOf)} · ${nameOf(pin.memberId)}`}
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

      <SectionHeader>{branches.length === 0 ? 'Working it out' : 'Pick one together'}</SectionHeader>
      {branches.length === 0 ? (
        <View>
          <BranchPaths lanes={[{ color: colors.ink3 }, { color: colors.ink3 }, { color: colors.ink3 }]} />
          <Text style={styles.waitingText}>Looking for paths forward…</Text>
          {/* Never-stuck (verify:screens S6): an empty list never resolves by
              waiting, so offer a retry and a way out. */}
          <Notice tone="warn">
            No paths yet. Try again, or go back and loosen what's locked. The engine needs at
            least one path that fits every lock.
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
        </View>
      ) : (
        <>
          <BranchPaths lanes={lanes} wilt />
          <View style={wide ? styles.cardsWide : undefined}>
            {branches.map(branch => (
          <BranchCard
            key={String(branch.id)}
            index={branches.indexOf(branch)}
            wide={wide}
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
            ))}
          </View>
        </>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}

      <View style={styles.actions}>
        <Button
          label="Show me other paths"
          variant="secondary"
          icon="leaf"
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
              ? `Not yet: ${check.reason}.`
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
  index,
  wide,
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
  index: number;
  wide: boolean;
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

  // Selected: a 2px border in the picker's colour. Both partners on one card:
  // top/left in the first colour, bottom/right in the second (09 Design System).
  const first = selectedBy[0] ? memberColor(selectedBy[0].member.colorKey) : undefined;
  const second = selectedBy[1] ? memberColor(selectedBy[1].member.colorKey) : first;
  const selectedStyle = first
    ? {
        backgroundColor: colors.surfaceRaised,
        borderTopColor: first,
        borderLeftColor: first,
        borderBottomColor: second,
        borderRightColor: second,
      }
    : null;

  return (
    <Pressable
      onPress={onSelect}
      // No button role: the card holds its own buttons (reactions, adjust, lock),
      // and a button inside a button is invalid on web.
      accessibilityLabel={`Path ${index + 1}: ${branch.name}. ${branch.summary}. Tap to pick it.`}
      style={({ pressed }) => [
        styles.card,
        wide && styles.cardWide,
        selectedStyle,
        pressed && { backgroundColor: colors.surfaceHover },
      ]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.cardPlate}>
          Path {index + 1}
          {branch.source === 'bridge' ? ' · bridge' : ''}
        </Text>
        {branch.tunedBy !== undefined ? (
          <Caption color={colourOf(branch.tunedBy)}>Tuned by {nameOf(branch.tunedBy)}</Caption>
        ) : null}
      </View>
      <Text style={styles.cardName}>{branch.name}</Text>
      <Text style={styles.cardSummary}>{branch.summary}</Text>

      <View style={styles.statList}>
        {branchStatLine(branch.stats, titleOf).map(part => (
          <Text key={part} style={styles.statLine}>
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
            const reaction = emoji ? REACTION_ICON[emoji] : undefined;
            return (
              <View key={String(p.member.id)} style={styles.pickedItem}>
                <Avatar
                  name={p.member.displayName}
                  color={memberColor(p.member.colorKey)}
                  online={p.state.present}
                  size={22}
                />
                {reaction ? (
                  <View accessibilityLabel={`${p.member.displayName}: ${reaction.label}`}>
                    <Icon name={reaction.icon} size={18} color={memberColor(p.member.colorKey)} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.cardActions}>
        {REACTIONS.map(emoji => (
          <Chip
            key={emoji}
            label=""
            icon={REACTION_ICON[emoji]?.icon ?? 'agree'}
            accessibilityLabel={REACTION_ICON[emoji]?.label ?? 'React'}
            selected={myReaction === emoji}
            onPress={() => onReact(emoji)}
          />
        ))}
        <Chip label="Adjust" icon="adjust" onPress={onOpen} />
        {lockables.map(target => (
          <Chip
            key={JSON.stringify(target)}
            icon="lock"
            label={`Keep ${titleOf((target as { goalId: string }).goalId)} on time`}
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
          <Icon name="minus" size={20} color={colors.ink} />
        </Pressable>
        <Text style={[styles.stepperValue, tabularNums]}>{value}</Text>
        <Pressable onPress={onUp} style={styles.stepButton} accessibilityLabel={`increase ${label ?? 'value'}`}>
          <Icon name="plus" size={20} color={colors.ink} />
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
        Pick the one thing you don't want to move. You get one, and so does your partner.
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
    marginTop: -space.lg,
    marginBottom: space.md,
  },
  avatars: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  presenceItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  agentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.agent },
  leave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 44,
    paddingHorizontal: space.sm,
    borderRadius: radius,
  },
  leaveText: { ...typeScale.label, color: colors.ink2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  progressText: { ...typeScale.bodyItalic, fontSize: 15, color: colors.ink2 },
  waitingText: { ...typeScale.bodyItalic, color: colors.ink2, marginTop: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  actions: { marginTop: space.lg },

  // Branch cards: the only boxes in the product, because they are the thing
  // you choose (09 Design System#Layout).
  cardsWide: { flexDirection: 'row', gap: space.lg, alignItems: 'stretch' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.rule,
    padding: space.lg,
    marginBottom: space.md,
  },
  cardWide: { flex: 1, marginBottom: 0 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  cardPlate: { ...typeScale.plate, color: colors.accent },
  cardName: { ...typeScale.title, fontSize: 24, lineHeight: 30, color: colors.ink, marginTop: space.xs },
  cardSummary: { ...typeScale.bodyItalic, fontSize: 16, lineHeight: 23, color: colors.ink2, marginTop: space.xs },
  statList: {
    marginTop: space.md,
    borderTopWidth: line.hair,
    borderTopColor: colors.rule,
    paddingTop: space.sm,
    gap: 2,
  },
  statLine: { fontFamily: fonts.textMedium, fontSize: 14, lineHeight: 21, color: colors.ink },
  pickedBy: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  pickedItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },

  stepper: { marginTop: space.sm },
  stepperLabel: { ...typeScale.caption, color: colors.ink2, marginBottom: space.xs },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepButton: {
    width: 44,
    height: 44,
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
    borderRadius: radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { ...typeScale.numeral, fontSize: 18, color: colors.ink, minWidth: 70, textAlign: 'center' },
});
