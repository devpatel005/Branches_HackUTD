import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProvenanceRecord } from '@branches/engine';
import { Button, Caption, Row, SectionHeader } from './components';
import { FernLeaf } from './forest';
import { COLUMN_MAX_WIDTH, colors, fonts, line, radius, space, tabularNums, type as typeScale } from './theme';

/**
 * Bottom sheets — 10 Screens#Sheets.
 *
 * `Modal` rather than a gesture-driven sheet library: it works identically in
 * Expo Go and on web with no native module (02 Ground Rules #6). The sheet
 * rises over a dimmed page, clears the home indicator, lifts with the keyboard
 * on iOS, and on web keeps to the phone column's width.
 */

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.dock}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]}>
          <FernLeaf size={150} angle={-200} opacity={0.28} style={styles.leaf} />
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          <Button label="Close" variant="secondary" onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Formats a provenance input for display without doing arithmetic on it.
 * Provenance inputs are deliberately unrounded so the arithmetic re-walks; by
 * default they are shown to the cent (what a person reads), and "exact values"
 * shows the six places the engine actually used.
 */
function formatInput(value: number | string | readonly number[], exact: boolean): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(v => (typeof v === 'number' ? round(v, exact) : String(v))).join(', ');
  }
  return round(value as number, exact);
}

function round(value: number, exact: boolean): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  if (exact) return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ASSUMPTION_LABELS: Record<string, string> = {
  savingsRateAnnual: 'Savings rate (assumed)',
  inflationAnnual: 'Inflation',
  mortgageRateAnnual: 'Mortgage rate',
  carRateAnnual: 'Car loan rate',
};

/**
 * "Show the Math" — 10 Screens#Sheets: the formula in words, the inputs, the
 * assumptions, and the result, readable by a non-expert.
 *
 * Every word of this comes from the engine's provenance record. Nothing is
 * recomputed here, so the sheet cannot disagree with the number it explains
 * (02 Ground Rules #8: never show a number without being able to show its math).
 */
export function ShowTheMath({
  visible,
  onClose,
  label,
  record,
}: {
  visible: boolean;
  onClose: () => void;
  label: string;
  record: ProvenanceRecord | undefined;
}) {
  const [exact, setExact] = useState(false);
  return (
    <Sheet visible={visible} onClose={onClose} title={label}>
      {!record ? (
        <Caption>No breakdown is available for this number yet.</Caption>
      ) : (
        <>
          <SectionHeader>How it's worked out</SectionHeader>
          <Text style={styles.prose}>{record.formulaText}</Text>

          <SectionHeader>What goes into it</SectionHeader>
          {Object.entries(record.inputs).map(([key, value]) => (
            <Row key={key} label={humanize(key)} value={formatInput(value, exact)} />
          ))}
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: exact }}
            onPress={() => setExact(v => !v)}
            style={styles.exactToggle}
          >
            <Text style={styles.exactText}>
              {exact ? 'Show rounded values' : 'Show exact values'}
            </Text>
          </Pressable>

          {Object.keys(record.assumptions).length > 0 ? (
            <>
              <SectionHeader>Assumptions used</SectionHeader>
              {Object.entries(record.assumptions).map(([key, value]) => (
                <Row
                  key={key}
                  label={ASSUMPTION_LABELS[key] ?? humanize(key)}
                  sublabel="an assumption, not a quoted rate"
                  value={`${(value * 100).toFixed(2)}%`}
                />
              ))}
            </>
          ) : null}

          <SectionHeader>Result</SectionHeader>
          <Text style={[styles.result, tabularNums]}>
            {exact
              ? record.result.toLocaleString('en-US', { maximumFractionDigits: 6 })
              : record.result.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </Text>
          <View style={styles.formulaRef}>
            <Text style={styles.formulaText}>Formula {record.formula}</Text>
          </View>
        </>
      )}
    </Sheet>
  );
}

/** `requiredMonthlyAtStart` -> `Required monthly at start`. */
function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').replace(/[._]/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(4, 12, 12, 0.72)' },
  dock: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    borderTopWidth: line.hair,
    borderColor: colors.ruleStrong,
    paddingHorizontal: space.sidePadding,
    paddingTop: space.md,
    overflow: 'hidden',
  },
  leaf: { position: 'absolute', right: -56, top: -30 },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.ruleStrong,
    marginBottom: space.lg,
  },
  title: { ...typeScale.title, fontSize: 26, lineHeight: 32, color: colors.ink, maxWidth: '85%' },
  body: { marginTop: space.xs, flexShrink: 1 },
  bodyContent: { paddingBottom: space.lg },
  prose: { ...typeScale.bodyItalic, color: colors.ink, marginTop: space.xs },
  exactToggle: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  exactText: { ...typeScale.label, color: colors.accent, textDecorationLine: 'underline' },
  result: { ...typeScale.display, color: colors.ink, marginVertical: space.sm },
  formulaRef: { borderLeftWidth: 2, borderLeftColor: colors.ruleStrong, paddingLeft: space.md },
  formulaText: { fontFamily: fonts.textMedium, fontSize: 13, color: colors.ink2 },
});
