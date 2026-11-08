import { Tabs } from 'expo-router';
import { Text, View, type ColorValue } from 'react-native';
import { InviteBanner } from '../../src/invite-banner';
import { colors } from '../../src/theme';

/**
 * Four tabs: Home, Timeline, Chat, Menu (09 Design System#Layout).
 * Menu is the reset-and-diagnostics page; it is last so a stray tap during the
 * demo is unlikely to land on it.
 * Icons are emoji for now so Stage 0 pulls in no icon dependency.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    // The invite banner sits above the tabs, so it shows on Home, Timeline and
    // Chat at once rather than being re-mounted per screen
    // (08 Live Session Spec: "on any screen").
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <InviteBanner />
      <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.hairline },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
        <Tabs.Screen
          name="index"
          options={{ title: 'Home', tabBarIcon: ({ color }) => <TabIcon glyph="◎" color={color} /> }}
        />
        <Tabs.Screen
          name="timeline"
          options={{ title: 'Timeline', tabBarIcon: ({ color }) => <TabIcon glyph="≡" color={color} /> }}
        />
        <Tabs.Screen
          name="chat"
          options={{ title: 'Chat', tabBarIcon: ({ color }) => <TabIcon glyph="◇" color={color} /> }}
        />
        <Tabs.Screen
          name="menu"
          options={{ title: 'Menu', tabBarIcon: ({ color }) => <TabIcon glyph="≔" color={color} /> }}
        />
      </Tabs>
    </View>
  );
}
