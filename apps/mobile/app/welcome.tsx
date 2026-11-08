import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import {
  Avatar,
  Body,
  Button,
  Caption,
  Field,
  Notice,
  Screen,
  SectionHeader,
  TitleBand,
  useTopBleed,
} from '../src/components';
import { BranchPaths, ForestCanopy } from '../src/forest';
import { useHousehold, useHouseholdMembers, useMe, memberColor } from '../src/household';
import { colors, fonts, line, space, type as typeScale } from '../src/theme';

/**
 * Welcome — 10 Screens#Welcome.
 *
 * Three states: choose, show-my-code (waiting for a partner), enter-a-code.
 * Designed for the reluctant partner: nothing to type but a name and six
 * characters (03 User Journey#Persona).
 *
 * One dominant action ("Start a household"); joining is the quieter second
 * path, since the person holding a code already knows why they are here.
 */
type Mode = 'choose' | 'start' | 'join';

export default function WelcomeScreen() {
  const [mode, setMode] = useState<Mode>('choose');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bleed = useTopBleed();

  const createHousehold = useReducer(reducers.createHousehold);
  const joinHousehold = useReducer(reducers.joinHousehold);

  const { me } = useMe();
  const household = useHousehold();
  const members = useHouseholdMembers();

  // Once we're a member with a code and no partner yet, this screen becomes the
  // waiting room — the partner's avatar pops in live when they join.
  if (me && household && members.length < 2) {
    return <WaitingForPartner code={household.joinCode} />;
  }

  async function start() {
    setError(null);
    setBusy(true);
    try {
      await createHousehold({ displayName: name.trim() || 'Partner A' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setError(null);
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setError('A join code is six characters. Check for a letter that looks like a number.');
      return;
    }
    setBusy(true);
    try {
      await joinHousehold({ joinCode: trimmed, displayName: name.trim() || 'Partner B' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ForestCanopy height={250 + bleed.inset} style={[styles.canopy, { marginTop: bleed.marginTop }]} seed={19}>
        <View style={[styles.wordmarkWrap, { paddingTop: space.xl + bleed.inset }]}>
          <Text style={styles.plate}>A plan for two</Text>
          <Text style={styles.wordmark} accessibilityRole="header">
            Branches
          </Text>
        </View>
      </ForestCanopy>

      <Text style={styles.pitch}>
        Two incomes, one plan. When life changes, see the paths forward and choose one together.
      </Text>

      {/* The signature, small: one path that forks. */}
      <View style={styles.fork}>
        <BranchPaths
          lanes={[{ color: colors.memberA, chosen: true }, { color: colors.ink3 }, { color: colors.memberB, chosen: true }]}
          height={56}
        />
      </View>

      {mode === 'choose' ? (
        <View style={styles.actions}>
          <Button label="Start a household" onPress={() => setMode('start')} />
          <Button label="I have a join code" variant="quiet" onPress={() => setMode('join')} />
        </View>
      ) : null}

      {mode === 'start' ? (
        <View style={styles.actions}>
          <Text style={styles.label}>What should we call you?</Text>
          <Field value={name} onChangeText={setName} placeholder="Maya" label="Your name" />
          <Caption>Your partner sees this name.</Caption>
          <Button
            label={busy ? 'Creating…' : 'Create our household'}
            onPress={start}
            disabled={busy}
          />
          <Button label="Back" variant="quiet" onPress={() => setMode('choose')} />
        </View>
      ) : null}

      {mode === 'join' ? (
        <View style={styles.actions}>
          <Text style={styles.label}>What should we call you?</Text>
          <Field value={name} onChangeText={setName} placeholder="Jordan" label="Your name" />
          <Text style={[styles.label, { marginTop: space.lg }]}>Your partner's join code</Text>
          <Field
            value={code}
            onChangeText={next => setCode(next.toUpperCase())}
            placeholder="ABC234"
            autoCapitalize="characters"
            maxLength={6}
            align="center"
            label="Join code, six characters"
          />
          <Button label={busy ? 'Joining…' : 'Join household'} onPress={join} disabled={busy} />
          <Button label="Back" variant="quiet" onPress={() => setMode('choose')} />
        </View>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Notice>
        Projections from assumptions you can see and edit, not financial advice. Mock data only:
        nothing connects to a real bank, and fun-money purchases never leave this device.
      </Notice>
    </Screen>
  );
}

/**
 * The code, large, with the partner's avatar appearing live when they join.
 *
 * Never-stuck (Stage 8): this screen used to offer nothing but waiting. If the
 * partner never arrives — or the name was a typo, or there is only one person
 * and one laptop — there was no action on screen and no way back, because
 * `createHousehold` refuses once you are already a member. So it now says why
 * two people are needed, lets the name be fixed in place, and points at the
 * second-identity trick that actually unblocks a single browser.
 */
function WaitingForPartner({ code }: { code: string }) {
  const members = useHouseholdMembers();
  const { me } = useMe();
  const setDisplayName = useReducer(reducers.setDisplayName);
  const [rename, setRename] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen>
      <TitleBand plate="Your join code" title="Waiting for your partner">
        <Body dim>Open Branches on your partner's phone and enter this code.</Body>
      </TitleBand>

      <Text style={styles.code} accessibilityLabel={`Join code ${code.split('').join(' ')}`}>
        {code}
      </Text>

      <View style={styles.avatars}>
        {members.map(m => (
          <Avatar
            key={String(m.id)}
            name={m.displayName}
            color={memberColor(m.colorKey)}
            online={m.online}
            size={48}
          />
        ))}
        <View style={styles.avatarPlaceholder} accessibilityLabel="Your partner's place" />
        <Text style={styles.waitingText}>Waiting for your partner…</Text>
      </View>

      <Body dim>
        Branches plans for two, so the shared baseline needs both of you before it can be built.
        Nothing is lost while you wait; the code stays the same.
      </Body>

      {/*
        The documented way to get a second identity on one machine
        (16 Dev Environment): AsyncStorage on web *is* localStorage, which is
        per-origin and not per-tab, so a plain second tab joins as the same
        person.
      */}
      {Platform.OS === 'web' ? (
        <Notice>
          Testing alone? Open a second tab at /?device=b and enter {code} there. That tab gets its
          own identity.
        </Notice>
      ) : null}

      <SectionHeader>Fix your name</SectionHeader>
      <Field
        value={rename}
        onChangeText={setRename}
        placeholder={me?.displayName ?? 'Your name'}
        label="New name"
      />
      <Button
        label="Update name"
        variant="secondary"
        onPress={async () => {
          setError(null);
          if (!rename.trim()) return;
          try {
            await setDisplayName({ displayName: rename });
            setRename('');
          } catch (e) {
            setError(messageOf(e));
          }
        }}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Screen>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Reducer rejections arrive wrapped; the useful part is the sender message.
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  canopy: { marginHorizontal: -space.sidePadding },
  wordmarkWrap: { paddingHorizontal: space.sidePadding },
  plate: { ...typeScale.plate, color: colors.accent, marginBottom: space.xs },
  wordmark: { fontFamily: fonts.numeral, fontSize: 48, lineHeight: 54, letterSpacing: -1, color: colors.ink },
  pitch: { ...typeScale.bodyItalic, fontSize: 20, lineHeight: 29, color: colors.ink, marginTop: space.xl },
  fork: { marginTop: space.lg, marginBottom: space.md, marginRight: -space.sidePadding },
  actions: { marginTop: space.sm },
  label: { ...typeScale.label, color: colors.ink },

  code: {
    fontFamily: fonts.numeral,
    fontSize: 56,
    lineHeight: 64,
    letterSpacing: 10,
    color: colors.ink,
  },
  avatars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
    marginBottom: space.lg,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: line.path,
    borderColor: colors.memberB,
    borderStyle: 'dashed',
    opacity: 0.6,
  },
  waitingText: { ...typeScale.bodyItalic, color: colors.ink2, marginLeft: space.sm, flexShrink: 1 },
});
