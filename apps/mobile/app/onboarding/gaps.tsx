import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import {
  Body,
  Button,
  Caption,
  Chip,
  Notice,
  ProgressPill,
  Screen,
  Title,
} from '../../src/components';
import { memberColor, useMyGaps, useProgress } from '../../src/household';
import { space } from '../../src/theme';

/**
 * "Fill the gaps" — 10 Screens#Onboarding, step 2.
 *
 * One question per screen, answered with chips. These are only the things
 * inference genuinely cannot tell from the data (06 Engine Spec): a transfer to
 * a brokerage looks identical whether it is retirement or investing.
 *
 * Answering "Retirement" settles it — that money is set aside and v1 asks for no
 * balance. Answering "Investing" reclassifies the item and asks for a range,
 * because that money might be reachable for goals.
 */
export default function GapsScreen() {
  const router = useRouter();
  const { gaps, unanswered } = useMyGaps();
  const progress = useProgress();
  const answerGap = useReducer(reducers.answerGap);
  const [error, setError] = useState<string | null>(null);

  const current = unanswered[0];

  if (!current) {
    return (
      <Screen>
        <Title>Nothing left to ask</Title>
        <Body dim>
          {gaps.length > 0
            ? 'Thanks — that was everything the data could not tell us.'
            : 'We found everything we needed in your transactions.'}
        </Body>
        <Button label="Next" onPress={() => router.push('/onboarding/fun-money')} />
      </Screen>
    );
  }

  const answered = gaps.length - unanswered.length;

  return (
    <Screen>
      <Caption>
        Question {answered + 1} of {gaps.length}
      </Caption>
      <Title>{current.prompt}</Title>

      <View style={styles.chips}>
        {current.options.map(option => (
          <Chip
            key={option}
            label={option}
            onPress={async () => {
              setError(null);
              try {
                await answerGap({ questionId: current.id, answer: option });
              } catch (e) {
                setError(messageOf(e));
              }
            }}
          />
        ))}
      </View>

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <View style={styles.progressRow}>
        {progress.partners.map(p => (
          <ProgressPill
            key={String(p.memberId)}
            name={p.displayName}
            color={memberColor(p.colorKey)}
            done={p.gapsAnswered}
            total={p.gapsTotal}
            online={p.online}
          />
        ))}
      </View>

      <Notice>
        Money you've set aside for retirement stays out of the plan's goals — we just need to
        know which transfers are which.
      </Notice>
    </Screen>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  progressRow: { flexDirection: 'row', gap: space.md, marginTop: space.xl, flexWrap: 'wrap' },
});
