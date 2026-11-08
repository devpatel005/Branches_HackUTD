import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { G, Text as SvgText } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTable } from 'spacetimedb/react';
import { tables } from '@branches/bindings';
import { BarkBranch, Flower, Leaf, Twig, cubic, useGrowth, type Pt } from '../src/branch-art';
import { ForestCanopy, Station } from '../src/forest';
import { Button, Loading } from '../src/components';
import { Icon, goalIcon, type IconName } from '../src/icons';
import { memberColor, useBaseline, useHousehold, useHouseholdMembers } from '../src/household';
import { planMonthLabel, useGoals, useProjection } from '../src/projection';
import { useCommitment } from '../src/session';
import { dollars } from '../src/format';
import { colors, fonts, line, radius, space, tabularNums, type as typeScale } from '../src/theme';

/**
 * 2026, wrapped: seven pages on the couple's year, in the field-guide style.
 *
 * Every figure here is read from the app's data, never worked out on the
 * phone (02 Ground Rules #1): the engine's stored projection (monthly samples,
 * goal results, cushion), the baseline (each partner's income, the flexible
 * budget), fun-money amounts and the plan commitment. The phone only picks
 * which stored value to show, such as the 2026 month with the largest surplus.
 *
 * The plan is a projection, so the pages say "projected" rather than claim
 * the year already happened (02 Ground Rules #2). Fun-money *status* is never
 * shown, because a partner is never told when the other goes over.
 */

const YEAR = 2026;

const PAGES = ['Your year', 'Savings', 'Goals', 'The big one', 'Your best month', 'Your money style', 'What grows next'] as const;

/** Playful, but descriptions of the plan, never advice. Picked from the data, then shuffleable. */
const STYLES = [
  {
    name: 'The steady splurgers',
    traits: ['Planned treats', 'Big goals', 'Long view'],
    line: 'A full year of goals, and a plan that still holds.',
  },
  {
    name: 'The quiet compounders',
    traits: ['Cozy', 'Consistent', 'Reserve first'],
    line: 'A deep cushion, quietly kept.',
  },
  {
    name: 'The in-sync pair',
    traits: ['Calm', 'Aligned', 'Drama-free'],
    line: 'Two incomes, two styles, one plan.',
  },
] as const;

const toCents = (dollarsValue: number) => Math.round(dollarsValue * 100);
const money = (dollarsValue: number) => dollars(toCents(dollarsValue), { showCents: true });
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const MONTH_NAMES: Record<string, string> = {
  Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June',
  Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December',
};

type Person = { id: bigint; name: string; color: string };
type GoalLine = {
  key: string;
  title: string;
  icon: IconName;
  when: string;
  year: number;
  funded: boolean;
  cost: number;
  monthly: number;
  shortfall: number;
};

