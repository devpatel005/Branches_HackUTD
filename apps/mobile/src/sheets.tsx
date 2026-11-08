import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ProvenanceRecord } from '@branches/engine';
import { Button, Caption, Headline, Row, SectionHeader } from './components';
import { colors, space, tabularNums, type as typeScale } from './theme';

/**
 * Bottom sheets — 10 Screens#Sheets.
 *
 * `Modal` rather than a gesture-driven sheet library: it works identically in
 * Expo Go and on web with no native module (02 Ground Rules #6). Stage 8 can
 * make it slide.
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
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Headline>{title}</Headline>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {children}
        </ScrollView>
        <Button label="Close" variant="secondary" onPress={onClose} />
      </View>
    </Modal>
  );
}

/** Formats a provenance input for display without doing arithmetic on it. */
function formatInput(value: number | string | readonly number[]): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(v => (typeof v === 'number' ? round(v) : String(v))).join(', ');
  }
  return round(value as number);
}

function round(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Provenance inputs are deliberately unrounded so the arithmetic re-walks;
  // six places is enough to show that without filling the screen.
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
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
            <Row key={key} label={humanize(key)} value={formatInput(value)} />
          ))}

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
          <Text style={[styles.result, tabularNums]}>{record.result.toLocaleString('en-US')}</Text>
          <Caption>Formula reference: {record.formula}</Caption>
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
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: space.sidePadding,
    paddingBottom: space.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    marginBottom: space.md,
  },
  body: { marginTop: space.sm },
  bodyContent: { paddingBottom: space.md },
  prose: { ...typeScale.body, color: colors.textPrimary, lineHeight: 22, marginTop: space.xs },
  result: { ...typeScale.title, color: colors.textPrimary, marginVertical: space.sm },
});
