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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FernLeaf } from './forest';
import { Icon, type IconName } from './icons';
import { useConnectionTrouble } from './spacetime';
import {
  COLUMN_MAX_WIDTH,
  WEB_MAX_WIDTH,
  colors,
  fonts,
  line,
  radius,
  space,
  tabularNums,
  type as typeScale,
} from './theme';

/**
 * Shared primitives — "Field Guide at Dusk".
 *
 * Structure comes from rules and alignment, the way a park field guide is set:
 * a title band at the top of each screen, ruled rows, and no boxes except the
 * branch cards (the thing you choose). Flat colour, one 6px radius, 44px targets.
 */

export function Screen({
  children,
  scroll = true,
  wide = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** The live session only: let the branch cards sit in a row on a laptop. */
  wide?: boolean;
}) {
  // No navigation header sits above these screens, so the content clears the
  // status bar / notch itself. A TitleBand or canopy at the top bleeds back up
  // under it (see useTopBleed).
  const insets = useSafeAreaInsets();
  const frame = { maxWidth: wide ? WEB_MAX_WIDTH : COLUMN_MAX_WIDTH, paddingTop: insets.top + space.xl };
  if (!scroll) return <View style={[styles.screenStatic, frame]}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, frame, { paddingBottom: space.hero + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/**
 * How far a full-bleed header (TitleBand, ForestCanopy) must reach up to cover
 * the status bar, and how much padding it then needs so its own text clears it.
 */
export function useTopBleed() {
  const insets = useSafeAreaInsets();
  return { marginTop: -(space.xl + insets.top), inset: insets.top };
}

/**
 * The field-guide title band: a flat strip of canopy colour across the top of
 * a screen, a small plate number, the title, and a specimen leaf cropped by the
 * right edge. Bleeds past the screen padding on purpose.
 */
export function TitleBand({
  plate,
  title,
  children,
  onBack,
  top,
}: {
  plate: string;
  title: string;
  children?: ReactNode;
  /** Onboarding steps: a back link in the band instead of a native header. */
  onBack?: () => void;
  /** Anything that belongs above the plate (the session's presence row). */
  top?: ReactNode;
}) {
  const bleed = useTopBleed();
  return (
    <View style={[styles.band, { marginTop: bleed.marginTop, paddingTop: space.xxl + bleed.inset }]}>
      <FernLeaf size={190} angle={-200} opacity={0.4} style={[styles.bandLeaf, { top: -28 + bleed.inset }]} />
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Icon name="back" size={20} color={colors.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      ) : null}
      {top}
      <Text style={styles.plate}>{plate}</Text>
      <Text style={styles.bandTitle} accessibilityRole="header">
        {title}
      </Text>
      {children ? <View style={styles.bandBody}>{children}</View> : null}
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
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

/** One big number per screen. */
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
  icon,
}: {
  label: string;
  onPress: () => void;
  /** `danger` is for the one irreversible control (Menu's reset). */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'dangerArmed';
  disabled?: boolean;
  icon?: IconName;
}) {
  const tint =
    variant === 'primary' || variant === 'dangerArmed'
      ? colors.onAccent
      : variant === 'secondary'
        ? colors.ink
        : variant === 'danger'
          ? colors.error
          : colors.ink2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'quiet' && styles.buttonQuiet,
        variant === 'danger' && styles.buttonDanger,
        variant === 'dangerArmed' && styles.buttonDangerArmed,
        pressed && (variant === 'primary' ? styles.pressedPrimary : styles.pressed),
        disabled && styles.disabled,
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={tint} /> : null}
      <Text
        style={[
          styles.buttonLabel,
          { color: tint },
          variant === 'quiet' && styles.buttonLabelQuiet,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Answers, locks, pins and goal picks. Same 6px radius as everything else. */
export function Chip({
  label,
  onPress,
  selected,
  tint,
  icon,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  tint?: string;
  icon?: IconName;
  accessibilityLabel?: string;
}) {
  const color = selected ? tint ?? colors.accent : colors.ink2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected, disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: colors.surfaceRaised, borderColor: color },
        pressed && styles.pressed,
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={color} /> : null}
      {label ? (
        <Text style={[styles.chipLabel, selected && { color: colors.ink }]}>{label}</Text>
      ) : null}
    </Pressable>
  );
}