/** Everything the pages show, read from the app's tables. */
function useYear() {
  const household = useHousehold();
  const { projection } = useProjection();
  const { goals } = useGoals();
  const { baseline } = useBaseline();
  const commitment = useCommitment();
  const [funRows] = useTable(tables.funMoney);
  const people: Person[] = useHouseholdMembers().map(m => ({ id: m.id, name: m.displayName, color: memberColor(m.colorKey) }));

  if (!household || !projection) return undefined;

  const label = (m: number) => planMonthLabel(household.currentMonth, m);
  const yearOf = (m: number) => Number(label(m).slice(-4));

  const goalLines: GoalLine[] = goals
    .map(g => {
      const r = projection.goals.find(x => x.id === String(g.id));
      if (!r) return undefined;
      return {
        key: String(g.id),
        title: g.title,
        icon: goalIcon(g.icon),
        when: label(g.targetMonth),
        year: yearOf(g.targetMonth),
        funded: r.funded,
        cost: r.inflatedCost,
        monthly: r.requiredMonthlyAtStart,
        shortfall: r.shortfall,
      };
    })
    .filter((g): g is GoalLine => g !== undefined);

  const months = projection.series.monthly.filter(s => yearOf(s.month) === YEAR);
  const yearEnd = months[months.length - 1];
  const best = months.reduce<(typeof months)[number] | undefined>((a, s) => (!a || s.surplus > a.surplus ? s : a), undefined);
  const planEnd = projection.series.monthly[projection.series.monthly.length - 1];

  const thisYear = goalLines.filter(g => g.year === YEAR);
  const later = goalLines.filter(g => g.year > YEAR);
  const pool = thisYear.length > 0 ? thisYear : later;
  const bigOne = pool.reduce<GoalLine | undefined>((a, g) => (!a || g.cost > a.cost ? g : a), undefined);

  const income = (baseline?.incomeByMember ?? [])
    .map(i => ({ person: people.find(p => p.id === i.memberId), cents: i.cents }))
    .filter((i): i is { person: Person; cents: number } => i.person !== undefined && i.cents > 0);
  const fun = people
    .map(p => ({ person: p, cents: funRows.find(r => r.memberId === p.id)?.monthlyCents }))
    .filter((f): f is { person: Person; cents: number } => f.cents !== undefined);

  // A starting style from the plan itself; the couple can shuffle from there.
  const cushion = projection.emergencyMonthsMin.months;
  const styleIx = thisYear.length >= 2 ? 0 : cushion >= 6 ? 1 : 2;

  return {
    people,
    label,
    freeToPlan: projection.freeToPlan,
    yearEnd: yearEnd ? { when: label(yearEnd.month), total: yearEnd.totalSavings, emergency: yearEnd.emergency } : undefined,
    best: best ? { name: MONTH_NAMES[label(best.month).slice(0, 3)] ?? label(best.month), surplus: best.surplus } : undefined,
    planEnd: planEnd ? { when: label(planEnd.month), total: planEnd.totalSavings } : undefined,
    thisYear,
    later,
    bigOne,
    income,
    fun,
    flexibleCents: baseline?.flexibleCents,
    cushion,
    cushionWhen: label(projection.emergencyMonthsMin.month),
    onTrack: projection.goalsOnTrack,
    tightYears: projection.tightYears.length,
    agreed: commitment !== undefined,
    styleIx,
  };
}
type Year = NonNullable<ReturnType<typeof useYear>>;

