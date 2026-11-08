import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@branches/bindings';
import { Body, Button, Caption, Notice, Row, SectionHeader } from './components';
import { Sheet, ShowTheMath } from './sheets';
import { useGoals } from './projection';
import { useHousehold } from './household';
import { planMonthLabel } from './projection';
import type { AffordabilityPayload, StoredImpact } from './events';
import { dollars } from './format';
import { colors, space, tabularNums, type as typeScale } from './theme';

/**
 * The impact card — 10 Screens#Chat.
 *
 * Goals affected with their shortfalls, tight years before and after, the
 * emergency-fund change, the free-to-plan change, and **Start planning
 * session** (inert until Stage 7).
 *
 * Every number opens "Show the Math", and because an impact number is a
 * *difference*, its sheet also lists the event's attributed effects — the "why
 * it changed" block.
 */
export function ImpactCard({
  impact,
  eventId,
  eventLabel,
}: {
  impact: StoredImpact;
  eventId: bigint;
  eventLabel: string;
}) {
  const household = useHousehold();
  const { goals } = useGoals();
  const dismissEvent = useReducer(reducers.dismissEvent);

  const [math, setMath] = useState<{ label: string; path: string } | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleOf = (goalId: string) =>
    goals.find(g => String(g.id) === goalId)?.title ?? 'A goal';

  const emergencyDelta = impact.emergencyMonthsMinAfter - impact.emergencyMonthsMinBefore;
  const tightDelta = impact.tightYearsAfter.length - impact.tightYearsBefore.length;

  return (
    <View style={styles.card}>
      <Caption>{eventLabel}</Caption>

      {impact.noImpact ? (
        <>
          <Text style={styles.headline}>This doesn't change your goals.</Text>
          <Body dim>
            Everything still fits. You can keep the plan exactly as it is.
          </Body>
        </>
      ) : (
        <>
          <Text style={[styles.headline, styles.headlineAtRisk]}>
            {impact.newlyAtRiskGoalIds.length === 1
              ? `${titleOf(impact.newlyAtRiskGoalIds[0]!)} no longer fits.`
              : `${impact.newlyAtRiskGoalIds.length} goals no longer fit.`}
          </Text>

          {impact.newlyAtRiskGoalIds.map(goalId => (
            <Row
              key={goalId}
              label={titleOf(goalId)}
              sublabel="short by this much when it's due"
              value={dollars(Math.round((impact.shortfallsByGoalId[goalId] ?? 0) * 100))}
              onPress={() =>
                setMath({
                  label: `${titleOf(goalId)} is short`,
                  path: `impact.shortfall.${goalId}`,
                })
              }
            />
          ))}
        </>
      )}

      <SectionHeader>What it does to the plan</SectionHeader>
      <Row
        label="Tight years"
        value={`${impact.tightYearsBefore.length} → ${impact.tightYearsAfter.length}`}
        sublabel={tightDelta > 0 ? `${tightDelta} more` : 'no change'}
        onPress={() => setMath({ label: 'Tight years', path: 'impact.tightYears' })}
      />
      <Row
        label="Emergency fund, at its lowest"
        value={`${impact.emergencyMonthsMinBefore.toFixed(1)} → ${impact.emergencyMonthsMinAfter.toFixed(1)} mo`}
        sublabel={
          Math.abs(emergencyDelta) < 0.05 ? 'no change' : `${emergencyDelta.toFixed(1)} months`
        }
        onPress={() =>
          setMath({ label: 'Emergency fund', path: 'impact.emergencyMonthsMin' })
        }
      />
      <Row
        label="Free to plan each month"
        value={`${dollars(Math.round(impact.freeToPlanBefore * 100))} → ${dollars(
          Math.round(impact.freeToPlanAfter * 100)
        )}`}
        sublabel={
          impact.freeToPlanAfter === impact.freeToPlanBefore
            ? 'unchanged today — the cost starts later'
            : undefined
        }
        onPress={() => setMath({ label: 'Free to plan', path: 'impact.freeToPlan' })}
      />

      <Button label="Why?" variant="quiet" onPress={() => setWhyOpen(true)} />

      {error ? <Notice tone="warn">{error}</Notice> : null}

      {impact.noImpact ? (
        <Button
          label="Keep the plan"
          onPress={async () => {
            setError(null);
            try {
              await dismissEvent({ eventId });
            } catch (e) {
              setError(messageOf(e));
            }
          }}
        />
      ) : (
        <>
          {/* Inert until Stage 7 builds the live session. */}
          <Button label="Start planning session" onPress={() => setError('Planning sessions arrive in a later stage.')} />
          <Button
            label="Keep the plan as it is"
            variant="quiet"
            onPress={async () => {
              setError(null);
              try {
                await dismissEvent({ eventId });
              } catch (e) {
                setError(messageOf(e));
              }
            }}
          />
        </>
      )}

      <ShowTheMath
        visible={math !== null}
        onClose={() => setMath(null)}
        label={math?.label ?? ''}
        record={math ? impact.provenance[math.path] : undefined}
      />

      <Sheet visible={whyOpen} onClose={() => setWhyOpen(false)} title="Why the plan changed">
        <Body dim>
          These are the changes the projection applied, month by month.
        </Body>
        {impact.effects.map((effect, index) => (
          <Row
            key={`${effect.cause}-${index}`}
            label={effect.label}
            sublabel={
              household
                ? `from ${planMonthLabel(household.currentMonth, effect.fromMonth)}`
                : undefined
            }
          />
        ))}
        <Caption>
          Nothing here is an estimate made up for this screen — it's exactly what the engine put
          into the ten-year simulation.
        </Caption>
      </Sheet>
    </View>
  );
}

