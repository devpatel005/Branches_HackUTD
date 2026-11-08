import { useEffect, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useConnectionTrouble } from './spacetime';
import { colors, space, tabularNums, type as typeScale } from './theme';

/**
 * Shared primitives built from 09 Design System.
 *
 * Deliberately unanimated: Stage 8 owns motion, haptics and number rolling.
 * What is here is the structure those will attach to — hairline rows rather
 * than boxed cards, one bright accent, colour only for meaning.
 */

export function Screen({
  children,
  scroll = true,
}: {
  children: ReactNode;
  scroll?: boolean;
}) {
  if (!scroll) return <View style={styles.screenStatic}>{children}</View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Headline({ children }: { children: ReactNode }) {
  return <Text style={styles.headline}>{children}</Text>;
}

export function Body({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return <Text style={[styles.body, dim && styles.dim]}>{children}</Text>;
}

export function Caption({ children, color }: { children: ReactNode; color?: string }) {
  return <Text style={[styles.caption, color ? { color } : null]}>{children}</Text>;
}

/** One big number per screen (09 Design System#Principles). */
export function Hero({ value, caption }: { value: string; caption: string }) {
  return (
    <View style={styles.hero}>
      <Text style={[styles.display, tabularNums]}>{value}</Text>
      <Caption>{caption}</Caption>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'quiet' && styles.buttonQuiet,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          variant === 'primary' ? styles.buttonLabelPrimary : styles.buttonLabelSecondary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Rounded pill for follow-up answers, locks, pins and goal picks. */
export function Chip({
  label,
  onPress,
  selected,
  tint,
}: {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: colors.surfaceRaised, borderColor: tint ?? colors.accent },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipLabel, selected && { color: colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

/** Lists are hairline-separated rows, not boxed cards. Row height ~64px. */
export function Row({
  label,
  value,
  sublabel,
  right,
  onPress,
  style,
}: {
  label: string;
  value?: string;
  sublabel?: string;
  right?: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const content = (
    <View style={[styles.row, style]}>
      <View style={styles.rowText}>
        <Text style={styles.body}>{label}</Text>
        {sublabel ? <Text style={styles.rowSub}>{sublabel}</Text> : null}
      </View>
      {value ? <Text style={[styles.rowValue, tabularNums]}>{value}</Text> : null}
      {right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {content}
    </Pressable>
  );
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionHeader}>{children}</Text>;
}

/** A member's avatar: initial on a disc in their colour. Dimmed when absent. */
export function Avatar({
  name,
  color,
  online = true,
  size = 32,
}: {
  name: string;
  color: string;
  online?: boolean;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: online ? 1 : 0.35,
        },
      ]}
    >
      <Text style={[styles.avatarLabel, { fontSize: size * 0.45 }]}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

/** "Jordan: 4 of 5" — counts only, from the module's progress view. */
export function ProgressPill({
  name,
  color,
  done,
  total,
  online,
}: {
  name: string;
  color: string;
  done: number;
  total: number;
  online: boolean;
}) {
  return (
    <View style={styles.progressPill}>
      <Avatar name={name} color={color} online={online} size={24} />
      <Text style={styles.progressText}>
        {name}: {done} of {total}
      </Text>
    </View>
  );
}

export function Field({
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'words',
  keyboardType = 'default',
  maxLength,
  align = 'left',
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'words' | 'characters';
  keyboardType?: 'default' | 'number-pad';
  maxLength?: number;
  align?: 'left' | 'center';
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textSecondary}
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      maxLength={maxLength}
      style={[styles.field, align === 'center' && styles.fieldCentered]}
    />
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** Only render this when there are no rows *and* the table is not ready. */
/** How long a spinner may sit there before it owes the user an explanation. */
const SLOW_MS = 8000;

/**
 * A loading state that cannot become a dead end.
 *
 * Six screens short-circuit to this while they wait for a row, and every one of
 * them used to spin indefinitely if the row never came — which is precisely
 * what happens when the server is not running, the module is not published, or
 * the host is wrong. None of those resolve by waiting.
 *
 * So after `SLOW_MS` it says what it is waiting for, names the connection
 * problem if there is one, and offers a reload. Fixing it here rather than at
 * the six call sites means a screen added later gets the same floor for free.
 */
export function Loading({ label = 'Loading…', hint }: { label?: string; hint?: string }) {
  const [slow, setSlow] = useState(false);
  const { error, host } = useConnectionTrouble();

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.loading}>
      <Text style={styles.caption}>{label}</Text>

      {slow || error ? (
        <View style={styles.loadingHelp}>
          <Text style={styles.caption}>
            {error
              ? `Can't reach the planner at ${host}. ${error}`
              : hint ?? 'This is taking longer than it should.'}
          </Text>
          {/*
            Reload is the only recovery the app can offer by itself: the
            connection is owned by the provider above, and a failed first
            connect leaves nothing to retry against.
          */}
          {Platform.OS === 'web' ? (
            <Button
              label="Reload"
              variant="secondary"
              onPress={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
            />
          ) : (
            <Text style={styles.caption}>Close and reopen the app to try again.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function Notice({ children, tone = 'quiet' }: { children: ReactNode; tone?: 'quiet' | 'warn' }) {
  return (
    <View style={[styles.notice, tone === 'warn' && styles.noticeWarn]}>
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingHelp: { marginTop: space.lg, gap: space.sm, maxWidth: 420, alignItems: 'center' },
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: space.sidePadding, paddingTop: space.lg, paddingBottom: space.xl * 2 },
  screenStatic: { flex: 1, backgroundColor: colors.bg, padding: space.sidePadding, paddingTop: space.lg },

  display: { ...typeScale.display, color: colors.textPrimary },
  title: { ...typeScale.title, color: colors.textPrimary, marginBottom: space.sm },
  headline: { ...typeScale.headline, color: colors.textPrimary },
  body: { ...typeScale.body, color: colors.textPrimary },
  caption: { ...typeScale.caption, color: colors.textSecondary },
  dim: { color: colors.textSecondary },

  hero: { marginBottom: space.lg },

  button: { borderRadius: 12, paddingVertical: space.md, alignItems: 'center', marginTop: space.md },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.surfaceRaised },
  buttonQuiet: { backgroundColor: 'transparent', paddingVertical: space.sm },
  buttonLabel: { ...typeScale.body, fontWeight: '600' },
  buttonLabelPrimary: { color: colors.bg },
  buttonLabelSecondary: { color: colors.textPrimary },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.3 },

  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  chipLabel: { ...typeScale.body, color: colors.textSecondary },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    gap: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowText: { flex: 1 },
  rowSub: { ...typeScale.caption, color: colors.textSecondary, marginTop: 2 },
  rowValue: { ...typeScale.body, color: colors.textSecondary },

  sectionHeader: {
    ...typeScale.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.lg,
    marginBottom: space.xs,
  },

  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarLabel: { color: colors.bg, fontWeight: '700' },

  progressPill: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  progressText: { ...typeScale.caption, color: colors.textSecondary },

  field: {
    ...typeScale.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginTop: space.sm,
  },
  fieldCentered: { textAlign: 'center', letterSpacing: 6, fontSize: 24, fontWeight: '700' },

  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: space.md },
  loading: { paddingVertical: space.xl, alignItems: 'center', paddingHorizontal: space.sidePadding },

  notice: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: space.md,
    marginTop: space.md,
  },
  noticeWarn: { backgroundColor: colors.surfaceRaised },
  noticeText: { ...typeScale.caption, color: colors.textSecondary, lineHeight: 18 },
});
