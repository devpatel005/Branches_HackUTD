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
  TitleBand,
} from '../../src/components';
import { deviceSlotLabel } from '../../src/device-slot';
import { useHousehold, useHouseholdMembers, useMe } from '../../src/household';
import { SPACETIME_DB_NAME, SPACETIME_HOST } from '../../src/config';
import { colors, space } from '../../src/theme';

/**
 * Menu — one button to reset the plan, plus the few facts that are awkward to
 * find when you are driving two tabs at once.
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

  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { me } = useMe();
  const household = useHousehold();
  const members = useHouseholdMembers();
  const slot = deviceSlotLabel();

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

  return (
    <Screen>
      <TitleBand plate="No. 4 · Menu" title="Menu">
        <Body dim>Starting over, and the details you need when you are driving two devices.</Body>
      </TitleBand>

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
          icon="reset"
          variant={armed ? 'dangerArmed' : 'danger'}
          disabled={busy || !me}
        />
        {armed && !busy ? (
          <Caption color={colors.error}>
            This cannot be undone, and it resets your partner's screen too.
          </Caption>
        ) : (
          <Caption>You stay paired — the join code and both members are kept.</Caption>
        )}
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}

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
