import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar } from './components';
import { Icon, eventIcon } from './icons';
import { useOpenSession, useSessionMembers } from './session';
import { useActiveEvent } from './events';
import { EVENT_TEMPLATE_LIST } from './events';
import { memberColor, useMe } from './household';
import { colors, fonts, line, radius, space, type as typeScale } from './theme';

/**
 * The in-app session invite — 08 Live Session Spec#Lifecycle.
 *
 * Shown on the tabs when a session is open that this member has not joined:
 * "Maya started a planning session: a baby on the way". Tapping opens it.
 *
 * In-app rather than a push notification: push is unreliable in Expo Go and is
 * a stretch goal (OPEN(OD-10)). Deliberately absent from onboarding — a partner
 * still confirming their accounts has no plan to hold a session about.
 *
 * It floats above the tab bar (`bottomOffset`), drawn as a strip of canopy with
 * a rule in the starter's colour: the one thing on screen asking for a tap.
 */
export function InviteBanner({ bottomOffset = 74 }: { bottomOffset?: number }) {
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
  const starterColor = starter ? memberColor(starter.member.colorKey) : colors.accent;
  const label =
    EVENT_TEMPLATE_LIST.find(t => t.id === event?.templateId)?.label ?? 'your plan';

  return (
    <View pointerEvents="box-none" style={[styles.dock, { bottom: bottomOffset }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${starter ? `${starter.member.displayName} started a planning session` : 'A planning session is open'}: ${label}. Join it.`}
        onPress={() => router.push('/session')}
        style={({ pressed }) => [
          styles.banner,
          { borderLeftColor: starterColor },
          pressed && { backgroundColor: colors.surfaceHover },
        ]}
      >
        {starter ? (
          <Avatar
            name={starter.member.displayName}
            color={starterColor}
            size={32}
          />
        ) : (
          <Icon name={eventIcon(event?.templateId)} size={24} color={colors.accent} />
        )}
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {starter ? `${starter.member.displayName} started a planning session` : 'A planning session is open'}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {label} · tap to join
          </Text>
        </View>
        <Icon name="forward" size={20} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: space.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    backgroundColor: colors.band,
    borderRadius: radius,
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
    borderLeftWidth: 3,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  text: { flex: 1 },
  title: { fontFamily: fonts.textSemi, fontSize: 15, lineHeight: 20, color: colors.ink },
  subtitle: { ...typeScale.caption, color: colors.ink2, marginTop: 1 },
});