/** The affordability answer — in time as well as dollars. */
export function AffordabilityCard({ payload }: { payload: AffordabilityPayload }) {
  const { goals } = useGoals();
  const titleOf = (goalId: string) =>
    goals.find(g => String(g.id) === goalId)?.title ?? 'A goal';

  const fundDrop = payload.emergencyMonthsMinBefore - payload.emergencyMonthsMinAfter;

  return (
    <View style={styles.card}>
      <Caption>Can we afford {payload.label}?</Caption>
      <Text style={[styles.headline, !payload.affordableWithoutChanges && styles.headlineAtRisk]}>
        {payload.affordableWithoutChanges
          ? 'No goal changes.'
          : `${payload.newlyAtRiskGoalIds.map(titleOf).join(' and ')} would stop fitting.`}
      </Text>

      <Row
        label="Emergency fund, at its lowest"
        value={`${payload.emergencyMonthsMinBefore.toFixed(1)} → ${payload.emergencyMonthsMinAfter.toFixed(1)} mo`}
        sublabel={fundDrop >= 0.05 ? `${fundDrop.toFixed(1)} months lower` : 'barely moves'}
      />
      {payload.tightMonthsAfter > payload.tightMonthsBefore ? (
        <Row
          label="Months that turn tight"
          value={String(payload.tightMonthsAfter - payload.tightMonthsBefore)}
          sublabel="the fund dips below its floor"
        />
      ) : null}

      {Object.entries(payload.minimalDelayByGoalId).map(([goalId, months]) =>
        months === null ? null : (
          <Row
            key={goalId}
            label={`Or push ${titleOf(goalId)} back`}
            value={`${months} mo`}
          />
        )
      )}
      {payload.minimalSaveMore !== null ? (
        <Row
          label="Or save more each month"
          value={`${dollars(payload.minimalSaveMore * 100)}/mo`}
        />
      ) : null}

      <Caption>
        {dollars(Math.round(payload.amount * 100))} spent this month. Goals are funded from
        what's left over each month, so a one-off purchase lands on the emergency fund rather
        than on the goals themselves.
      </Caption>
    </View>
  );
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^.*SenderError:\s*/, '') || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: space.md,
    marginVertical: space.sm,
  },
  headline: { ...typeScale.headline, color: colors.textPrimary, marginTop: space.xs, marginBottom: space.sm },
  headlineAtRisk: { color: colors.negative },
  value: { ...tabularNums },
});
