import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, useTopBleed } from './components';
import { ProjectionChart, type ChartMarker, type ChartPoint } from './chart';
import { ForestCanopy, Station } from './forest';
import { Pulse } from './pulse';
import { dollars } from './format';
import { colors, fonts, line, space, tabularNums, type as typeScale } from './theme';

/**
 * Home, as a pure view: everything it shows arrives as props, already computed
 * by the engine. The screen file (app/(tabs)/index.tsx) does the data plumbing;
 * this file only lays it out, which also lets it be previewed with fixture data.
 */

export type HomeGoal = {
  key: string;
  title: string;
  priority: 'must' | 'flex' | string;
  targetLabel: string;
  costTodayCents: number;
  /** Engine's required monthly amount at month 0, in cents. */
  monthlyCents: number | undefined;
  funded: boolean;
};

export type HomeViewProps = {
  members: readonly { name: string; color: string }[];
  points: readonly ChartPoint[];
  markers: readonly ChartMarker[];
  tightYears: readonly number[];
  startYear: number;
  /** Engine `freeToPlan`, dollars (may be negative). */
  freeToPlan: number;
  /** Engine `emergencyMonthsMin.months`. */
  cushionMonths: number;
  goalsFunded: number;
  goalsTotal: number;
  atRiskTitles: readonly string[];
  goals: readonly HomeGoal[];
  monthLabel: (planMonth: number) => string;
  pulseVersion: number;
  pulseColor: string | undefined;
  onShowMath: (label: string, path: string) => void;
  onOpenAssumptions: () => void;
  onOpenGoal: (key: string) => void;
  onSomethingCameUp: () => void;
  onAddGoal: () => void;
};

