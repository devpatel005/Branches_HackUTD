import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { colors, space, type as typeScale } from './theme';

/**
 * Hold-to-confirm — 09 Design System#Signature components, and the moment the
 * whole product is built around.
 *
 * One arc segment per member in their colour. Your own segment fills while you
 * hold; a partner's fills when theirs is ready. `onReady(true)` fires only once
 * the hold reaches `HOLD_MS`, and `onReady(false)` the moment the finger lifts —
 * so both people are still holding when the server commits
 * (08 Live Session Spec#Ready check). That is what makes it simultaneous rather
 * than "both pressed at some point".
 *
 * The server decides; this control only reports. A commit can therefore never
 * depend on a client's clock being honest.
 */

/** OPEN(OD-6): 1.5 seconds. */
export const HOLD_MS = 1500;

const SIZE = 180;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CENTRE = SIZE / 2;

export type RingMember = {
  memberId: string;
  name: string;
  colour: string;
  ready: boolean;
  isMe: boolean;
};

/** An SVG arc for one segment of the ring, with a small gap between segments. */
function arcPath(index: number, count: number, progress: number): string {
  const gap = count > 1 ? 0.06 : 0;
  const span = (Math.PI * 2) / count - gap;
  // Start at the top and run clockwise, so the first segment reads as "mine".
  const start = -Math.PI / 2 + index * ((Math.PI * 2) / count) + gap / 2;
  const end = start + span * Math.max(0, Math.min(1, progress));
  if (progress <= 0.001) return '';

  const x1 = CENTRE + RADIUS * Math.cos(start);
  const y1 = CENTRE + RADIUS * Math.sin(start);
  const x2 = CENTRE + RADIUS * Math.cos(end);
  const y2 = CENTRE + RADIUS * Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Haptics are phone-only and must no-op on web (02 Ground Rules #6). */
const haptic = {
  tick: () => {
    if (Platform.OS === 'web') return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
  success: () => {
    if (Platform.OS === 'web') return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined
    );
  },
};

export function ReadyRing({
  members,
  branchName,
  committed,
  onReady,
  disabledReason,
}: {
  members: readonly RingMember[];
  branchName: string;
  committed: boolean;
  onReady: (ready: boolean) => void;
  /** When set, the control is shown but cannot be held, with this explanation. */
  disabledReason?: string;
}) {
  const [progress, setProgress] = useState(0);
  const holding = useRef(false);
  const frame = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTick = useRef(0);
  const reported = useRef(false);

  const stop = () => {
    if (frame.current) clearInterval(frame.current);
    frame.current = null;
    holding.current = false;
    setProgress(0);
    lastTick.current = 0;
    if (reported.current) {
      reported.current = false;
      // Lifting a finger is a withdrawal of consent, so tell the server at once.
      onReady(false);
    }
  };

  useEffect(() => stop, []);

  useEffect(() => {
    if (committed) {
      haptic.success();
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed]);

  const start = () => {
    if (disabledReason || committed || holding.current) return;
    holding.current = true;
    const began = Date.now();
    frame.current = setInterval(() => {
      const elapsed = Date.now() - began;
      const next = Math.min(1, elapsed / HOLD_MS);
      setProgress(next);

      // A tick every quarter of the way, so the hold has a felt rhythm.
      const step = Math.floor(next * 4);
      if (step > lastTick.current) {
        lastTick.current = step;
        haptic.tick();
      }

      if (next >= 1 && !reported.current) {
        reported.current = true;
        onReady(true);
      }
    }, 40);
  };

  const me = members.find(m => m.isMe);
  const others = members.filter(m => !m.isMe);
  const waitingFor = others.filter(m => !m.ready);
  const everyoneReady = members.length > 0 && members.every(m => m.ready);

  const caption = committed
    ? 'This is your plan now'
    : disabledReason
      ? disabledReason
      : everyoneReady
        ? 'Keep holding…'
        : reported.current && waitingFor.length > 0
          ? `${waitingFor.map(m => m.name).join(' and ')} — your turn`
          : others.some(m => m.ready)
            ? `${others.filter(m => m.ready).map(m => m.name).join(' and ')} is ready — hold to agree`
            : 'Press and hold together';

  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Hold to make ${branchName} our plan`}
        onPressIn={start}
        onPressOut={stop}
        disabled={Boolean(disabledReason) || committed}
        style={styles.touch}
      >
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={CENTRE}
            cy={CENTRE}
            r={RADIUS}
            stroke={colors.hairline}
            strokeWidth={STROKE}
            fill="none"
          />
          {members.map((member, index) => {
            // Mine fills live while I hold; a partner's is all-or-nothing,
            // because their hold is not mine to animate.
            const filled = member.isMe ? Math.max(progress, member.ready ? 1 : 0) : member.ready ? 1 : 0;
            const d = arcPath(index, members.length, filled);
            if (!d) return null;
            return (
              <Path
                key={member.memberId}
                d={d}
                stroke={member.colour}
                strokeWidth={STROKE}
                strokeLinecap="round"
                fill="none"
              />
            );
          })}
        </Svg>

        <View style={styles.label} pointerEvents="none">
          <Text style={styles.labelTitle}>{committed ? '✓' : 'Hold'}</Text>
          <Text style={styles.labelBranch} numberOfLines={2}>
            {branchName}
          </Text>
        </View>
      </Pressable>

      <Text style={[styles.caption, committed && { color: colors.accent }]}>{caption}</Text>

      <View style={styles.legend}>
        {members.map(member => (
          <View key={member.memberId} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: member.colour, opacity: member.ready ? 1 : 0.25 },
              ]}
            />
            <Text style={styles.legendName}>
              {member.isMe ? 'You' : member.name}
              {member.ready ? ' · ready' : ''}
            </Text>
          </View>
        ))}
      </View>

      {me === undefined ? (
        <Text style={styles.caption}>Join the session to take part.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', marginTop: space.lg },
  touch: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  label: { position: 'absolute', alignItems: 'center', paddingHorizontal: space.lg },
  labelTitle: { ...typeScale.title, color: colors.textPrimary },
  labelBranch: {
    ...typeScale.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: space.xs,
  },
  caption: { ...typeScale.caption, color: colors.textSecondary, marginTop: space.md, textAlign: 'center' },
  legend: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { ...typeScale.caption, color: colors.textSecondary },
});
