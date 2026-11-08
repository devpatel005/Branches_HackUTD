import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './components';
import { FernLeafPaths } from './forest';
import { Icon, type IconName } from './icons';
import { dollars } from './format';
import { COLUMN_MAX_WIDTH, colors, fonts, line, space, tabularNums, type as typeScale } from './theme';

/**
 * The ten-year plan as a redwood you climb.
 *
 * The trunk fills most of the screen, so you never see the top: you start at
 * the flared base and roots (today) and swipe up, year by year, past goals
 * carved into the bark — each with a twig and a leaf poking out the side — and
 * moss on the tight years, until the foliage closes in overhead at the end of
 * the ten years.
 *
 * Time runs upward, so the content is laid out top-to-bottom as
 * canopy → Year 10 … Year 1 → base, and the scroll starts at the bottom.
 * Pure view: every number arrives as a prop, already computed by the engine.
 * Flat fills only (no gradients): the sunlit and shaded sides are flat bands.
 */

export type TreeGoal = {
  key: string;
  title: string;
  icon: IconName;
  priority: 'must' | 'flex' | string;
  /** Plan-month index the goal settles at (1–120). */
  targetMonth: number;
  targetLabel: string;
  costTodayCents: number;
  /** Engine's required monthly amount, in cents. */
  monthlyCents: number | undefined;
  funded: boolean;
  /** Who added it, when known: the leaf takes their colour. */
  color?: string;
};

// Bark. Checked against the night background and against the text on it:
// cream 7.0:1, tan 5.6:1, seafoam 5.4:1, lichen 4.9:1 (all AA).
const BARK = {
  mid: '#6E4632',
  light: '#8C5B3E', // the sunlit side, a flat band
  shadow: '#563626', // the shaded side
  crack: '#2E1C13',
  outline: '#1E120C',
  ink: '#F6ECE0',
  meta: '#E8D3BF',
  moss: '#5F7436',
  mossDark: '#45572A',
  foliage: '#2C4A34',
  foliageDark: '#1C3324',
  foliageLight: '#3D6145',
};

const PLAN_YEARS = 10;
const YEAR_MIN_HEIGHT = 340; // a long climb: about 3,500px of trunk
const TOP_RATIO = 0.7; // trunk width near the canopy, as a share of the column
const BOTTOM_RATIO = 0.8; // and just above the flare

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const f = (n: number) => n.toFixed(1);