/** Lists are ruled rows, not boxed cards. Row height 64px. */
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
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? <Text style={styles.rowSub}>{sublabel}</Text> : null}
      </View>
      {value ? <Text style={[styles.rowValue, tabularNums]}>{value}</Text> : null}
      {right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressedRow}
    >
      {content}
    </Pressable>
  );
}

/** A short seafoam path-tick, then the heading. Sentence case, never all caps. */
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTick} />
      <Text style={styles.sectionHeaderText} accessibilityRole="header">
        {children}
      </Text>
    </View>
  );
}

/** A member: their initial inside a thin ring of their colour. Dimmed when away. */
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
      accessibilityLabel={`${name}${online ? '' : ', away'}`}
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
          opacity: online ? 1 : 0.4,
        },
      ]}
    >
      <Text style={[styles.avatarLabel, { color, fontSize: size * 0.44, lineHeight: size * 0.6 }]}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

/** "Jordan: 3 of 4" — counts only. */
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
      <View style={[styles.progressDot, { backgroundColor: color, opacity: online ? 1 : 0.4 }]} />
      <Text style={[styles.progressText, tabularNums]}>
        <Text style={{ color }}>{name}</Text>: {done} of {total}
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
  label,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'words' | 'characters';
  keyboardType?: 'default' | 'number-pad';
  maxLength?: number;
  align?: 'left' | 'center';
  label?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.ink3}
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      maxLength={maxLength}
      accessibilityLabel={label ?? placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.field,
        focused && styles.fieldFocused,
        align === 'center' && styles.fieldCentered,
      ]}
    />
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const SLOW_MS = 8000;

/**
 * Only render this when there are no rows *and* the table is not ready
 * (14 Research Notes: the isReady flashing bug).
 *
 * Never-stuck (Stage 8, checked by verify:screens S2): six screens fall back to
 * this, so it cannot wait in silence. After SLOW_MS it says what it is waiting
 * for, names the connection problem when there is one, and offers a reload.
 */
