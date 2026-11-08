import { Stack } from 'expo-router';
import { colors } from '../../src/theme';

/**
 * Onboarding steps draw their own title band with a Back link, so no native
 * header sits above them (the band reaches up under the status bar instead).
 * Swipe-back still works on iOS.
 */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="confirm" />
      <Stack.Screen name="gaps" />
      <Stack.Screen name="fun-money" />
      <Stack.Screen name="goals" />
    </Stack>
  );
}
