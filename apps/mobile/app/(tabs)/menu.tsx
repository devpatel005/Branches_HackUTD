import { useState } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import {
  Body,
  Button,
  Caption,
  Divider,
  Notice,
  Row,
  Screen,
  SectionHeader,
  Title,
} from '../../src/components';
import { deviceSlotLabel } from '../../src/device-slot';
import { useHousehold, useHouseholdMembers, useMe } from '../../src/household';
import { SPACETIME_DB_NAME, SPACETIME_HOST } from '../../src/config';
import { colors, space } from '../../src/theme';

/**
 * Menu — two buttons that unstick a demo, plus the few facts that are awkward
 * to find when you are driving two tabs at once.
 *
 * ## Why "Bring the agent here" exists
 *
 * The agent service is a plain SpacetimeDB client, and with no
 * `AGENT_JOIN_CODE` it serves the **newest** household in the database. On a
 * development database that is wrong often: `verify:flow` mints a household on
 * every run, so a verification run steals the agent, and the service only ever
 * moves to a *strictly newer* household — so it can never come back on its own.
 *
 * The symptom is the worst kind: an agent that is plainly running and plainly
 * ignoring you, with nothing on screen to say why. Chat says "No agent is
 * running" because this household has no agent member row, which is true and
 * says nothing about the cause.
 *
 * The button writes an `agent_request` row; the service prefers the newest one
 * over both of its own rules. It is the one fix that does not involve reading a
 * log, finding a join code, and editing a dotfile mid-demo.
 *
 * ## Why reset keeps the household
 *
 * `reseedHousehold` deletes every piece of plan data — items, gap questions,
 * fun money, goals, life events, impacts, chat, sessions, branches,
 * constraints, reactions, the commitment and the projection — and sets
 * `onboarded` back to false. It deliberately **keeps** three things:
 *
 *  - the household, both members and the join code, so the two devices stay
 *    paired across a reset. Re-pairing between every run is what makes testing
 *    slow, and the pairing is not what anyone needs to re-test;
 *  - the imported transactions, so inference re-runs from the same data rather
 *    than from nothing (`verify:flow` R6).
 *
 * Which is why the copy below says "the whole plan" and not "everything".
 *
 * Because `RouteGate` watches `household.onboarded`, the reset needs no
 * navigation of its own: flipping that flag sends **both** devices back to the
 * start of onboarding at the same time. That is the whole point — one tap here
 * resets your partner's screen too.
 *
 * ## Why it takes two taps
 *
 * This tab is reachable during the demo, and a stray tap mid-run would wipe the
 * plan in front of the judges with no undo. So the button arms first and acts
 * second. It is still one button: press it twice.
 */
export default function MenuScreen() {
  const reseedHousehold = useReducer(reducers.reseedHousehold);
  const requestAgent = useReducer(reducers.requestAgent);

  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(false);

  // `allMembers` rather than `useHouseholdMembers`, which excludes the agent by
  // design — and the agent row is exactly what this screen needs to see.
  const { me, members: allMembers } = useMe();
  const household = useHousehold();
  const members = useHouseholdMembers();
  const slot = deviceSlotLabel();
  const agent = me
    ? allMembers.find(m => m.householdId === me.householdId && m.role === 'agent')
    : undefined;

  async function reset() {
    if (!armed) {
      setArmed(true);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reseedHousehold();
      // No router call: RouteGate sees `onboarded: false` and moves both
      // devices to onboarding by itself.
      setArmed(false);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function bringAgentHere() {
    setAsking(true);
    setError(null);
    try {
      await requestAgent();
      // The service polls, so the row landing is not the same as it arriving.
      // Say what was sent rather than claiming a result we cannot see yet; the
      // row above flips to "connected" on its own when it does.
      setAsked(true);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setAsking(false);
    }
  }

  return (
    <Screen>
      <Title>Menu</Title>

      <SectionHeader>Assistant</SectionHeader>
      <Row
        label="Agent"
        value={agent ? 'connected' : 'not here'}
        sublabel={
          agent
            ? 'This household has an agent. Chat will read what you type.'
            : 'Chat will say no agent is running, even if the service is up.'
        }
      />
      <View style={styles.resetBlock}>
        <Button
          label={asking ? 'Asking…' : 'Bring the agent here'}
          onPress={bringAgentHere}
          variant="secondary"
          disabled={asking || !me}
        />
        <Caption>
          {asked && !agent
            ? 'Asked. The service checks every couple of seconds — if this stays "not here", it is not running at all.'
            : agent
              ? 'Already here. Tap only if it stops answering.'
              : 'Use this when the service is running but Chat says no agent is. It is serving another household.'}
        </Caption>
      </View>

      <Divider />

      <SectionHeader>Start over</SectionHeader>
      <Body dim>
        Clears the whole plan — confirmed spending, fun money, goals, life events, branches, chat
        and the committed plan — and takes you both back to the start of onboarding. Your imported
        transactions stay, so inference re-runs from the same data.
      </Body>

      <View style={styles.resetBlock}>
        <Button
          label={busy ? 'Resetting…' : armed ? 'Tap again to reset everything' : 'Reset everything'}
          onPress={reset}
          variant={armed ? 'primary' : 'secondary'}
          disabled={busy || !me}
        />
        {armed && !busy ? (
          <Caption color={colors.caution}>
            This cannot be undone, and it resets your partner's screen too.
          </Caption>
        ) : (
          <Caption>You stay paired — the join code and both members are kept.</Caption>
        )}
      </View>

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <Divider />

      <SectionHeader>This device</SectionHeader>
      {slot ? <Row label="Device slot" value={slot} /> : null}
      <Row label="You" value={me?.displayName ?? '—'} />
      <Row label="Join code" value={household?.joinCode ?? '—'} />
      <Row
        label="Members"
        value={String(members.length)}
        sublabel={members.map(m => m.displayName).join(', ') || undefined}
      />
      <Row label="Onboarded" value={household?.onboarded ? 'yes' : 'no'} />

      <Divider />

      <SectionHeader>Server</SectionHeader>
      <Row label="Database" value={SPACETIME_DB_NAME} />
      <Row label="Host" value={SPACETIME_HOST} />

      {Platform.OS === 'web' ? (
        <>
          <Divider />
          <SectionHeader>Two partners on one laptop</SectionHeader>
          <Body dim>
            This tab is one partner. Open a second tab at ?device=b for the other — it gets its own
            identity, because browser storage is shared per origin and not per tab.
          </Body>
        </>
      ) : null}
    </Screen>
  );
}

/** Reducer errors arrive as plain strings often enough to be worth handling. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  resetBlock: { gap: space.sm, marginBottom: space.md },
});
