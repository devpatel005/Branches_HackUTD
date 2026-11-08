import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InviteBanner } from '../../src/invite-banner';
import { Icon, type IconName } from '../../src/icons';
import { colors, fonts } from '../../src/theme';

/**
 * Four tabs: Home, Timeline, Chat, Menu (09 Design System#Layout, 10 Screens).
 * Menu is the reset-and-diagnostics page; it is last so a stray tap during the
 * demo is unlikely to land on it.
 *
 * Line icons from src/icons.tsx: a spruce for the plan, a path with stops for
 * the timeline, a speech outline for chat, three rules for the menu.
 */
const BAR_HEIGHT = 58;

function tabIcon(name: IconName) {
  return ({ color }: { color: ColorValue }) => (
    <Icon name={name} size={24} color={typeof color === 'string' ? color : colors.ink2} />
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const barHeight = BAR_HEIGHT + insets.bottom;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.bg,
            borderTopColor: colors.rule,
            borderTopWidth: 1,
            height: barHeight,
            paddingTop: 6,
            paddingBottom: insets.bottom + 4,
          },
          tabBarLabelStyle: { fontFamily: fonts.textMedium, fontSize: 12 },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.ink2,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('plan') }} />
        <Tabs.Screen name="timeline" options={{ title: 'Timeline', tabBarIcon: tabIcon('timeline') }} />
        <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: tabIcon('chat') }} />
        <Tabs.Screen name="menu" options={{ title: 'Menu', tabBarIcon: tabIcon('menu') }} />
      </Tabs>

      {/* The session invite floats just above the tab bar on every tab
          (08 Live Session Spec: "on any screen"), where a thumb already is,
          instead of pushing each screen's header down under the notch. */}
      <InviteBanner bottomOffset={barHeight + 8} />
    </View>
  );
}
