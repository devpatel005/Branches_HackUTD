import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import type { LifeEventTemplateId } from '@branches/engine';
import {
  Avatar,
  Body,
  Button,
  Caption,
  Chip,
  Field,
  Loading,
  Notice,
  Screen,
  SectionHeader,
  Title,
} from '../../src/components';
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
import { colors, space, type as typeScale } from '../../src/theme';

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

  const sendMessage = useReducer(reducers.sendMessage);
  const computeImpact = useReducer(reducers.computeImpact);
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
      attempted.current.delete(String(eventId));
    } catch (e) {
      setError(messageOf(e));
    }
  }

  // Compute the impact for an active event that doesn't have one yet.
  //
  // Declarative rather than chained onto the form's submit: a reducer returns
  // nothing, so the event id only exists once the subscription delivers the row.
  // `attempted` makes this at-most-once per event, so a rejection (incomplete
  // parameters, no goals yet) cannot turn into a retry loop.
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (!event || impact) return;
    const key = String(event.id);
    if (attempted.current.has(key)) return;
    attempted.current.add(key);
    computeImpact({ eventId: event.id }).catch(e => setError(messageOf(e)));
  }, [event?.id, impact, computeImpact]);

  if (!me) return <Loading label="Connecting…" />;

  const nameOf = (id: bigint | undefined) =>
    members.find(m => m.id === id)?.displayName ?? 'Branches';
  const colorOf = (id: bigint | undefined) => {
    const member = members.find(m => m.id === id);
    return member ? memberColor(member.colorKey) : colors.agent;
  };

  return (
    <Screen>
      <Title>What's happening?</Title>
      <Body dim>
        Tell Branches when something changes and it'll work out what it means for your plan.
      </Body>

      <View style={styles.actions}>
        <Chip label="Something came up" onPress={() => setEventFormOpen(true)} />
        <Chip label="Can we afford…?" onPress={() => setAffordOpen(true)} />
      </View>

      {goals.length === 0 ? (
        <Notice>
          Add a goal on the Timeline tab first — an event can only be measured against a plan.
        </Notice>
      ) : null}

      {messages.length === 0 && ready ? (
        <Notice>Nothing yet. Tap "Something came up" when life happens.</Notice>
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
          return (
            <View key={String(message.id)} style={styles.messageRow}>
              {message.authorMemberId !== undefined ? (
                <Avatar
                  name={nameOf(message.authorMemberId)}
                  color={colorOf(message.authorMemberId)}
                  size={24}
                />
              ) : (
                <View style={styles.enginePip} />
              )}
              <View style={styles.messageBody}>
                <Text style={[styles.messageAuthor, { color: colorOf(message.authorMemberId) }]}>
                  {message.authorMemberId === undefined ? 'Branches' : mine ? 'You' : nameOf(message.authorMemberId)}
                </Text>
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
            </View>
          );
        })}
      </View>

      {agent.progressText ? (
        <View style={styles.progressRow}>
          <View style={styles.enginePip} />
          <Caption>{agent.progressText}</Caption>
        </View>
      ) : null}

      <SectionHeader>Say something</SectionHeader>
      <Field value={draft} onChangeText={setDraft} placeholder="We just found out…" />
      <Button
        label="Send"
        variant="secondary"
        onPress={async () => {
          setError(null);
          if (!draft.trim()) return;
          try {
            await sendMessage({ text: draft });
            setDraft('');
          } catch (e) {
            setError(messageOf(e));
          }
        }}
      />
      <Caption>
        {hasAgent
          ? "Just say what happened — Branches works out what it means. The forms below do the same thing if you'd rather tap."
          : "No agent is running, so nothing will read this. Use \"Something came up\" — the projection is identical either way."}
      </Caption>

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <EventFormSheet visible={eventFormOpen} onClose={() => setEventFormOpen(false)} />
      <AffordabilitySheet visible={affordOpen} onClose={() => setAffordOpen(false)} />
    </Screen>
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
          <Caption>What happened?</Caption>
          <View style={styles.grid}>
            {EVENT_TEMPLATE_LIST.map(template => (
              <Chip
                key={template.id}
                label={`${template.icon}  ${template.label}`}
                onPress={() => pick(template.id)}
              />
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
      <Caption>{field.label}</Caption>
      {field.kind === 'number' ? (
        <Field value={value} onChangeText={onChange} keyboardType="number-pad" />
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
      <Caption>What is it?</Caption>
      <Field value={label} onChangeText={setLabel} placeholder="a couch" />
      <Caption>How much, in dollars?</Caption>
      <Field value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="1200" />
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
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, flexWrap: 'wrap' },
  thread: { marginTop: space.lg },
  messageRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md, alignItems: 'flex-start' },
  messageBody: { flex: 1 },
  messageAuthor: { ...typeScale.caption, marginBottom: 2 },
  messageText: { ...typeScale.body, color: colors.textPrimary, lineHeight: 21 },
  systemLine: { paddingVertical: space.sm },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  enginePip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  field: { marginTop: space.md },
  chipRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.sm },
});
