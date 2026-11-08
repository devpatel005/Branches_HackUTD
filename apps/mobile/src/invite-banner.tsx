import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar } from './components';
import { useOpenSession, useSessionMembers } from './session';
import { useActiveEvent } from './events';
import { EVENT_TEMPLATE_LIST } from './events';
import { memberColor, useMe } from './household';
import { colors, space, type as typeScale } from './theme';

/**
 * The in-app session invite — 08 Live Session Spec#Lifecycle.
 *
 * Shown on the tabs when a session is open that this member has not joined:
 * "Maya started a planning session: a baby on the way". Tapping opens it.
 *
 * In-app rather than a push notification: push is unreliable in Expo Go and is
 * a stretch goal (OPEN(OD-10)). Deliberately absent from onboarding — a partner
 * still confirming their accounts has no plan to hold a session about.
 */
export function InviteBanner() {
  const router = useRouter();
  const { me } = useMe();
  const { session } = useOpenSession();
  const participants = useSessionMembers(session?.id);
  const { event } = useActiveEvent();

  if (!session || !me) return null;

  const mine = participants.find(p => p.member.id === me.id);
  // Already in it, on this device or another — nothing to invite.
  if (mine?.state.present) return null;

  const starter = participants.find(p => p.member.id === session.startedBy);
  const label =
    EVENT_TEMPLATE_LIST.find(t => t.id === event?.templateId)?.label ?? 'your plan';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/session')}
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.8 }]}
    >
      {starter ? (
        <Avatar
          name={starter.member.displayName}
          color={memberColor(starter.member.colorKey)}
          size={28}
        />
      ) : null}
      <View style={styles.text}>
        <Text style={styles.title}>
          {starter ? `${starter.member.displayName} started a planning session` : 'A planning session is open'}
        </Text>
        <Text style={styles.subtitle}>{label} · tap to join</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    marginHorizontal: space.sidePadding,
    marginTop: space.sm,
  },
  text: { flex: 1 },
  title: { ...typeScale.body, color: colors.textPrimary, fontWeight: '600' },
  subtitle: { ...typeScale.caption, color: colors.textSecondary, marginTop: 2 },
});
