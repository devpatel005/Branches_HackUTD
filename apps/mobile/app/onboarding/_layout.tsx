import { Stack } from 'expo-router';
import { colors } from '../../src/theme';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="confirm" options={{ title: '' }} />
      <Stack.Screen name="gaps" options={{ title: '' }} />
      <Stack.Screen name="fun-money" options={{ title: '' }} />
      <Stack.Screen name="goals" options={{ title: '' }} />
    </Stack>
  );
}
