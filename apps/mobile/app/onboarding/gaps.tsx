import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import { Body, Button, Notice, ProgressPill, Screen, TitleBand } from '../../src/components';
import { Icon } from '../../src/icons';
import { memberColor, useMyGaps, useProgress } from '../../src/household';
import { colors, fonts, line, space } from '../../src/theme';

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
        <TitleBand plate="Step 2 of 4" title="Nothing left to ask." onBack={() => router.back()}>
          <Body dim>
            {gaps.length > 0
              ? 'Thanks. That was everything the data could not tell us.'
              : 'We found everything we needed in your transactions.'}
          </Body>
        </TitleBand>
        <Button label="Continue to fun money" onPress={() => router.push('/onboarding/fun-money')} />
      </Screen>
    );
  }

  const answered = gaps.length - unanswered.length;

  return (
    <Screen>
      <TitleBand
        plate={`Step 2 of 4 · Question ${answered + 1} of ${gaps.length}`}
        title={current.prompt}
        onBack={() => router.back()}
      />

      {/* One question per screen; each answer is a full-width row, easy to hit
          with a thumb, and choosing one moves straight on. */}
      <View style={styles.answers}>
        {current.options.map(option => (
          <Pressable
            key={option}
            accessibilityRole="button"
            onPress={async () => {
              setError(null);
              try {
                await answerGap({ questionId: current.id, answer: option });
              } catch (e) {
                setError(messageOf(e));
              }
            }}
            style={({ pressed }) => [styles.answer, pressed && { backgroundColor: colors.surface }]}
          >
            <Text style={styles.answerText}>{option}</Text>
            <Icon name="forward" size={20} color={colors.ink2} />
          </Pressable>
        ))}
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}

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
        Money you've set aside for retirement stays out of the plan's goals. We just need to know
        which transfers are which.
      </Notice>
    </Screen>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  answers: { borderTopWidth: line.hair, borderTopColor: colors.rule },
  answer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
    paddingVertical: space.md,
    borderBottomWidth: line.hair,
    borderBottomColor: colors.rule,
    gap: space.md,
  },
  answerText: { fontFamily: fonts.textMedium, fontSize: 17, lineHeight: 24, color: colors.ink, flex: 1 },
  progressRow: { flexDirection: 'row', gap: space.lg, marginTop: space.xl, flexWrap: 'wrap' },
});