export default function WrappedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const year = useYear();

  const [page, setPage] = useState(0);
  const [styleIx, setStyleIx] = useState<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const last = PAGES.length - 1;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const next = () => setPage(p => Math.min(last, p + 1));
  const prev = () => setPage(p => Math.max(0, p - 1));

  // Laptop: arrow keys and space turn the pages, Escape closes.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!year) return <Loading label="Gathering your year…" />;

  const style = STYLES[styleIx ?? year.styleIx]!;
  const names = year.people.map(p => p.name).join(' and ') || 'Our';

  const share = async () => {
    const parts = [`${names}'s ${YEAR} on Branches: "${style.name}".`];
    if (year.yearEnd) parts.push(`${dollars(toCents(year.yearEnd.total))} set aside by ${year.yearEnd.when}.`);
    parts.push(`${year.onTrack.funded} of ${year.onTrack.total} goals on track.`);
    try {
      const msg = parts.join(' ');
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(msg);
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      } else {
        await Share.share({ message: msg });
      }
    } catch {
      // Sharing was cancelled or blocked; nothing to do.
    }
  };

  const body = (() => {
    switch (page) {
      case 0:
        return <CoverPage y={year} />;
      case 1:
        return <SavingsPage y={year} />;
      case 2:
        return <GoalsPage y={year} />;
      case 3:
        return <BigOnePage y={year} />;
      case 4:
        return <MonthPage y={year} />;
      case 5:
        return (
          <StylePage
            y={year}
            index={styleIx ?? year.styleIx}
            onShuffle={() => setStyleIx(i => ((i ?? year.styleIx) + 1) % STYLES.length)}
          />
        );
      default:
        return <AheadPage y={year} />;
    }
  })();

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: space.xl }]}>
        <ForestCanopy height={150 + insets.top} seed={11 + page} style={styles.canopy}>
          <View style={[styles.topRow, { paddingTop: space.md + insets.top }]}>
            <View style={styles.progress} accessibilityLabel={`Page ${page + 1} of ${PAGES.length}`}>
              {PAGES.map((_, i) => (
                <View key={i} style={[styles.tick, i <= page && styles.tickOn]} />
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close wrapped"
              onPress={close}
              hitSlop={10}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Icon name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={styles.plate}>
            No. {page + 1} · {PAGES[page]}
          </Text>
          <Text style={styles.sample}>{YEAR} · projected from your plan</Text>
        </ForestCanopy>

        {/* Remounting per page replays each page's growth animation. */}
        <View key={page} style={styles.page}>
          {body}
        </View>
      </ScrollView>

      <View style={[styles.nav, { paddingBottom: space.md + insets.bottom }]}>
        {page > 0 ? <Button label="Back" variant="quiet" icon="back" onPress={prev} /> : <View />}
        {page < last ? (
          <Button label="Next" icon="forward" onPress={next} />
        ) : (
          <View style={styles.navEnd}>
            <Button label={copied ? 'Copied' : 'Share'} variant="secondary" icon={copied ? 'check' : 'send'} onPress={share} />
            <Button label="Done" onPress={close} />
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The app's hero numeral: small $ at cap height, big whole dollars, small cents. */
function Money({ value, unit, tone = colors.ink }: { value: number; unit?: string; tone?: string }) {
  const cents = toCents(value);
  const negative = cents < 0;
  const whole = Math.floor(Math.abs(cents) / 100).toLocaleString('en-US');
  const c = String(Math.abs(cents) % 100).padStart(2, '0');
  return (
    <View style={styles.moneyRow} accessibilityLabel={`${dollars(cents, { showCents: true })}${unit ? ` ${unit}` : ''}`}>
      <Text style={[styles.moneySign, { color: tone }]}>{negative ? '−$' : '$'}</Text>
      <Text style={[styles.moneyWhole, tabularNums, { color: tone }]}>{whole}</Text>
      <Text style={[styles.moneyCents, tabularNums, { color: tone }]}>.{c}</Text>
      {unit ? <Text style={styles.moneyUnit}>{unit}</Text> : null}
    </View>
  );
}

function Big({ children, tone = colors.ink }: { children: ReactNode; tone?: string }) {
  return <Text style={[styles.big, tabularNums, { color: tone }]}>{children}</Text>;
}

function Lead({ children }: { children: ReactNode }) {
  return <Text style={styles.lead}>{children}</Text>;
}

function Say({ children }: { children: ReactNode }) {
  return <Text style={styles.say}>{children}</Text>;
}

/** A ruled sentence row: a figure on the left, words after it. */
function Fact({ value, words, tone }: { value: string; words: string; tone?: string }) {
  return (
    <View style={styles.fact}>
      <Text style={[styles.factValue, tabularNums, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.factWords}>{words}</Text>
    </View>
  );
}

function Names({ people }: { people: readonly Person[] }) {
  return (
    <View style={styles.names}>
      {people.map(p => (
        <View key={String(p.id)} style={[styles.dot, { backgroundColor: p.color }]} />
      ))}
      <Text style={styles.namesText}>{people.map(p => p.name).join(' & ') || 'Your household'}</Text>
    </View>
  );
}

/** The year as one branch: it grows left to right and a flower opens at each goal. */
function YearBranch({ titles, height = 150 }: { titles: readonly string[]; height?: number }) {
  const [w, setW] = useState(0);
  const [grow] = useGrowth(['branch'], 1300, 0);
  const p = clamp01(grow ?? 0);
  const onLayout = (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width));

  const spine: Pt[] = w ? cubic([10, height - 26], [w * 0.35, height - 30], [w * 0.62, height * 0.45], [w - 16, 26], 40) : [];
  const shown = spine.slice(0, Math.max(2, Math.ceil(p * spine.length)));
  const at = (t: number) => spine[Math.round(t * (spine.length - 1))]!;
  // Up to three flowers, spread along the branch.
  const stops = titles.length === 1 ? [0.6] : titles.length === 2 ? [0.38, 0.8] : [0.3, 0.56, 0.84];

  return (
    <View style={{ height }} onLayout={onLayout}>
      {w ? (
        <Svg width={w} height={height}>
          <BarkBranch spine={shown} w0={11} w1={11 - 7 * p} />
          {p > 0.45 ? <Twig x={at(0.45)[0]} y={at(0.45)[1] - 3} dir={-1} size={0.8} /> : null}
          {p > 0.7 ? <Leaf x={at(0.7)[0]} y={at(0.7)[1] + 2} angle={30} scale={0.9} /> : null}
          {titles.slice(0, 3).map((title, i) => {
            const t = stops[i]!;
            const open = clamp01((p - t) / 0.14);
            if (open <= 0) return null;
            const [x, y] = at(t);
            const below = t < 0.7;
            return (
              <G key={title + i}>
                <Flower x={x} y={y - 2} size={0.95} open={open} />
                <SvgText
                  x={x}
                  y={below ? y + 26 : y - 20}
                  fill={colors.ink}
                  fontSize={12}
                  fontFamily={fonts.textMedium}
                  textAnchor="middle"
                  opacity={open}
                >
                  {title}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

/** A small flower (on track) or an empty station (doesn't fit yet), for list rows. */
function Bloom({ funded }: { funded: boolean }) {
  if (!funded) return <Station color={colors.error} size={12} />;
  return (
    // The flower head sits 11px above its base, so the base goes low in the box.
    <Svg width={28} height={34}>
      <Flower x={14} y={28} size={0.85} />
    </Svg>
  );
}

/** A two-part bar in the partners' colours. Widths are only drawing, never shown as numbers. */
function SplitBar({ parts }: { parts: readonly { color: string; cents: number }[] }) {
  const [grow] = useGrowth(['bar'], 900, 0);
  const p = clamp01(grow ?? 0);
  const total = parts.reduce((s, x) => s + x.cents, 0) || 1;
  return (
    <View style={styles.splitTrack}>
      {parts.map((x, i) => (
        <View key={i} style={{ width: `${(x.cents / total) * 100 * p}%`, backgroundColor: x.color }} />
      ))}
    </View>
  );
}

function GoalRow({ g, grow }: { g: GoalLine; grow: number }) {
  return (
    <View style={[styles.row, { opacity: clamp01(grow) }]}>
      <View style={styles.rowMark}>
        <Bloom funded={g.funded} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{g.title}</Text>
        <Text style={[styles.rowMeta, !g.funded && { color: colors.error }]}>
          {g.funded ? `On track · ${g.when}` : `Short by ${money(g.shortfall)} · ${g.when}`}
        </Text>
      </View>
      <Icon name={g.icon} size={20} color={g.funded ? colors.accent : colors.ink3} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function CoverPage({ y }: { y: Year }) {
  const n = y.thisYear.length;
  const onTrack = y.thisYear.filter(g => g.funded).length;
  return (
    <View>
      <Names people={y.people} />
      <Text style={styles.title}>Your {YEAR}, wrapped</Text>
      <YearBranch titles={(n > 0 ? y.thisYear : y.later).map(g => g.title)} />
      <Lead>Free to plan each month</Lead>
      <Money value={y.freeToPlan} unit="a month" tone={y.freeToPlan < 0 ? colors.error : colors.ink} />
      <Say>
        {n === 0
          ? `No goals land in ${YEAR}. The branch above shows what comes next.`
          : `${n === 1 ? 'One goal lands' : `${n} goals land`} in ${YEAR}, and ${
              onTrack === n ? (n === 1 ? 'it is on track' : 'all of them are on track') : `${onTrack} of ${n} are on track`
            }.`}
        {y.agreed ? ' Your plan was agreed by both of you.' : ''}
      </Say>
    </View>
  );
}

function SavingsPage({ y }: { y: Year }) {
  return (
    <View>
      {y.yearEnd ? (
        <>
          <Lead>Set aside by {y.yearEnd.when}</Lead>
          <Money value={y.yearEnd.total} tone={colors.accent} />
          <Say>
            Your emergency fund and every goal you're saving toward, together. {money(y.yearEnd.emergency)} of it is
            the emergency fund.
          </Say>
        </>
      ) : (
        <Say>Your plan doesn't cover {YEAR}, so there's no savings total for it.</Say>
      )}

      {y.income.length > 0 ? (
        <>
          <Text style={styles.subhead}>What comes in each month</Text>
          <SplitBar parts={y.income.map(i => ({ color: i.person.color, cents: i.cents }))} />
          <View style={styles.splitLegend}>
            {y.income.map(i => (
              <Text key={String(i.person.id)} style={styles.legend}>
                <Text style={{ color: i.person.color }}>●</Text> {i.person.name}{' '}
                <Text style={styles.legendStrong}>{dollars(i.cents, { showCents: true })}</Text>
              </Text>
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.facts}>
        <Fact value={y.cushion.toFixed(1)} words={`months of emergency cushion at the lowest point (${y.cushionWhen})`} />
      </View>
    </View>
  );
}

function GoalsPage({ y }: { y: Year }) {
  const list = y.thisYear.length > 0 ? y.thisYear : y.later.slice(0, 4);
  const grow = useGrowth(list.map(g => g.key), 500, 140);
  const onTrack = y.thisYear.filter(g => g.funded).length;
  return (
    <View>
      {y.thisYear.length > 0 ? (
        <>
          <Lead>Goals in {YEAR} on track</Lead>
          <Big tone={onTrack < y.thisYear.length ? colors.error : colors.ink}>
            {onTrack} of {y.thisYear.length}
          </Big>
          <Say>Each flower is a goal the projection pays for in full, on its date.</Say>
        </>
      ) : (
        <>
          <Lead>Goals in {YEAR}</Lead>
          <Big>None</Big>
          <Say>Nothing is due this year. Here's what's coming up first.</Say>
        </>
      )}
      <View style={styles.list}>
        {list.map((g, i) => (
          <GoalRow key={g.key} g={g} grow={grow[i] ?? 0} />
        ))}
      </View>
    </View>
  );
}

function BigOnePage({ y }: { y: Year }) {
  const g = y.bigOne;
  if (!g) {
    return (
      <View>
        <Lead>The biggest goal</Lead>
        <Say>Add a goal and its cost will show up here.</Say>
      </View>
    );
  }
  return (
    <View>
      <View style={styles.iconBadge}>
        <Icon name={g.icon} size={28} color={colors.accent} />
      </View>
      <Lead>{g.year === YEAR ? `The biggest goal of ${YEAR}` : 'Your next big goal'}</Lead>
      <Text style={styles.title}>{g.title}</Text>
      <Money value={g.cost} unit={`by ${g.when}`} />
      <Say>{g.funded ? 'The projection pays for it in full, on time.' : `As planned, it falls ${money(g.shortfall)} short.`}</Say>
      <View style={styles.facts}>
        <Fact value={money(g.monthly)} words="a month set aside for it, starting now" />
        <Fact value={y.cushion.toFixed(1)} words="months of emergency cushion at the lowest point" />
      </View>
    </View>
  );
}

function MonthPage({ y }: { y: Year }) {
  return (
    <View>
      <Lead>Your best month of {YEAR}</Lead>
      {y.best ? (
        <>
          <Big>{y.best.name}</Big>
          <Money value={y.best.surplus} unit="left over" tone={y.best.surplus < 0 ? colors.error : colors.accent} />
          <Say>The month with the most left over after bills, savings and goals.</Say>
        </>
      ) : (
        <Say>Your plan doesn't cover {YEAR}.</Say>
      )}
      <View style={styles.facts}>
        {y.flexibleCents !== undefined ? (
          <Fact value={dollars(y.flexibleCents, { showCents: true })} words="flexible spending each month, for groceries, dining and the rest" />
        ) : null}
        {y.fun.map(f => (
          <Fact key={String(f.person.id)} value={dollars(f.cents, { showCents: true })} words={`${f.person.name}'s fun money each month`} tone={f.person.color} />
        ))}
      </View>
      {y.fun.length > 0 ? (
        <View style={styles.pill}>
          <Icon name="lock" size={16} color={colors.accent} />
          <Text style={styles.pillText}>What you buy with fun money stays on your own phone.</Text>
        </View>
      ) : null}
    </View>
  );
}

function StylePage({ y, index, onShuffle }: { y: Year; index: number; onShuffle: () => void }) {
  const s = STYLES[index]!;
  const notes = [
    `${y.onTrack.funded} of ${y.onTrack.total} goals on track across the next ten years`,
    `Never below ${y.cushion.toFixed(1)} months of emergency cushion`,
    y.tightYears === 0 ? 'No tight years ahead' : `${y.tightYears} tight ${y.tightYears === 1 ? 'year' : 'years'} to plan around`,
    y.agreed ? 'A plan agreed by both of you' : 'Your first plan together is still waiting for both of you to agree',
  ];
  return (
    <View>
      <Lead>Your money style as a couple</Lead>
      <Text style={styles.title}>{s.name}</Text>
      <View style={styles.traits}>
        {s.traits.map(t => (
          <View key={t} style={styles.trait}>
            <Text style={styles.traitText}>{t}</Text>
          </View>
        ))}
      </View>
      <Say>{s.line}</Say>
      <View style={styles.list}>
        {notes.map(n => (
          <View key={n} style={styles.note}>
            <View style={styles.noteMark} />
            <Text style={styles.noteText}>{n}</Text>
          </View>
        ))}
      </View>
      <View style={styles.shuffle}>
        <Button label="Try another" variant="secondary" icon="reset" onPress={onShuffle} />
      </View>
    </View>
  );
}

function AheadPage({ y }: { y: Year }) {
  const ahead = y.later.slice(0, 4);
  const grow = useGrowth(ahead.map(g => g.key), 500, 220);
  return (
    <View>
      <Lead>Roots down, branches up</Lead>
      <Text style={styles.title}>What grows next</Text>
      {ahead.length === 0 ? (
        <Say>No goals after {YEAR} yet. Add one from the Timeline.</Say>
      ) : (
        <View style={styles.ahead}>
          <View style={styles.aheadSpine} />
          {ahead.map((g, i) => (
            <View key={g.key} style={[styles.aheadRow, { opacity: clamp01(grow[i] ?? 0) }]}>
              <View style={styles.aheadMark}>
                <Station color={g.funded ? colors.accent : colors.error} filled={g.funded} size={13} />
              </View>
              <Text style={[styles.aheadYear, tabularNums]}>{g.year}</Text>
              <Text style={styles.aheadTitle}>{g.title}</Text>
              <Icon name={g.icon} size={18} color={g.funded ? colors.accent : colors.ink2} />
            </View>
          ))}
        </View>
      )}
      <View style={styles.facts}>
        {y.planEnd ? <Fact value={dollars(toCents(y.planEnd.total))} words={`set aside by ${y.planEnd.when}`} tone={colors.accent} /> : null}
        <Fact value={`${y.onTrack.funded} of ${y.onTrack.total}`} words="goals on track" />
        <Fact value={String(y.tightYears)} words={y.tightYears === 1 ? 'tight year ahead' : 'tight years ahead'} tone={y.tightYears > 0 ? colors.warn : undefined} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: space.sidePadding },
  pressed: { opacity: 0.7 },

  canopy: { marginHorizontal: -space.sidePadding },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sidePadding,
  },
  progress: { flex: 1, flexDirection: 'row', gap: 4 },
  tick: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.ruleStrong },
  tickOn: { backgroundColor: colors.accent },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  plate: { ...typeScale.plate, color: colors.accent, paddingHorizontal: space.sidePadding, marginTop: space.xs },
  sample: { ...typeScale.caption, color: colors.ink2, paddingHorizontal: space.sidePadding, marginTop: 2 },

  page: { paddingTop: space.xl },

  names: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  namesText: { ...typeScale.label, color: colors.ink, marginLeft: 4 },
  title: { ...typeScale.title, color: colors.ink, marginBottom: space.md },
  lead: { ...typeScale.label, color: colors.ink2, marginTop: space.md, marginBottom: space.xs },
  say: { ...typeScale.bodyItalic, color: colors.ink, marginTop: space.md, maxWidth: 440 },
  big: { ...typeScale.display, color: colors.ink },
  subhead: { ...typeScale.headline, color: colors.ink, marginTop: space.xxl, marginBottom: space.sm },

  moneyRow: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  moneySign: { fontFamily: fonts.numeral, fontSize: 30, lineHeight: 34, marginRight: 2, alignSelf: 'flex-start' },
  moneyWhole: { ...typeScale.heroDollars },
  moneyCents: { ...typeScale.heroCents, marginBottom: 9 },
  moneyUnit: { ...typeScale.label, color: colors.ink2, marginLeft: space.sm, marginBottom: 12 },

  facts: { marginTop: space.xxl, borderTopWidth: line.hair, borderTopColor: colors.rule },
  fact: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: line.hair,
    borderBottomColor: colors.rule,
  },
  factValue: { ...typeScale.numeral, color: colors.ink, minWidth: 92 },
  factWords: { ...typeScale.caption, color: colors.ink2, flex: 1 },

  splitTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radius,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    gap: 2,
  },
  splitLegend: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  legend: { ...typeScale.caption, color: colors.ink2 },
  legendStrong: { fontFamily: fonts.numeral, fontSize: 16, color: colors.ink },

  list: { marginTop: space.xl, borderTopWidth: line.hair, borderTopColor: colors.rule },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: line.hair,
    borderBottomColor: colors.rule,
  },
  rowMark: { width: 28, alignItems: 'center' },
  rowText: { flex: 1 },
  rowTitle: { ...typeScale.headline, color: colors.ink },
  rowMeta: { ...typeScale.caption, color: colors.ink2, marginTop: 2 },

  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: line.path,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    marginTop: space.lg,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius,
    borderWidth: line.hair,
    borderColor: colors.accent,
  },
  pillText: { ...typeScale.caption, color: colors.accent, flexShrink: 1 },

  traits: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  trait: {
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius,
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
    backgroundColor: colors.surface,
  },
  traitText: { ...typeScale.caption, color: colors.ink },
  note: {
    flexDirection: 'row',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: line.hair,
    borderBottomColor: colors.rule,
  },
  noteMark: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 8 },
  noteText: { ...typeScale.body, color: colors.ink, flex: 1 },
  shuffle: { marginTop: space.xl, alignItems: 'flex-start' },

  ahead: { marginTop: space.md, position: 'relative' },
  aheadSpine: {
    position: 'absolute',
    left: 12,
    top: 20,
    bottom: 20,
    width: line.path,
    backgroundColor: colors.ruleStrong,
  },
  aheadRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  aheadMark: { width: 26, alignItems: 'center' },
  aheadYear: { ...typeScale.numeral, color: colors.ink, width: 52 },
  aheadTitle: { ...typeScale.body, color: colors.ink, flex: 1 },

  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.sidePadding,
    paddingTop: space.md,
    borderTopWidth: line.hair,
    borderTopColor: colors.rule,
    backgroundColor: colors.bg,
  },
  navEnd: { flexDirection: 'row', gap: space.sm },
});
