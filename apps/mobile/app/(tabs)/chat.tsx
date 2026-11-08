import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import type { LifeEventTemplateId } from '@branches/engine';
import {
  Body,
  Button,
  Caption,
  Chip,
  Field,
  Loading,
  Notice,
  TitleBand,
} from '../../src/components';
import { Icon, eventIcon } from '../../src/icons';
import { Sheet } from '../../src/sheets';
import { AffordabilityCard, ImpactCard } from '../../src/impact-card';
import {
  EVENT_TEMPLATE_LIST,
  choiceLabel,
  formFieldsFor,
  useActiveEvent,
  useAgentActivity,
  useHasAgent,
  useImpact,
  useThread,
  type AffordabilityPayload,
  type FormField,
} from '../../src/events';
import { memberColor, useHouseholdMembers, useMe } from '../../src/household';
import { useGoals } from '../../src/projection';
import { COLUMN_MAX_WIDTH, colors, fonts, line, radius, space, type as typeScale } from '../../src/theme';

/**
 * Chat — 10 Screens#Chat.
 *
 * A shared thread: event entries, impact cards and affordability answers, all
 * visible to both partners. Stage 6 adds the agent as another author; nothing
 * here needs rebuilding for that.
 *
 * Until then the event form drives everything, and it stays as the permanent
 * fallback for when the agent is unavailable
 * (07 Agent Spec#Deterministic fallbacks).
 */