export function TreeTimeline({
  goals,
  tightYears,
  yearLabel,
  startLabel,
  endLabel,
  onOpenGoal,
  onAddGoal,
  footer,
}: {
  goals: readonly TreeGoal[];
  tightYears: readonly number[];
  /** "2027–28" for plan year 2. */
  yearLabel: (year: number) => string;
  /** "Nov 2026": the month the plan starts. */
  startLabel: string;
  /** "Oct 2036": the last month of the plan. */
  endLabel: string;
  onOpenGoal: (key: string) => void;
  onAddGoal: () => void;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  // Stay anchored at the base until the person starts climbing: the content
  // keeps growing as the trunk measures itself, and each growth would
  // otherwise leave the view stranded part-way up.
  const userMoved = useRef(false);
  const segments = useRef(new Map<number, { y: number; h: number }>());
  const treeTop = useRef(0);
  const [width, setWidth] = useState(0);
  const [treeHeight, setTreeHeight] = useState(0);
  // 0 = the base (today), 1-10 = plan years, 11 = the canopy (the top).
  const [inView, setInView] = useState(0);
  const [climbed, setClimbed] = useState(false);

  const tight = new Set(tightYears);
  const funded = goals.filter(g => g.funded).length;

  // Goals by plan year; within a year the later goal sits higher up the trunk.
  const byYear = new Map<number, TreeGoal[]>();
  for (const g of goals) {
    const year = Math.min(PLAN_YEARS, Math.max(1, Math.floor((g.targetMonth - 1) / 12) + 1));
    byYear.set(year, [...(byYear.get(year) ?? []), g]);
  }
  for (const list of byYear.values()) list.sort((a, b) => b.targetMonth - a.targetMonth);

  // Twigs alternate sides up the whole tree, counting from the base.
  const side = new Map<string, 'left' | 'right'>();
  let n = 0;
  for (let y = 1; y <= PLAN_YEARS; y++) {
    for (const g of [...(byYear.get(y) ?? [])].reverse()) side.set(g.key, n++ % 2 === 0 ? 'right' : 'left');
  }

  // Start at the base: the first time the content has a size, jump to the end.
  const onContentSizeChange = useCallback(() => {
    if (userMoved.current) return;
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  // Which year is in the middle of the screen, for the floating marker.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const y = contentOffset.y + layoutMeasurement.height / 2;
    let found = inView;
    let top = Infinity;
    let bottom = -Infinity;
    // Segment positions are stored relative to the trunk; the trunk's own
    // offset is added here, since children are laid out before their parent.
    for (const [year, raw] of segments.current) {
      const seg = { y: raw.y + treeTop.current, h: raw.h };
      if (y >= seg.y && y < seg.y + seg.h) found = year;
      top = Math.min(top, seg.y);
      bottom = Math.max(bottom, seg.y + seg.h);
    }
    if (y < top) found = 11;
    if (y >= bottom) found = 0;
    if (found !== inView) setInView(found);
    if (contentOffset.y + layoutMeasurement.height < contentSize.height - 60) {
      userMoved.current = true;
      if (!climbed) setClimbed(true);
    }
  };

  const recordSegment = (year: number) => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    segments.current.set(year, { y, h: height });
  };

  // Trunk width at a given height in the tree (0 = top, treeHeight = bottom).
  const trunkWidth = (y: number) =>
    width * (TOP_RATIO + (BOTTOM_RATIO - TOP_RATIO) * (treeHeight ? y / treeHeight : 1));
  const midWidth = width * ((TOP_RATIO + BOTTOM_RATIO) / 2);
  const edge = (width - midWidth) / 2;

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xl }]}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
          {/* ------------------------------------------------ the top: canopy */}
          <View style={styles.topText}>
            <Text style={styles.plate}>No. 2 · Timeline · The top</Text>
            <Text style={styles.title} accessibilityRole="header">
              {endLabel}: the end of the ten years
            </Text>
            <Text style={styles.summary}>
              {goals.length === 0
                ? 'No goals on the tree yet. Add one at the base and it grows a twig.'
                : `${funded} of ${goals.length} ${goals.length === 1 ? 'goal' : 'goals'} funded by the time you reach the top.`}
            </Text>
          </View>
          {width > 0 ? <Canopy width={width} /> : null}

          {/* ----------------------------------------------------- the trunk */}
          <View
            style={styles.tree}
            onLayout={e => {
              treeTop.current = e.nativeEvent.layout.y + insets.top + space.xl;
              setTreeHeight(e.nativeEvent.layout.height);
            }}
          >
            {width > 0 && treeHeight > 0 ? (
              <Trunk width={width} height={treeHeight} widthAt={trunkWidth} />
            ) : null}

            {Array.from({ length: PLAN_YEARS }, (_, i) => PLAN_YEARS - i).map(year => {
              const yearGoals = byYear.get(year) ?? [];
              const isTight = tight.has(year);
              return (
                <View key={year} onLayout={recordSegment(year)} style={styles.year}>
                  {isTight && width > 0 ? <Moss width={width} edge={edge} seed={year} /> : null}

                  {yearGoals.map(goal => (
                    <CarvedGoal
                      key={goal.key}
                      goal={goal}
                      side={side.get(goal.key) ?? 'right'}
                      edge={edge}
                      width={width}
                      onPress={() => onOpenGoal(goal.key)}
                    />
                  ))}

                  {/* A groove across the bark where this year begins. */}
                  <View style={[styles.yearMark, { marginHorizontal: edge + 8 }]}>
                    <View style={styles.groove} />
                    <View style={[styles.yearText, { paddingLeft: midWidth * 0.2 }]}>
                      <Text style={[styles.yearLabel, tabularNums]}>{yearLabel(year)}</Text>
                      <Text style={[styles.yearIndex, isTight && { color: colors.warn }]}>
                        {isTight ? `Year ${year} · tight year` : `Year ${year}`}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          {/* ----------------------------------------- the base: flare, roots */}
          {width > 0 && treeHeight > 0 ? <Base width={width} trunk={trunkWidth(treeHeight)} /> : null}
        </View>

        <View style={styles.today}>
          <Text style={styles.plate}>You are here</Text>
          <Text style={styles.todayTitle}>{startLabel}: today</Text>
          <Text style={styles.todayBody}>
            {goals.length === 0
              ? 'Add a goal and it grows a twig in the year it is due.'
              : 'Swipe up to climb through your ten years. Tap a goal on the bark to see its numbers.'}
          </Text>
          <Button label="Add a goal" variant="secondary" icon="plus" onPress={onAddGoal} />
          {footer}
        </View>
      </ScrollView>

      {/* Where you are on the climb. */}
      <View pointerEvents="none" style={[styles.altimeter, { top: insets.top + space.sm }]}>
        <Text style={[styles.altimeterText, tabularNums]}>
          {inView === 0
            ? `Today · ${startLabel}`
            : inView === 11
              ? `The top · ${endLabel}`
              : `Year ${inView} · ${yearLabel(inView)}`}
        </Text>
      </View>

      {!climbed ? (
        <View pointerEvents="none" style={styles.climbHint}>
          <Icon name="up" size={18} color={colors.accent} />
          <Text style={styles.climbText}>Swipe up to climb</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A goal carved into the bark, with a twig and a leaf out the side. */
function CarvedGoal({
  goal,
  side,
  edge,
  width,
  onPress,
}: {
  goal: TreeGoal;
  side: 'left' | 'right';
  edge: number;
  width: number;
  onPress: () => void;
}) {
  const leaf = goal.funded ? colors.accent : colors.error;
  const monthly = goal.monthlyCents !== undefined ? dollars(goal.monthlyCents, { showCents: true }) : '—';
  return (
    <View style={styles.goalRow}>
      {/* The twig, sticking out past the bark edge. */}
      {width > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.twig,
            side === 'left' ? { left: edge - 36 } : { right: edge - 36, transform: [{ scaleX: -1 }] },
          ]}
        >
          {/* Drawn pointing left; mirrored for the right side. It starts inside
              the bark and pokes out into the gap beside the trunk. */}
          <Svg width={64} height={72}>
            <Path
              d="M62 60 L40 50 L18 30 L23 25 L44 42 L62 50 Z"
              fill={BARK.mid}
              stroke={BARK.outline}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <FernLeafPaths x={21} y={28} length={30} angle={-112} opacity={1} color={leaf} veins={8} />
          </Svg>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${goal.title}, due ${goal.targetLabel}, ${goal.funded ? 'funded' : "doesn't fit yet"}. ${monthly} a month. Open details.`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.carving,
          { marginLeft: edge + width * 0.16, marginRight: edge + width * 0.06 },
          pressed && { backgroundColor: 'rgba(30, 18, 12, 0.35)' },
        ]}
      >
        <View style={styles.carvingHead}>
          <Icon name={goal.icon} size={22} color={goal.color ?? BARK.ink} />
          <Text style={styles.carvingTitle} numberOfLines={2}>
            {goal.title}
          </Text>
        </View>
        <Text style={styles.carvingMeta}>
          {goal.targetLabel} · {dollars(goal.costTodayCents)} today ·{' '}
          {goal.priority === 'must' ? 'Must‑have' : 'Flexible'}
        </Text>
        <Text style={[styles.carvingMonthly, tabularNums]}>
          {monthly}
          <Text style={styles.carvingMeta}> a month</Text>
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: leaf }]} />
          <Text style={styles.carvingMeta}>{goal.funded ? 'Funded' : "Doesn't fit yet"}</Text>
        </View>
      </Pressable>
    </View>
  );
}

/** The trunk: bark fill, a flat sunlit band, a flat shaded band, cracks, outline. */
function Trunk({
  width,
  height,
  widthAt,
}: {
  width: number;
  height: number;
  widthAt: (y: number) => number;
}) {
  const art = useMemo(() => {
    const rand = seeded(42);
    const c = width / 2;
    const step = 90;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let y = -10; y <= height + step; y += step) {
      const yy = Math.min(y, height + 4);
      const w = widthAt(Math.max(0, yy));
      left.push([c - w / 2 + (rand() - 0.5) * 6, yy]);
      right.push([c + w / 2 + (rand() - 0.5) * 6, yy]);
    }
    const outline =
      `M${left.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')}` +
      ` L${[...right].reverse().map(([x, y]) => `${f(x)},${f(y)}`).join(' L')} Z`;

    // Sunlit band down the left, shaded band down the right.
    const lit =
      `M${left.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')}` +
      ` L${[...left].reverse().map(([x, y]) => `${f(x + widthAt(Math.max(0, y)) * 0.2)},${f(y)}`).join(' L')} Z`;
    const shade =
      `M${right.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')}` +
      ` L${[...right].reverse().map(([x, y]) => `${f(x - widthAt(Math.max(0, y)) * 0.1)},${f(y)}`).join(' L')} Z`;

    // Bark cracks: long wavy hairlines, mostly near the edges so the carved
    // text stays readable down the middle.
    let cracks = '';
    const count = Math.round(height / 34);
    for (let i = 0; i < count; i++) {
      const y0 = rand() * height;
      const w = widthAt(y0);
      const nearEdge = rand() < 0.75;
      const u = nearEdge ? (rand() < 0.5 ? 0.04 + rand() * 0.18 : 0.8 + rand() * 0.16) : 0.25 + rand() * 0.5;
      let x = c - w / 2 + u * w;
      let y = y0;
      cracks += ` M${f(x)},${f(y)}`;
      const segs = 2 + Math.floor(rand() * 3);
      for (let s = 0; s < segs; s++) {
        const dy = 26 + rand() * 40;
        const dx = (rand() - 0.5) * 8;
        cracks += ` q${f(dx * 2)},${f(dy / 2)} ${f(dx)},${f(dy)}`;
        x += dx;
        y += dy;
      }
    }
    return { outline, lit, shade, cracks };
  }, [width, height, widthAt]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden>
      <Svg width={width} height={height}>
        <Path d={art.outline} fill={BARK.mid} />
        <Path d={art.lit} fill={BARK.light} />
        <Path d={art.shade} fill={BARK.shadow} />
        <Path d={art.cracks} stroke={BARK.crack} strokeWidth={1.6} fill="none" strokeLinecap="round" opacity={0.85} />
        <Path d={art.outline} stroke={BARK.outline} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/** Moss on a tight year: a flat patch on the shaded side of the bark. */
function Moss({ width, edge, seed }: { width: number; edge: number; seed: number }) {
  const rand = seeded(seed * 97);
  const x = width - edge - 70;
  const y = 40 + rand() * 120;
  let d = `M${f(x)},${f(y)}`;
  const n = 9;
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 34 + rand() * 18;
    d += ` Q${f(x + Math.cos(a - 0.35) * (r + 8))},${f(y + Math.sin(a - 0.35) * (r + 14))} ${f(x + Math.cos(a) * r)},${f(y + Math.sin(a) * (r + 10))}`;
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden>
      <Svg width={width} height={260}>
        <Path d={d + ' Z'} fill={BARK.moss} opacity={0.95} />
        <Path d={`M${f(x - 12)},${f(y)} a6,6 0 1 0 12,0 a6,6 0 1 0 -12,0 M${f(x + 14)},${f(y + 18)} a4,4 0 1 0 8,0 a4,4 0 1 0 -8,0`} fill={BARK.mossDark} />
      </Svg>
    </View>
  );
}

/** The foliage at the top, hanging down over the trunk: you only see it at the end. */
function Canopy({ width }: { width: number }) {
  const H = 170;
  const rand = seeded(7);
  // A scalloped lower edge of drooping fronds.
  let d = `M0,0 L${f(width)},0 L${f(width)},${f(H * 0.55)}`;
  const fronds = 9;
  for (let i = fronds; i >= 1; i--) {
    const x0 = (i / fronds) * width;
    const x1 = ((i - 1) / fronds) * width;
    const depth = H * (0.62 + rand() * 0.38);
    d += ` Q${f((x0 + x1) / 2 + (rand() - 0.5) * 18)},${f(depth + 30)} ${f(x1)},${f(H * (0.45 + rand() * 0.2))}`;
  }
  d += ' Z';
  // Frond veins.
  let veins = '';
  for (let i = 0; i < 16; i++) {
    const x = rand() * width;
    const y = 30 + rand() * (H * 0.5);
    veins += ` M${f(x)},${f(y)} q${f((rand() - 0.5) * 20)},18 ${f((rand() - 0.5) * 10)},${f(34 + rand() * 30)}`;
  }
  return (
    <View style={[styles.canopy, { height: H }]} pointerEvents="none" aria-hidden>
      <Svg width={width} height={H + 40}>
        <Path d={d} fill={BARK.foliage} stroke={BARK.foliageDark} strokeWidth={2} strokeLinejoin="round" />
        <Path d={veins} stroke={BARK.foliageDark} strokeWidth={1.5} fill="none" strokeLinecap="round" />
        <Path d={`M0,0 L${f(width)},0 L${f(width)},22 L0,22 Z`} fill={BARK.foliageLight} opacity={0.35} />
      </Svg>
    </View>
  );
}

/** The base: the trunk flares into roots that grip the ground, with bushes either side. */
function Base({ width, trunk }: { width: number; trunk: number }) {
  const H = 120;
  const c = width / 2;
  const t = trunk / 2;
  const g = 86; // ground line
  const flare = `M${f(c - t)},0 L${f(c + t)},0 C${f(c + t + 4)},40 ${f(c + t + 20)},70 ${f(Math.min(width - 4, c + t + 46))},${g} L${f(Math.max(4, c - t - 46))},${g} C${f(c - t - 20)},70 ${f(c - t - 4)},40 ${f(c - t)},0 Z`;
  const lit = `M${f(c - t)},0 L${f(c - t + trunk * 0.2)},0 L${f(c - t + trunk * 0.12)},${g} L${f(Math.max(4, c - t - 46))},${g} C${f(c - t - 20)},70 ${f(c - t - 4)},40 ${f(c - t)},0 Z`;
  return (
    <View style={styles.base} aria-hidden>
      <Svg width={width} height={H}>
        <Path d={flare} fill={BARK.mid} />
        <Path d={lit} fill={BARK.light} />
        <Path
          d={`M${f(c - t * 0.4)},20 q4,30 -2,60 M${f(c + t * 0.3)},10 q-6,34 2,70 M${f(c + t * 0.75)},30 q4,24 14,50`}
          stroke={BARK.crack}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
        />
        <Path d={flare} stroke={BARK.outline} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
        {/* roots running along the ground */}
        <Path
          d={`M${f(c - t - 30)},${g - 2} C${f(c - t - 60)},${g + 6} ${f(c - t - 90)},${g + 4} ${f(c - t - 130)},${g + 14} M${f(c + t + 30)},${g - 2} C${f(c + t + 64)},${g + 8} ${f(c + t + 96)},${g + 2} ${f(c + t + 140)},${g + 16}`}
          stroke={BARK.outline}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
        />
        {/* bushes either side, flat */}
        <Path d={`M0,${g} q14,-34 40,-22 q12,-22 36,-6 q10,10 4,28 Z`} fill={colors.treeFar} stroke={BARK.foliageDark} strokeWidth={1.5} />
        <Path d={`M${f(width)},${g} q-16,-38 -44,-24 q-14,-20 -36,-2 q-8,12 -2,26 Z`} fill={colors.treeFar} stroke={BARK.foliageDark} strokeWidth={1.5} />
        <Path d={`M0,${g} L${f(width)},${g}`} stroke={colors.ruleStrong} strokeWidth={line.hair} />
        <Path d={`M20,${g + 18} q16,-3 32,0 t32,0 t32,0 M${f(width - 140)},${g + 24} q16,-3 32,0 t32,0`} stroke={colors.accent} strokeWidth={line.hair} fill="none" opacity={0.3} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: {
    paddingBottom: space.xxl,
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    alignSelf: 'center',
  },

  topText: { alignItems: 'center', paddingHorizontal: space.sidePadding, paddingTop: space.xxl, paddingBottom: space.lg },
  plate: { ...typeScale.plate, color: colors.accent, textAlign: 'center' },
  title: { ...typeScale.title, fontSize: 26, lineHeight: 32, color: colors.ink, textAlign: 'center', marginTop: space.xs },
  summary: {
    ...typeScale.bodyItalic,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink2,
    textAlign: 'center',
    marginTop: space.sm,
    maxWidth: 320,
  },
  // The foliage hangs over the top of the trunk.
  canopy: { zIndex: 2, marginBottom: -70 },

  tree: { position: 'relative' },
  year: { minHeight: YEAR_MIN_HEIGHT, justifyContent: 'flex-end', paddingTop: 80 },

  yearMark: { paddingBottom: space.md },
  groove: { height: 3, backgroundColor: BARK.crack, borderRadius: 2, opacity: 0.9, marginBottom: space.sm },
  yearText: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  yearLabel: { fontFamily: fonts.numeral, fontSize: 26, lineHeight: 32, color: BARK.ink },
  yearIndex: { ...typeScale.caption, color: BARK.meta },

  goalRow: { position: 'relative', marginBottom: space.xl, justifyContent: 'center' },
  twig: { position: 'absolute', top: 0 },
  carving: { paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: 6, minHeight: 44 },
  carvingHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  carvingTitle: { fontFamily: fonts.numeral, fontSize: 22, lineHeight: 27, color: BARK.ink, flexShrink: 1 },
  carvingMeta: { ...typeScale.caption, color: BARK.meta },
  carvingMonthly: { fontFamily: fonts.numeral, fontSize: 20, lineHeight: 26, color: BARK.ink, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  base: { marginTop: -1 },
  today: { alignItems: 'center', paddingHorizontal: space.sidePadding, paddingTop: space.sm },
  todayTitle: { ...typeScale.title, fontSize: 24, lineHeight: 30, color: colors.ink, marginTop: space.xs },
  todayBody: { ...typeScale.body, color: colors.ink2, textAlign: 'center', marginTop: space.xs, maxWidth: 320 },

  altimeter: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.band,
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
    borderRadius: 999,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  altimeterText: { fontFamily: fonts.textMedium, fontSize: 13, color: colors.ink },
  climbHint: {
    position: 'absolute',
    bottom: space.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.band,
    borderRadius: 999,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
  },
  climbText: { fontFamily: fonts.textMedium, fontSize: 13, color: colors.accent },
});
