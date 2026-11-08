import { Stack, useRouter } from 'expo-router';
import { Body, Button, Screen, TitleBand } from '../src/components';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <TitleBand plate="Off the path" title="This screen doesn't exist.">
          <Body dim>The link may be old, or the page moved. Your plan is fine.</Body>
        </TitleBand>
        <Button label="Go to Home" onPress={() => router.replace('/')} />
      </Screen>
    </>
  );
}