export default function ChatScreen() {
  const { me } = useMe();
  const members = useHouseholdMembers();
  const { messages, ready } = useThread();
  const { event } = useActiveEvent();
  const { impact } = useImpact(event?.id);
  const { goals } = useGoals();
  const agent = useAgentActivity();
  const hasAgent = useHasAgent();

  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [affordOpen, setAffordOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);

  const sendMessage = useReducer(reducers.sendMessage);
  const answerEventParam = useReducer(reducers.answerEventParam);

  /**
   * Answer a follow-up by tapping a chip.
   *
   * The agent asked for one named parameter, so the chip's label maps back to a
   * value the engine understands. Once nothing is outstanding the impact effect
   * below picks it up and computes.
   */
  async function answerChip(eventId: bigint, chip: string): Promise<void> {
    setError(null);
    const parsed = parseChip(chip);
    if (!parsed) {
      setError("I couldn't read that answer. Use \"Something came up\" to set it directly.");
      return;
    }
    try {
      await answerEventParam({ eventId, key: parsed.key, value: parsed.value });
    } catch (e) {
      setError(messageOf(e));
    }
  }

  // No impact effect here any more. The module computes the impact and opens
  // the session in the same transaction that understands the event (Stage R,
  // R1), so this screen no longer has to be open for the chain to run — which
  // was the bug: nothing happened unless someone was looking at Chat.

  async function send() {
    setError(null);
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage({ text: draft });
      setDraft('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSending(false);
    }
  }

  if (!me) return <Loading label="Connecting…" />;

  const nameOf = (id: bigint | undefined) =>
    members.find(m => m.id === id)?.displayName ?? 'Branches';
  const colorOf = (id: bigint | undefined) => {
    const member = members.find(m => m.id === id);
    return member ? memberColor(member.colorKey) : colors.agent;
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xl }]}
        keyboardShouldPersistTaps="handled"
        // New messages arrive at the bottom, like any chat.
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <TitleBand plate="No. 3 · Chat" title="What's happening?">
          <Body dim>
            Tell Branches when something changes. It works out what it means for your plan, and you
            both see the same thread.
          </Body>
          <View style={styles.actions}>
            <Chip icon="leaf" label="Something came up" onPress={() => setEventFormOpen(true)} />
            <Chip icon="question" label="Can we afford…?" onPress={() => setAffordOpen(true)} />
          </View>
        </TitleBand>

        {goals.length === 0 ? (
          <Notice>
            Add a goal on the Timeline tab first. An event can only be measured against a plan.
          </Notice>
        ) : null}

        {messages.length === 0 && ready ? (
          <Text style={styles.empty}>
            Nothing yet. Tap "Something came up" when life happens: a raise, a baby, a big bill.
          </Text>
        ) : null}

        <View style={styles.thread}>
          {messages.map(message => {
            // Captured outside the callback so the narrowing survives into it.
            const activeEvent = event;
            // Engine cards render as cards; everything else as a message line.
            if (message.kind === 'impact') {
              if (!impact || !activeEvent || message.refId !== activeEvent.id) {
                return (
                  <View key={String(message.id)} style={styles.systemLine}>
                    <Caption>{message.text}</Caption>
                  </View>
                );
              }
              return (
                <ImpactCard
                  key={String(message.id)}
                  impact={impact}
                  eventId={activeEvent.id}
                  eventLabel={eventLabelFor(activeEvent.templateId)}
                />
              );
            }

            if (message.kind === 'affordability' && message.payload) {
              let payload: AffordabilityPayload | null = null;
              try {
                payload = JSON.parse(message.payload) as AffordabilityPayload;
              } catch {
                payload = null;
              }
              if (payload) return <AffordabilityCard key={String(message.id)} payload={payload} />;
            }

            const mine = message.authorMemberId === me.id;
            const authorColor = colorOf(message.authorMemberId);
            return (
              <View key={String(message.id)} style={styles.message}>
                <View style={styles.messageHead}>
                  <View style={[styles.authorDot, { backgroundColor: authorColor }]} />
                  <Text style={[styles.messageAuthor, { color: authorColor }]}>
                    {message.authorMemberId === undefined
                      ? 'Branches'
                      : mine
                        ? 'You'
                        : nameOf(message.authorMemberId)}
                  </Text>
                </View>
                <Text style={styles.messageText}>{message.text}</Text>
                {message.chips.length > 0 && message.refId !== undefined ? (
                  <View style={styles.chipRow}>
                    {message.chips.map(chip => (
                      <Chip
                        key={chip}
                        label={chip}
                        onPress={() => void answerChip(message.refId!, chip)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        {agent.progressText ? (
          <View style={styles.progressRow}>
            <View style={[styles.authorDot, { backgroundColor: colors.agent }]} />
            <Text style={styles.progressText}>{agent.progressText}</Text>
          </View>
        ) : null}

        {/*
          Never-stuck (Stage 8). The agent being *registered* is not the same as
          its service being alive: if it dies mid-job the row stops changing and
          the progress line above would sit there indefinitely. The job is still
          trying, so this is an offer rather than an error, and the form reaches
          exactly the same engine.
        */}
        {agent.stalled ? (
          <Notice tone="warn">
            The assistant has been quiet for {agent.quietSeconds} seconds. You don't have to
            wait: "Something came up" sets the event directly, and the projection is identical
            either way.
          </Notice>
        ) : null}

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Text style={styles.hint}>
          {hasAgent
            ? 'Just say what happened and Branches works out what it means. The buttons at the top do the same thing if you would rather tap.'
            : 'No assistant is running, so nothing will read a typed message. Use "Something came up" instead; the projection is identical either way.'}
        </Text>
      </ScrollView>

      {/* The composer stays at the bottom and rises with the keyboard. */}
      <View style={styles.composerDock}>
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={hasAgent ? 'We just found out…' : 'Tap "Something came up" above'}
            placeholderTextColor={colors.ink3}
            style={styles.input}
            accessibilityLabel="Message to Branches"
            returnKeyType="send"
            onSubmitEditing={() => void send()}
            blurOnSubmit={false}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !draft.trim() || sending }}
            disabled={!draft.trim() || sending}
            onPress={() => void send()}
            style={({ pressed }) => [
              styles.send,
              (!draft.trim() || sending) && styles.sendDisabled,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Icon name="send" size={20} color={colors.onAccent} />
          </Pressable>
        </View>
      </View>

      <EventFormSheet visible={eventFormOpen} onClose={() => setEventFormOpen(false)} />
      <AffordabilitySheet visible={affordOpen} onClose={() => setAffordOpen(false)} />
    </KeyboardAvoidingView>
  );
}

/**
 * Map a chip label back to an engine parameter.
 *
 * The chips are generated by the agent from the template's asked parameters, so
 * the mapping is small and explicit rather than clever — an unrecognised chip
 * falls back to the form rather than guessing.
 */
function parseChip(chip: string): { key: string; value: string } | null {
  const weeks = chip.match(/(\d+)\s*weeks?/i);
  if (weeks) return { key: 'leaveMonths', value: String(Math.round(Number(weeks[1]) / 4)) };
  if (/^no leave$/i.test(chip)) return { key: 'leaveMonths', value: '0' };
  if (/daycare/i.test(chip)) return { key: 'care', value: 'daycare' };
  if (/staying home|stays home/i.test(chip)) return { key: 'care', value: 'home' };
  const months = chip.match(/(\d+)\s*months?/i);
  if (months) return { key: 'monthsWithoutIncome', value: months[1]! };
  return null;
}

function eventLabelFor(templateId: string): string {
  return EVENT_TEMPLATE_LIST.find(t => t.id === templateId)?.label ?? templateId;
}

/**
 * The event form: template picker, then one field per parameter, generated from
 * the engine's own specs so a new template gets a form for free.
 */
function EventFormSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const members = useHouseholdMembers();
  const createEvent = useReducer(reducers.createEvent);

  const [templateId, setTemplateId] = useState<LifeEventTemplateId | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(next: LifeEventTemplateId) {
    const fields = formFieldsFor(next);
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.key] =
        field.kind === 'member' ? String(members[0]?.id ?? '') : field.initial;
    }
    setTemplateId(next);
    setValues(initial);
    setError(null);
  }

  function reset() {
    setTemplateId(null);
    setValues({});
    setError(null);
  }

  async function submit() {
    if (!templateId) return;
    setError(null);
    setBusy(true);
    try {
      const params = Object.entries(values)
        .filter(([, value]) => value.trim() !== '')
        .map(([key, value]) => ({ key, value }));
      await createEvent({ templateId, params });
      // Impact is computed by an effect on the Chat screen once the new event
      // arrives over the subscription. A reducer returns nothing
      // (05 Data Model), so there is no event id to act on here — and keeping
      // the two steps separate is what Stage 6 needs, where the agent fills
      // parameters in over several turns before an impact is worth computing.
      reset();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const fields = templateId ? formFieldsFor(templateId) : [];

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Something came up"
    >
      {!templateId ? (
        <>
          <Text style={styles.fieldLabel}>What happened?</Text>
          <View style={styles.grid}>
            {EVENT_TEMPLATE_LIST.map(template => (
              <Pressable
                key={template.id}
                accessibilityRole="button"
                onPress={() => pick(template.id)}
                style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.surfaceHover }]}
              >
                <Icon name={eventIcon(template.id)} size={26} color={colors.accent} />
                <Text style={styles.tileLabel}>{template.label}</Text>
              </Pressable>
            ))}
          </View>
          <Caption>
            All of these use placeholder costs for now, so treat the numbers as a shape rather
            than a quote.
          </Caption>
        </>
      ) : (
        <>
          {fields.map(field => (
            <FormFieldRow
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              members={members.map(m => ({ id: String(m.id), name: m.displayName }))}
              onChange={next => setValues(prev => ({ ...prev, [field.key]: next }))}
            />
          ))}
          {error ? <Notice tone="warn">{error}</Notice> : null}
          <Button label={busy ? 'Working it out…' : 'See what it means'} onPress={submit} disabled={busy} />
          <Button label="Something else" variant="quiet" onPress={reset} />
        </>
      )}
    </Sheet>
  );
}

function FormFieldRow({
  field,
  value,
  members,
  onChange,
}: {
  field: FormField;
  value: string;
  members: { id: string; name: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{field.label}</Text>
      {field.kind === 'number' ? (
        <Field value={value} onChangeText={onChange} keyboardType="number-pad" label={field.label} />
      ) : (
        <View style={styles.chipRow}>
          {(field.kind === 'member'
            ? members.map(m => ({ key: m.id, label: m.name }))
            : (field.options ?? []).map(o => ({ key: o, label: choiceLabel(o) }))
          ).map(option => (
            <Chip
              key={option.key}
              label={option.label}
              selected={value === option.key}
              onPress={() => onChange(option.key)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function AffordabilitySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const check = useReducer(reducers.checkAffordability);
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet visible={visible} onClose={onClose} title="Can we afford it?">
      <Text style={styles.fieldLabel}>What is it?</Text>
      <Field value={label} onChangeText={setLabel} placeholder="a couch" label="What is it?" />
      <Text style={[styles.fieldLabel, { marginTop: space.lg }]}>How much, in dollars?</Text>
      <Field value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="1200" label="Amount in dollars" />
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <Button
        label="Check it"
        onPress={async () => {
          setError(null);
          const dollarsValue = Number(amount);
          if (!Number.isFinite(dollarsValue) || dollarsValue <= 0) {
            setError('Enter an amount above zero.');
            return;
          }
          try {
            await check({
              amountCents: Math.round(dollarsValue * 100),
              label: label.trim() || 'it',
            });
            setAmount('');
            setLabel('');
            onClose();
          } catch (e) {
            setError(messageOf(e));
          }
        }}
      />
      <Caption>
        The answer comes back in time as well as dollars: which goals move, and what happens to
        the emergency fund.
      </Caption>
    </Sheet>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: space.sidePadding,
    paddingBottom: space.xl,
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    alignSelf: 'center',
  },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, flexWrap: 'wrap' },
  empty: { ...typeScale.bodyItalic, color: colors.ink2, marginTop: space.md },
  thread: { marginTop: space.sm },
  message: {
    paddingVertical: space.md,
    borderBottomWidth: line.hair,
    borderBottomColor: colors.rule,
  },
  messageHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  authorDot: { width: 8, height: 8, borderRadius: 4 },
  messageAuthor: { ...typeScale.caption },
  messageText: { ...typeScale.body, color: colors.ink },
  systemLine: { paddingVertical: space.sm },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  progressText: { ...typeScale.bodyItalic, fontSize: 15, color: colors.ink2 },
  hint: { ...typeScale.caption, color: colors.ink3, marginTop: space.lg },

  composerDock: {
    borderTopWidth: line.hair,
    borderTopColor: colors.rule,
    backgroundColor: colors.bg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH - space.md * 2,
  },
  input: {
    flex: 1,
    minHeight: 46,
    ...typeScale.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
    borderRadius: radius,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: radius,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.35 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  tile: {
    width: '48%',
    flexGrow: 1,
    minHeight: 76,
    borderWidth: line.hair,
    borderColor: colors.rule,
    borderRadius: radius,
    padding: space.md,
    gap: space.sm,
    justifyContent: 'center',
  },
  tileLabel: { fontFamily: fonts.textMedium, fontSize: 15, color: colors.ink },
  field: { marginTop: space.lg },
  fieldLabel: { ...typeScale.label, color: colors.ink, marginTop: space.sm },
  chipRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.sm },
});
