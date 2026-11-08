import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform } from 'react-native';
import { colors, WEB_MAX_WIDTH } from '../src/theme';
import { BranchesSpacetimeProvider } from '../src/spacetime';

export default function RootLayout() {
  return (
    <BranchesSpacetimeProvider>
      <StatusBar style="light" />
      <View style={styles.shell}>
        <View style={styles.column}>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.textPrimary,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </View>
      </View>
    </BranchesSpacetimeProvider>
  );
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
