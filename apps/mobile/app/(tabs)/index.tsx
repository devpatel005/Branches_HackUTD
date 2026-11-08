import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from '@branches/bindings';
import { colors, space, type, tabularNums } from '../../src/theme';
import { useIdentity } from '../../src/spacetime';

export default function HomeScreen() {
  const [counters, countersReady] = useTable(tables.counter);
  const [clients] = useTable(tables.connectedClient);
  const increment = useReducer(reducers.increment);
  const { identity, reusedToken } = useIdentity();

  const counter = counters[0];

  // 14 Research Notes#SpacetimeDB: calling a reducer briefly flips isReady to
  // false, so `if (!isReady) return <Loading/>` makes the screen flash on every
  // tap. Only show loading when there is genuinely nothing to render yet.
  const showLoading = !countersReady && counters.length === 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.caption}>Stage 0 — real-time sync check</Text>

      {showLoading ? (
        <Text style={styles.loading}>Connecting…</Text>
      ) : (
        <>
          <Text style={[styles.display, tabularNums]}>{counter?.value ?? 0}</Text>
          <Text style={styles.caption}>
            Shared counter · tap on one device, watch the other
          </Text>

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => void increment()}
          >
            <Text style={styles.buttonLabel}>Increment</Text>
          </Pressable>

          <View style={styles.rows}>
            <Row
              label="Engine check — F1(12,000, 24)"
              value={counter ? counter.engineCheck.toFixed(2) : '—'}
              hint="must be 500.00; computed by packages/engine inside the reducer"
            />
            <Row label="Engine version" value={counter?.engineVersion ?? '—'} />
            <Row label="Devices connected" value={String(clients.length)} />
            <Row
              label="My identity"
              value={identity ? `${identity.toHexString().slice(0, 12)}…` : '—'}
              hint={reusedToken ? 'reused stored token' : 'new token issued'}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <Text style={styles.rowLabelText}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Text style={[styles.rowValue, tabularNums]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.sidePadding, paddingTop: space.xl, gap: space.sm },
  display: { ...type.display, color: colors.textPrimary },
  caption: { ...type.caption, color: colors.textSecondary },
  loading: { ...type.body, color: colors.textSecondary, paddingVertical: space.xl },
  button: {
    marginTop: space.lg,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { ...type.body, fontWeight: '600', color: colors.bg },
  rows: { marginTop: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    gap: space.md,
  },
  rowLabel: { flex: 1 },
  rowLabelText: { ...type.body, color: colors.textPrimary },
  rowHint: { ...type.caption, color: colors.textSecondary, marginTop: space.xs },
  rowValue: { ...type.body, color: colors.textSecondary },
});