export function Loading({ label = 'Loading…', hint }: { label?: string; hint?: string }) {
  const [slow, setSlow] = useState(false);
  const { error, host } = useConnectionTrouble();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.loading, { paddingTop: space.hero + insets.top }]} accessibilityRole="progressbar" accessibilityLabel={label}>
      <FernLeaf size={72} angle={-60} opacity={0.6} />
      <Text style={styles.loadingText}>{label}</Text>

      {slow || error ? (
        <View style={styles.loadingHelp}>
          <Text style={styles.loadingHint}>
            {error
              ? `Can't reach the planner at ${host}. ${error}`
              : hint ?? 'This is taking longer than it should.'}
          </Text>
          {/* Reload is the only recovery the app can offer by itself: the
              connection is owned by the provider above. */}
          {Platform.OS === 'web' ? (
            <Button
              label="Reload"
              variant="secondary"
              onPress={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
            />
          ) : (
            <Text style={styles.loadingHint}>Close and reopen the app to try again.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** A note set against a single vertical rule — never a box. */
export function Notice({
  children,
  tone = 'quiet',
}: {
  children: ReactNode;
  tone?: 'quiet' | 'warn' | 'error';
}) {
  const ruleColor =
    tone === 'warn' ? colors.warn : tone === 'error' ? colors.error : colors.ruleStrong;
  return (
    <View style={[styles.notice, { borderLeftColor: ruleColor }]}>
      <Text style={[styles.noticeText, tone !== 'quiet' && { color: colors.ink }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: {
    paddingHorizontal: space.sidePadding,
    width: '100%',
    alignSelf: 'center',
  },
  screenStatic: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: space.sidePadding,
    width: '100%',
    alignSelf: 'center',
  },

  band: {
    backgroundColor: colors.band,
    marginHorizontal: -space.sidePadding,
    marginBottom: space.xxl,
    paddingHorizontal: space.sidePadding,
    paddingBottom: space.xl,
    borderBottomWidth: line.hair,
    borderBottomColor: colors.ruleStrong,
    overflow: 'hidden',
  },
  bandLeaf: { position: 'absolute', right: -64 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingRight: space.md,
    marginTop: -space.lg,
    marginBottom: space.xs,
    marginLeft: -6,
  },
  backText: { ...typeScale.label, color: colors.ink },
  plate: { ...typeScale.plate, color: colors.accent, marginBottom: space.sm },
  bandTitle: { ...typeScale.title, color: colors.ink, maxWidth: '82%' },
  bandBody: { marginTop: space.md, maxWidth: 440 },

  display: { ...typeScale.display, color: colors.ink },
  title: { ...typeScale.title, color: colors.ink, marginBottom: space.sm },
  headline: { ...typeScale.headline, color: colors.ink },
  body: { ...typeScale.body, color: colors.ink },
  caption: { ...typeScale.caption, color: colors.ink2 },
  dim: { color: colors.ink2 },

  hero: { marginBottom: space.lg, alignItems: 'center' },

  button: {
    minHeight: 50,
    borderRadius: radius,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
  },
  buttonQuiet: { backgroundColor: 'transparent', minHeight: 44, paddingVertical: space.sm },
  buttonDanger: { backgroundColor: 'transparent', borderWidth: line.hair, borderColor: colors.error },
  buttonDangerArmed: { backgroundColor: colors.error },
  buttonLabel: { fontFamily: fonts.textSemi, fontSize: 16, lineHeight: 22 },
  buttonLabelQuiet: { fontFamily: fonts.textMedium, textDecorationLine: 'underline' },
  pressed: { backgroundColor: colors.surfaceHover },
  pressedPrimary: { opacity: 0.85 },
  pressedRow: { backgroundColor: colors.surface },
  disabled: { opacity: 0.4 },

  chip: {
    borderRadius: radius,
    borderWidth: line.hair,
    borderColor: colors.rule,
    backgroundColor: 'transparent',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    gap: space.xs + 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipLabel: { ...typeScale.label, color: colors.ink2 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: line.hair,
    borderBottomColor: colors.rule,
  },
  rowText: { flex: 1 },
  rowLabel: { fontFamily: fonts.textMedium, fontSize: 16, lineHeight: 22, color: colors.ink },
  rowSub: { ...typeScale.caption, color: colors.ink2, marginTop: 2 },
  rowValue: { ...typeScale.numeral, fontSize: 18, color: colors.ink },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xxl,
    marginBottom: space.sm,
  },
  sectionTick: { width: 14, height: line.path, backgroundColor: colors.accent },
  sectionHeaderText: { ...typeScale.label, color: colors.ink2 },

  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: line.path,
    backgroundColor: colors.bg,
  },
  avatarLabel: { fontFamily: fonts.textSemi },

  progressPill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  progressText: { ...typeScale.caption, color: colors.ink2 },

  field: {
    ...typeScale.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: 50,
    marginTop: space.sm,
  },
  fieldFocused: { borderColor: colors.accent },
  fieldCentered: {
    textAlign: 'center',
    letterSpacing: 8,
    fontFamily: fonts.numeral,
    fontSize: 28,
  },

  divider: { height: line.hair, backgroundColor: colors.rule, marginVertical: space.lg },

  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: space.sidePadding,
    paddingBottom: space.hero,
    alignItems: 'center',
    gap: space.md,
  },
  loadingText: { ...typeScale.bodyItalic, color: colors.ink2 },
  loadingHelp: { marginTop: space.md, gap: space.sm, maxWidth: 420, alignItems: 'center' },
  loadingHint: { ...typeScale.caption, color: colors.ink2, textAlign: 'center' },

  notice: {
    borderLeftWidth: 2,
    paddingLeft: space.md,
    paddingVertical: space.xs,
    marginTop: space.lg,
  },
  noticeText: { ...typeScale.caption, fontSize: 14, lineHeight: 20, color: colors.ink2 },
});