export function HomeView(props: HomeViewProps) {
  const bleed = useTopBleed();
  const [scrub, setScrub] = useState<ChartPoint | null>(null);

  const atRisk = props.atRiskTitles.length > 0;
  const heroCents = Math.round((scrub ? scrub.value : props.freeToPlan) * 100);
  const negative = heroCents < 0;
  const [whole = '0', cents = '00'] = dollars(Math.abs(heroCents), { showCents: true })
    .replace('$', '')
    .split('.');
  const heroColor = negative ? colors.error : colors.ink;
  const cushion = props.cushionMonths.toFixed(1);

  const sentence = scrub
    ? `Saved by ${props.monthLabel(scrub.month)}, if nothing changes.`
    : negative
    ? 'Your goals need more each month than you have free. Tap the number to see where it goes.'
    : atRisk
    ? `${props.atRiskTitles.join(' and ')} ${props.atRiskTitles.length > 1 ? "don't" : "doesn't"} fit yet. Tap a goal to see by how much.`
    : `If nothing changes, the projection shows ${
        props.goalsFunded === props.goalsTotal
          ? props.goalsTotal === 1
            ? 'your goal funded'
            : `all ${props.goalsTotal} goals funded`
          : `${props.goalsFunded} of ${props.goalsTotal} goals funded`
      }, and your emergency fund never drops below ${cushion} months.`;

  const header = (
    <ForestCanopy height={180 + bleed.inset} style={[styles.canopy, { marginTop: bleed.marginTop }]}>
      <View style={[styles.canopyRow, { paddingTop: space.md + bleed.inset }]}>
        <View style={styles.names}>
          {props.members.map(m => (
            <View key={m.name} style={[styles.memberDot, { backgroundColor: m.color }]} />
          ))}
          <Text style={styles.namesText} numberOfLines={1}>
            {props.members.map(m => m.name).join(' & ') || 'Your household'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Assumptions: savings rate, inflation and loan rates"
          onPress={props.onOpenAssumptions}
          style={({ pressed }) => [styles.mathLink, pressed && styles.pressed]}
        >
          <Text style={styles.mathLinkText}>Assumptions</Text>
        </Pressable>
      </View>
      <Text style={styles.plate}>No. 1 · The plan</Text>
    </ForestCanopy>
  );

  const hero = (
    <Pulse watch={props.pulseVersion} color={props.pulseColor} style={styles.hero}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${negative ? 'Minus ' : ''}$${whole}.${cents} ${
          scrub ? `saved by ${props.monthLabel(scrub.month)}` : 'free to plan each month'
        }. Show the math.`}
        onPress={() => (scrub ? undefined : props.onShowMath('Free to plan', 'freeToPlan'))}
      >
        <Text style={styles.heroLabel}>
          {scrub ? props.monthLabel(scrub.month) : 'Free to plan each month'}
        </Text>
        <View style={styles.heroRow}>
          <Text style={[styles.heroCurrency, { color: heroColor }]}>{negative ? '−$' : '$'}</Text>
          <Text style={[styles.heroWhole, tabularNums, { color: heroColor }]}>{whole}</Text>
          <Text style={[styles.heroCents, tabularNums, { color: heroColor }]}>.{cents}</Text>
          {!scrub ? <Text style={styles.heroUnit}>a month</Text> : null}
        </View>
        <Text style={styles.sentence}>{sentence}</Text>
        {!scrub ? <Text style={styles.showMath}>Show the math</Text> : null}
      </Pressable>
    </Pulse>
  );

  // While dragging: what happens in the month under your finger, in words.
  // Every number here is engine output (savings at that month, a goal's cost
  // or shortfall); nothing is computed.
  const scrubCard = (() => {
    if (!scrub) return null;
    const when = props.monthLabel(scrub.month);
    const here = props.markers.find(m => Math.abs(m.month - scrub.month) <= 1);
    if (here) {
      // Name the goal's own date, not the neighbouring month under the finger.
      const when = here.dateStr ?? props.monthLabel(here.month);
      return here.atRisk
        ? {
            title: `${when}: ${here.label} is due`,
            body: here.shortfall !== undefined ? `It falls ${dollars(Math.round(here.shortfall * 100), { showCents: true })} short.` : "It doesn't fit yet.",
            tone: colors.error,
          }
        : {
            title: `${when}: ${here.label} paid`,
            body: here.cost !== undefined ? `${dollars(Math.round(here.cost * 100), { showCents: true })} from your savings.` : 'Paid from your savings.',
            tone: colors.accent,
          };
    }
    const next = props.markers.filter(m => m.month > scrub.month).sort((a, b) => a.month - b.month)[0];
    return {
      title: `${when}: ${dollars(Math.round(scrub.value * 100))} saved`,
      body: next ? `Next up: ${next.label}, ${next.dateStr ?? props.monthLabel(next.month)}.` : 'Every goal is behind you.',
      tone: colors.ink2,
    };
  })();

  const chart = (
    <View style={styles.chart}>
      {scrubCard ? (
        <View pointerEvents="none" style={[styles.scrubCard, { borderLeftColor: scrubCard.tone }]} accessibilityLiveRegion="polite">
          <Text style={styles.scrubTitle}>{scrubCard.title}</Text>
          <Text style={styles.scrubBody}>{scrubCard.body}</Text>
        </View>
      ) : null}
      <ProjectionChart
        points={props.points}
        markers={props.markers}
        atRisk={atRisk}
        tightYears={props.tightYears}
        startYear={props.startYear}
        onScrub={setScrub}
      />
    </View>
  );

  const stats = (
    <View style={styles.stats}>
      <Stat
        value={cushion}
        words="months of cushion, at the lowest"
        onPress={() => props.onShowMath('Emergency-fund months', 'emergencyMonthsMin')}
      />
      <Stat
        value={String(props.tightYears.length)}
        words={props.tightYears.length === 1 ? 'tight year' : 'tight years'}
        tone={props.tightYears.length > 0 ? colors.warn : undefined}
        onPress={() => props.onShowMath('Tight years', 'tightYears')}
      />
      <Stat
        value={`${props.goalsFunded} of ${props.goalsTotal}`}
        words="goals on track"
        tone={props.goalsFunded < props.goalsTotal ? colors.error : undefined}
        onPress={() => props.onShowMath('Goals on track', 'goalsOnTrack')}
      />
    </View>
  );

  const goals = (
    <View style={styles.goals}>
      <View style={styles.goalsHead}>
        <Text style={styles.goalsHeading}>Goals along the path</Text>
        <Text style={[styles.goalsCount, tabularNums]}>
          {props.goals.length} {props.goals.length === 1 ? 'goal' : 'goals'}
        </Text>
      </View>

      {props.goals.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Add a goal to see your next ten years.</Text>
          <Button label="Add a goal" variant="secondary" icon="plus" onPress={props.onAddGoal} />
        </View>
      ) : (
        <View style={styles.rail}>
          <View style={styles.railLine} />
          {props.goals.map(goal => {
            const monthly =
              goal.monthlyCents !== undefined ? dollars(goal.monthlyCents, { showCents: true }) : '—';
            return (
              <Pressable
                key={goal.key}
                accessibilityRole="button"
                accessibilityLabel={`${goal.title}, ${goal.priority === 'must' ? 'must-have' : 'flexible'}, ${
                  goal.funded ? 'funded' : 'does not fit yet'
                }. Target ${goal.targetLabel}. ${monthly} a month. Open details.`}
                onPress={() => props.onOpenGoal(goal.key)}
                style={({ pressed }) => [styles.goalRow, pressed && styles.pressed]}
              >
                <View style={styles.station}>
                  <Station color={goal.funded ? colors.accent : colors.error} filled={!goal.funded} />
                </View>
                <View style={styles.goalText}>
                  <Text style={styles.goalTitle} numberOfLines={2}>
                    {goal.title}
                  </Text>
                  <Text style={styles.goalMeta}>
                    {goal.targetLabel} · {dollars(goal.costTodayCents)} today ·{' '}
                    {goal.priority === 'must' ? 'Must‑have' : 'Flexible'}
                  </Text>
                  {!goal.funded ? <Text style={styles.goalRisk}>Doesn't fit yet</Text> : null}
                </View>
                <View style={styles.goalAmount}>
                  <Text style={[styles.goalMonthly, tabularNums]}>{monthly}</Text>
                  <Text style={styles.goalUnit}>a month</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );

  const action = (
    <View style={styles.action}>
      <Button label="Something came up" icon="chat" onPress={props.onSomethingCameUp} />
      <Text style={styles.actionHint}>
        A new job, a baby, a big bill. Tell us and we'll show the paths forward.
      </Text>
    </View>
  );

  // One column, phone first (10 Screens). On web the same column is centred.
  return (
    <View>
      {header}
      {hero}
      {chart}
      {stats}
      {goals}
      {action}
    </View>
  );
}

function Stat({
  value,
  words,
  tone,
  onPress,
}: {
  value: string;
  words: string;
  tone?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${value} ${words}. Show the math.`}
      onPress={onPress}
      style={({ pressed }) => [styles.stat, pressed && styles.pressed]}
    >
      <Text style={[styles.statValue, tabularNums, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.statWords}>{words}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.surface },

  // Header art bleeds past the screen padding.
  canopy: { marginHorizontal: -space.sidePadding },
  canopyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sidePadding,
    paddingTop: space.md,
  },
  names: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  memberDot: { width: 8, height: 8, borderRadius: 4 },
  namesText: { ...typeScale.label, color: colors.ink, marginLeft: 4 },
  mathLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.xs, flexShrink: 0 },
  mathLinkText: { ...typeScale.label, color: colors.ink, textDecorationLine: 'underline' },
  plate: {
    ...typeScale.plate,
    color: colors.accent,
    paddingHorizontal: space.sidePadding,
    marginTop: space.xs,
  },

  hero: { marginTop: space.xl, marginBottom: space.xxl },
  heroLabel: { ...typeScale.label, color: colors.ink2, marginBottom: space.xs },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  heroCurrency: {
    fontFamily: fonts.numeral,
    fontSize: 30,
    lineHeight: 34,
    marginRight: 2,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  heroWhole: { ...typeScale.heroDollars },
  heroCents: { ...typeScale.heroCents, marginBottom: 9 },
  heroUnit: { ...typeScale.label, color: colors.ink2, marginLeft: space.sm, marginBottom: 12 },
  sentence: { ...typeScale.bodyItalic, color: colors.ink, marginTop: space.md, maxWidth: 520 },
  showMath: {
    ...typeScale.label,
    color: colors.accent,
    textDecorationLine: 'underline',
    marginTop: space.sm,
    alignSelf: 'flex-start',
  },

  chart: { marginBottom: space.xl, position: 'relative' },
  scrubCard: {
    position: 'absolute',
    top: -8,
    left: 0,
    right: 40,
    zIndex: 3,
    backgroundColor: colors.band,
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  scrubTitle: { fontFamily: fonts.textSemi, fontSize: 14, lineHeight: 19, color: colors.ink },
  scrubBody: { ...typeScale.caption, color: colors.ink2, marginTop: 2 },

  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: line.hair,
    borderBottomWidth: line.hair,
    borderColor: colors.rule,
    marginBottom: space.xxxl,
  },
  stat: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 96,
    minHeight: 44,
    paddingVertical: space.md,
    paddingRight: space.sm,
  },
  statValue: { ...typeScale.numeral, fontSize: 24, lineHeight: 28, color: colors.ink },
  statWords: { ...typeScale.caption, color: colors.ink2, marginTop: 2 },

  goals: { marginBottom: space.xxl },
  goalsHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: space.sm,
  },
  goalsHeading: { ...typeScale.title, fontSize: 22, lineHeight: 28, color: colors.ink },
  goalsCount: { ...typeScale.caption, color: colors.ink2 },
  empty: { paddingVertical: space.xl, gap: space.sm },
  emptyText: { ...typeScale.bodyItalic, color: colors.ink2 },

  // Transit-map rail: one seafoam line, a station per goal.
  rail: { position: 'relative', borderTopWidth: line.hair, borderTopColor: colors.rule },
  railLine: {
    position: 'absolute',
    left: 5,
    top: 0,
    bottom: 0,
    width: line.path,
    backgroundColor: colors.accent,
    opacity: 0.6,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingVertical: space.md,
    borderBottomWidth: line.hair,
    borderBottomColor: colors.rule,
    gap: space.md,
  },
  station: { width: 11, alignItems: 'center' },
  goalText: { flex: 1 },
  goalTitle: { ...typeScale.headline, color: colors.ink },
  goalMeta: { ...typeScale.caption, color: colors.ink2, marginTop: 2 },
  goalRisk: { ...typeScale.caption, color: colors.error, marginTop: 2 },
  goalAmount: { alignItems: 'flex-end' },
  goalMonthly: { ...typeScale.numeral, color: colors.ink },
  goalUnit: { ...typeScale.caption, color: colors.ink2 },

  action: { marginBottom: space.hero },
  actionHint: { ...typeScale.caption, color: colors.ink2, marginTop: space.sm },

});
