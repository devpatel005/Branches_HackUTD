import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BranchesSpacetimeProvider } from '../src/spacetime';
import { useHousehold, useMe } from '../src/household';
import { colors, WEB_MAX_WIDTH } from '../src/theme';

export default function RootLayout() {
  return (
    <BranchesSpacetimeProvider>
      <StatusBar style="light" />
      <View style={styles.shell}>
        <View style={styles.column}>
          <RouteGate />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.textPrimary,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="welcome" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="session" options={{ headerShown: false }} />
          </Stack>
        </View>
      </View>
    </BranchesSpacetimeProvider>
  );
}

/**
 * Sends each device to the right part of the journey (03 User Journey).
 *
 * Not a member yet -> Welcome. A member whose household has not finished
 * onboarding -> the onboarding flow. Otherwise -> the tabs.
 *
 * Deliberately never redirects while tables are still empty and not ready:
 * doing so would bounce the user to Welcome for a frame on every reload, and
 * on every reducer call thanks to the `isReady` flashing bug
 * (14 Research Notes#SpacetimeDB).
 */
function RouteGate() {
  const router = useRouter();
  const segments = useSegments();
  const { me, members, ready } = useMe();
  const household = useHousehold();

  const section = segments[0];

  useEffect(() => {
    const settled = ready || members.length > 0;
    if (!settled) return;

    if (!me) {
      if (section !== 'welcome') router.replace('/welcome');
      return;
    }
    if (household && !household.onboarded) {
      if (section !== 'onboarding') router.replace('/onboarding/confirm');
      return;
    }
    if (section === 'welcome' || section === 'onboarding') router.replace('/');
  }, [me, household, ready, members.length, section, router]);

  return null;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  // Web renders as a centred column (10 Screens); phones fill the screen.
  column: {
    flex: 1,
    width: '100%',
    ...(Platform.OS === 'web' ? { maxWidth: WEB_MAX_WIDTH } : null),
  },
});
