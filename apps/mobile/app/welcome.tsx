import { useState } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import {
  Avatar,
  Body,
  Button,
  Caption,
  Field,
  Hero,
  Notice,
  Screen,
  SectionHeader,
  Title,
} from '../src/components';
import { useHousehold, useHouseholdMembers, useMe, memberColor } from '../src/household';
import { colors, space } from '../src/theme';

/**
 * Welcome — 10 Screens#Welcome.
 *
 * Three states: choose, show-my-code (waiting for a partner), enter-a-code.
 * Designed for the reluctant partner: nothing to type but a name and six
 * characters (03 User Journey#Persona).
 */
type Mode = 'choose' | 'start' | 'join';

export default function WelcomeScreen() {
  const [mode, setMode] = useState<Mode>('choose');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    try {
      await createHousehold({ displayName: name.trim() || 'Partner A' });
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function join() {
    setError(null);
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setError('A join code is six characters.');
      return;
    }
    try {
      await joinHousehold({ joinCode: trimmed, displayName: name.trim() || 'Partner B' });
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Title>Branches</Title>
        <Body dim>
          A shared plan for the two of you — and the paths forward when life changes.
        </Body>
      </View>

      {mode === 'choose' ? (
        <View style={styles.actions}>
          <Button label="Start a household" onPress={() => setMode('start')} />
          <Button label="Join a household" variant="secondary" onPress={() => setMode('join')} />
        </View>
      ) : null}

      {mode === 'start' ? (
        <View style={styles.actions}>
          <Caption>Your name</Caption>
          <Field value={name} onChangeText={setName} placeholder="Maya" />
          <Button label="Create our household" onPress={start} />
          <Button label="Back" variant="quiet" onPress={() => setMode('choose')} />
        </View>
      ) : null}

      {mode === 'join' ? (
        <View style={styles.actions}>
          <Caption>Your name</Caption>
          <Field value={name} onChangeText={setName} placeholder="Jordan" />
          <Caption>Join code</Caption>
          <Field
            value={code}
            onChangeText={next => setCode(next.toUpperCase())}
            placeholder="ABC234"
            autoCapitalize="characters"
            maxLength={6}
            align="center"
          />
          <Button label="Join" onPress={join} />
          <Button label="Back" variant="quiet" onPress={() => setMode('choose')} />
        </View>
      ) : null}

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <Notice>
        Mock data only. Nothing here connects to a real bank, and your fun-money
        purchases never leave this device.
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
      <Hero value={code} caption="Your join code" />
      <Body dim>Open Branches on your partner's device and enter this code.</Body>

      <View style={styles.avatars}>
        {members.map(m => (
          <Avatar
            key={String(m.id)}
            name={m.displayName}
            color={memberColor(m.colorKey)}
            online={m.online}
            size={44}
          />
        ))}
        <View style={styles.avatarPlaceholder} />
      </View>
      <Caption>Waiting for your partner…</Caption>

      <Caption>
        Branches plans for two, so the shared baseline needs both of you before it can be
        built. Nothing is lost while you wait — the code stays the same.
      </Caption>

      {/*
        The documented way to get a second identity on one machine
        (16 Dev Environment): AsyncStorage on web *is* localStorage, which is
        per-origin and not per-tab, so a plain second tab joins as the same
        person.
      */}
      {Platform.OS === 'web' ? (
        <Caption>
          Testing alone? Open a second tab at /?device=b and enter {code} there — that tab
          gets its own identity.
        </Caption>
      ) : null}

      <SectionHeader>Fix your name</SectionHeader>
      <Field
        value={rename}
        onChangeText={setRename}
        placeholder={me?.displayName ?? 'Your name'}
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
      {error ? <Notice tone="warn">{error}</Notice> : null}
    </Screen>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Reducer rejections arrive wrapped; the useful part is the sender message.
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  header: { marginTop: space.xl, marginBottom: space.xl },
  actions: { gap: space.xs },
  avatars: { flexDirection: 'row', gap: space.sm, marginTop: space.xl, marginBottom: space.sm },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderStyle: 'dashed',
  },
});
