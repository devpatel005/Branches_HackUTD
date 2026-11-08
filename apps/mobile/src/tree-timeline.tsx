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
import Svg, { G, Path } from 'react-native-svg';
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
  light: '#7A4F38', // the sunlit side, a flat band (kept close to the bark)
  shadow: '#5E3B2A', // the shaded side
  crack: '#3E281C',
  outline: '#3E281C',
  ink: '#F6ECE0',
  meta: '#E8D3BF',
  moss: '#5F7436',
  mossDark: '#45572A',
  // Boughs use the same flat night greens as the forest in the background.
  foliage: '#1D3936',
  foliageDark: '#152C2A',
  foliageLight: '#24443F',
};

const PLAN_YEARS = 10;
const YEAR_MIN_HEIGHT = 240; // the year-by-year climb: about 2,500px of trunk
const TOP_RATIO = 0.28; // trunk width near the canopy, as a share of the column
const BOTTOM_RATIO = 0.34; // and just above the flare

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const f = (n: number) => n.toFixed(1);

type TreeProps = {
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
};

/**
 * Two ways to see the same tree. It opens zoomed out, with the whole tree on
 * one screen; tapping a year (or "Climb year by year") zooms into the bark at
 * that year, and "Whole tree" zooms back out.
 */
export function TreeTimeline(props: TreeProps) {
  const [climbFrom, setClimbFrom] = useState<number | null>(null);
  if (climbFrom === null) return <TreeOverview {...props} onClimb={setClimbFrom} />;
  return <TreeClimb {...props} initialYear={climbFrom} onZoomOut={() => setClimbFrom(null)} />;
}

function groupGoals(goals: readonly TreeGoal[]) {
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
  return { byYear, side };
}

// ---------------------------------------------------------------------------
// Zoomed out: the whole tree on one screen, one tappable band per year.
// ---------------------------------------------------------------------------

function TreeOverview({
  goals,
  tightYears,
  yearLabel,
  startLabel,
  endLabel,
  onAddGoal,
  onClimb,
}: TreeProps & { onClimb: (year: number) => void }) {
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState({ w: 0, h: 0 });
  const tight = new Set(tightYears);
  const funded = goals.filter(g => g.funded).length;

  return (
    <View style={styles.root}>
      <View style={[styles.overviewHead, { paddingTop: insets.top + space.lg }]}>
        <Text style={styles.plate}>No. 2 · Timeline · Your ten years</Text>
        <Text style={styles.overviewTitle} accessibilityRole="header">
          {startLabel} to {endLabel}
        </Text>
        <Text style={styles.overviewSummary}>
          {goals.length === 0
            ? 'No goals yet. Tap a year to climb in, or add a goal.'
            : `${funded} of ${goals.length} ${goals.length === 1 ? 'goal' : 'goals'} funded. Tap a year to climb in and see its goals.`}
        </Text>
      </View>

      {/* The tree takes whatever height is left, so the whole of it fits. */}
      <View
        style={styles.overviewArea}
        onLayout={e =>
          setArea({ w: Math.min(e.nativeEvent.layout.width, COLUMN_MAX_WIDTH), h: e.nativeEvent.layout.height })
        }
      >
        {area.w > 0 && area.h > 0 ? (
          <Spruce width={area.w} height={area.h} tight={tight} yearLabel={yearLabel} onClimb={onClimb} />
        ) : null}
      </View>

      <View style={styles.overviewActions}>
        <View style={{ flex: 1 }}>
          <Button label="Year by year" icon="up" onPress={() => onClimb(1)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Add a goal" variant="secondary" icon="plus" onPress={onAddGoal} />
        </View>
      </View>
    </View>
  );
}

/**
 * The whole plan as one tree: a bark trunk flaring into line-work roots, a
 * side branch with a leaf clump every two years, and a round crown over the
 * last years. Same shape as a classic game tree, drawn in the app's own style:
 * flat layered night greens with a faint seafoam edge, flat brown bark, no
 * outlines, no gradients. Fixed seed, so it is identical on every render.
 */

/** A soft, lumpy clump of leaves: points round an ellipse, smoothed with curves. */
function clumpPath(cx: number, cy: number, rx: number, ry: number, seed: number, lumps = 11) {
  const r = seeded(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2;
    const k = 0.88 + r() * 0.18;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const m = mid(a, b);
    // Push each control point outward a little so the edge reads as lumps of leaves.
    const ox = a[0] + (a[0] - cx) * 0.12;
    const oy = a[1] + (a[1] - cy) * 0.12;
    d += i === 0 ? `M${f(mid(pts[pts.length - 1]!, a)[0])},${f(mid(pts[pts.length - 1]!, a)[1])}` : '';
    d += ` Q${f(ox)},${f(oy)} ${f(m[0])},${f(m[1])}`;
  }
  return d + ' Z';
}

function Spruce({
  width: W,
  height: H,
  tight,
  yearLabel,
  onClimb,
}: {
  width: number;
  height: number;
  tight: Set<number>;
  yearLabel: (year: number) => string;
  onClimb: (year: number) => void;
}) {
  const TOP = 20;
  const BASE = 40;
  const GUTTER = 112;
  const rowH = (H - TOP - BASE) / PLAN_YEARS;
  const rowTop = (year: number) => TOP + (PLAN_YEARS - year) * rowH;
  const cx = Math.max(GUTTER + 70, W * 0.62);
  const room = Math.min(W - cx - 8, cx - GUTTER - 8);

  const crown = {
    x: cx,
    y: rowTop(PLAN_YEARS) + rowH * 1.0,
    rx: Math.max(44, Math.min(room, W * 0.24)),
    ry: Math.max(40, rowH * 1.9),
  };
  const trunkTop = crown.y;
  const trunkBottom = H - BASE;
  const tTop = 7;
  const tBot = 12;
  const trunk = `M${f(cx - tTop)},${f(trunkTop)} L${f(cx + tTop)},${f(trunkTop)} L${f(cx + tBot)},${f(trunkBottom)} L${f(cx - tBot)},${f(trunkBottom)} Z`;
  const trunkLit = `M${f(cx - tTop)},${f(trunkTop)} L${f(cx - tTop + 4)},${f(trunkTop)} L${f(cx - tBot + 5)},${f(trunkBottom)} L${f(cx - tBot)},${f(trunkBottom)} Z`;

  // Branches every two years, alternating sides, rising to a clump.
  const branches = [2, 4, 6, 8].map((year, i) => {
    const dir = i % 2 === 0 ? 1 : -1;
    const y0 = rowTop(year) + rowH * 0.85;
    const len = Math.min(48, room - 26);
    const x1 = cx + dir * (tTop + len);
    const y1 = y0 - rowH * 0.55;
    return {
      year,
      stem: `M${f(cx + dir * tTop * 0.6)},${f(y0)} Q${f(cx + dir * (tTop + len * 0.6))},${f(y0)} ${f(x1)},${f(y1)}`,
      clump: { x: x1 + dir * 4, y: y1 - 6, rx: Math.min(22, room - len + 6), ry: 15 },
    };
  });

  const leaderEnd = (year: number) => {
    const y = rowTop(year) + rowH / 2;
    const k = (y - crown.y) / crown.ry;
    const trunkLeft = cx - tBot - 6;
    if (Math.abs(k) < 1) return Math.min(trunkLeft, crown.x - crown.rx * Math.sqrt(1 - k * k)) - 6;
    return trunkLeft;
  };

  const leafLayers = (x: number, y: number, rx: number, ry: number, seed: number) => (
    <>
      <Path d={clumpPath(x, y, rx, ry, seed)} fill={BARK.foliage} />
      {/* a lighter layer up and to the left: depth from flat layers, not a gradient */}
      <Path d={clumpPath(x - rx * 0.14, y - ry * 0.16, rx * 0.74, ry * 0.68, seed + 1, 9)} fill={BARK.foliageLight} />
      <Path d={clumpPath(x, y, rx, ry, seed)} stroke={colors.accent} strokeOpacity={0.35} strokeWidth={line.hair} fill="none" />
    </>
  );

  return (
    <View style={{ width: W, height: H, alignSelf: 'center' }}>
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        {branches.map(b => (
          <Path key={`s${b.year}`} d={b.stem} stroke={BARK.mid} strokeWidth={5} strokeLinecap="round" fill="none" />
        ))}
        <Path d={trunk} fill={BARK.mid} />
        <Path d={trunkLit} fill={BARK.light} />
        {branches.map(b => (
          <G key={`c${b.year}`}>{leafLayers(b.clump.x, b.clump.y, b.clump.rx, b.clump.ry, 40 + b.year)}</G>
        ))}
        {leafLayers(crown.x, crown.y, crown.rx, crown.ry, 7)}
      </Svg>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} pointerEvents="none">
        <Base width={W} trunk={tBot * 2} height={BASE} center={cx} />
      </View>

      {Array.from({ length: PLAN_YEARS }, (_, i) => PLAN_YEARS - i).map(year => {
        const isTight = tight.has(year);
        return (
          <Pressable
            key={year}
            accessibilityRole="button"
            accessibilityLabel={`Year ${year}, ${yearLabel(year)}${isTight ? ', a tight year' : ''}. Climb in to see its goals.`}
            onPress={() => onClimb(year)}
            style={({ pressed }) => [
              styles.spruceRow,
              { top: rowTop(year), height: rowH },
              pressed && { backgroundColor: 'rgba(143, 227, 200, 0.07)' },
            ]}
          >
            <View style={styles.spruceLabel}>
              <Text style={[styles.overviewYearLabel, tabularNums]}>{yearLabel(year)}</Text>
              <Text style={[styles.overviewYearIndex, isTight && { color: colors.warn }]}>
                {isTight ? `Year ${year} · tight` : `Year ${year}`}
              </Text>
            </View>
            <View
              pointerEvents="none"
              style={[
                styles.spruceLeader,
                { top: rowH / 2, left: GUTTER - 10, width: Math.max(0, leaderEnd(year) - GUTTER + 10) },
                isTight && { backgroundColor: colors.warn },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Zoomed in: climb the bark year by year.
// ---------------------------------------------------------------------------

function TreeClimb({
  goals,
  tightYears,
  yearLabel,
  startLabel,
  endLabel,
  onOpenGoal,
  onAddGoal,
  footer,
  initialYear,
  onZoomOut,
}: TreeProps & { initialYear: number; onZoomOut: () => void }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  // For the first moment after zooming in, keep re-anchoring at the chosen
  // year: the content grows as the trunk measures itself, and each growth
  // would otherwise leave the view stranded somewhere else.
  const mountedAt = useRef(Date.now());
  const viewport = useRef(0);
  const segments = useRef(new Map<number, { y: number; h: number }>());
  const treeTop = useRef(0);
  const [width, setWidth] = useState(0);
  const [treeHeight, setTreeHeight] = useState(0);
  // 0 = the base (today), 1-10 = plan years, 11 = the canopy (the top).
  const [inView, setInView] = useState(0);
  const [climbed, setClimbed] = useState(false);

  const tight = new Set(tightYears);
  const funded = goals.filter(g => g.funded).length;
  const { byYear, side } = groupGoals(goals);

  // Year 1 opens at the base; any other year opens with its groove low on the
  // screen and its goals above it.
  const anchor = useCallback(() => {
    if (Date.now() - mountedAt.current > 1200) return;
    if (initialYear <= 1) {
      scrollRef.current?.scrollToEnd({ animated: false });
      return;
    }
    const raw = segments.current.get(initialYear);
    if (!raw || viewport.current === 0) return;
    const y = raw.y + treeTop.current + raw.h - viewport.current * 0.8;
    scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false });
  }, [initialYear]);

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
    if (
      Date.now() - mountedAt.current > 1200 &&
      contentOffset.y + layoutMeasurement.height < contentSize.height - 60 &&
      !climbed
    ) {
      setClimbed(true);
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
    <View style={styles.root} onLayout={e => (viewport.current = e.nativeEvent.layout.height)}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xl }]}
        onContentSizeChange={anchor}
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
          {width > 0 ? <Canopy width={width} height={170} /> : null}

          {/* ----------------------------------------------------- the trunk */}
          <View
            style={styles.tree}
            onLayout={e => {
              treeTop.current = e.nativeEvent.layout.y + insets.top + space.xl;
              setTreeHeight(e.nativeEvent.layout.height);
              // Children lay out before their parent, so every year is known here.
              anchor();
            }}
          >
            {width > 0 && treeHeight > 0 ? (
              <Trunk width={width} height={treeHeight} widthAt={trunkWidth} />
            ) : null}

            {Array.from({ length: PLAN_YEARS }, (_, i) => PLAN_YEARS - i).map(year => {
              const yearGoals = byYear.get(year) ?? [];
              const isTight = tight.has(year);
              return (
                <View
                  key={year}
                  onLayout={recordSegment(year)}
                  style={[styles.year, isTight && { backgroundColor: colors.warnBand }]}
                >

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
                    <View style={styles.yearText}>
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
          {width > 0 && treeHeight > 0 ? <Base width={width} trunk={trunkWidth(treeHeight)} height={120} /> : null}
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom out to the whole tree"
        onPress={onZoomOut}
        style={({ pressed }) => [styles.zoomOut, { top: insets.top + space.sm }, pressed && { opacity: 0.8 }]}
      >
        <Icon name="back" size={16} color={colors.ink} />
        <Text style={styles.altimeterText}>Whole tree</Text>
      </Pressable>

      {!climbed && initialYear <= 1 ? (
        <View pointerEvents="none" style={styles.climbHint}>
          <Icon name="up" size={18} color={colors.accent} />
          <Text style={styles.climbText}>Swipe up to climb</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A goal beside the trunk, joined to it by a twig with a leaf. */
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
  const left = side === 'left';
  const zone = Math.max(96, edge - 14);
  const align = left ? ('right' as const) : ('left' as const);

  const label = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${goal.title}, due ${goal.targetLabel}, ${goal.funded ? 'funded' : "doesn't fit yet"}. ${monthly} a month. Open details.`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sideGoal,
        { width: zone, alignItems: left ? 'flex-end' : 'flex-start' },
        pressed && { backgroundColor: colors.surface },
      ]}
    >
      <View style={[styles.carvingHead, left && { flexDirection: 'row-reverse' }]}>
        <Icon name={goal.icon} size={18} color={goal.color ?? colors.ink} />
        <Text style={[styles.sideTitle, { textAlign: align }]} numberOfLines={3}>
          {goal.title}
        </Text>
      </View>
      <Text style={[styles.sideMeta, { textAlign: align }]}>{goal.targetLabel}</Text>
      <Text style={[styles.sideMeta, { textAlign: align }]}>
        {dollars(goal.costTodayCents)} today · {goal.priority === 'must' ? 'Must\u2011have' : 'Flexible'}
      </Text>
      <Text style={[styles.sideMonthly, tabularNums, { textAlign: align }]}>{monthly}</Text>
      <Text style={[styles.sideMeta, { textAlign: align }]}>a month</Text>
      <View style={[styles.statusRow, left && { flexDirection: 'row-reverse' }]}>
        <View style={[styles.statusDot, { backgroundColor: leaf }]} />
        <Text style={styles.sideMeta}>{goal.funded ? 'Funded' : "Doesn't fit yet"}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.goalRow, { flexDirection: 'row', justifyContent: left ? 'flex-start' : 'flex-end' }]}>
      {/* The twig, from the bark out towards the goal. */}
      {width > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.twig,
            left ? { left: edge - 40 } : { right: edge - 40, transform: [{ scaleX: -1 }] },
          ]}
        >
          <Svg width={64} height={72}>
            <Path
              d="M62 58 C 48 54, 34 44, 22 30"
              stroke={colors.accent}
              strokeWidth={line.path}
              fill="none"
              strokeLinecap="round"
              opacity={0.8}
            />
            <FernLeafPaths x={22} y={31} length={28} angle={-118} opacity={0.95} color={leaf} veins={8} />
          </Svg>
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 8, paddingTop: 54 }}>{label}</View>
    </View>
  );
}

/** The trunk: bark fill, a flat sunlit band, a flat shaded band, cracks, outline. */
function Trunk({
  width,
  height,
  widthAt,
  seed = 42,
  density = 34,
}: {
  width: number;
  height: number;
  widthAt: (y: number) => number;
  seed?: number;
  /** Pixels of trunk per crack: higher means fewer cracks. */
  density?: number;
}) {
  const art = useMemo(() => {
    const rand = seeded(seed);
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
    const count = Math.round(height / density);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, seed, density]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden>
      <Svg width={width} height={height}>
        <Path d={art.outline} fill={BARK.mid} />
        <Path d={art.lit} fill={BARK.light} />
        <Path d={art.shade} fill={BARK.shadow} />
        <Path d={art.cracks} stroke={BARK.crack} strokeWidth={line.hair} fill="none" strokeLinecap="round" opacity={0.6} />
      </Svg>
    </View>
  );
}

/** The foliage at the top, hanging down over the trunk: you only see it at the end. */
function Canopy({ width, height, overlap }: { width: number; height: number; overlap?: number }) {
  const H = height;
  // Three flat bands of boughs, each with a notched lower edge like the
  // spruces in the background, darkest at the back. One faint seafoam line
  // along the front edge, as everywhere else in the app.
  const band = (bottom: number, depth: number, teeth: number, seed: number) => {
    const rand = seeded(seed);
    let d = `M0,0 L${f(width)},0 L${f(width)},${f(bottom)}`;
    for (let k = teeth; k >= 1; k--) {
      const x0 = (k / teeth) * width;
      const x1 = ((k - 1) / teeth) * width;
      const tip = bottom + depth * (0.6 + rand() * 0.4);
      d += ` L${f((x0 + x1) / 2)},${f(tip)} L${f(x1)},${f(bottom)}`;
    }
    return d + ' Z';
  };
  // Few, short points: a hint of boughs, not a row of spikes.
  const front = band(H * 0.62, H * 0.12, 5, 3);
  return (
    <View style={[styles.canopy, { height: H, marginBottom: -(overlap ?? Math.round(H * 0.4)) }]} pointerEvents="none" aria-hidden>
      <Svg width={width} height={H + 10}>
        <Path d={band(H * 0.4, H * 0.1, 4, 1)} fill={colors.treeFar} />
        <Path d={band(H * 0.52, H * 0.11, 4, 2)} fill={BARK.foliageLight} />
        <Path d={front} fill={BARK.foliage} />
        <Path d={front} stroke={colors.accent} strokeOpacity={0.35} strokeWidth={line.hair} fill="none" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/** The base: the trunk flares into roots, drawn as line-work along the ground. */
function Base({
  width,
  trunk,
  height,
  center,
}: {
  width: number;
  trunk: number;
  height: number;
  center?: number;
}) {
  const H = height;
  const c = center ?? width / 2;
  const t = trunk / 2;
  const g = Math.round(H * 0.6); // ground line
  const spread = Math.min(46, t + 18);
  const flare = `M${f(c - t)},0 L${f(c + t)},0 C${f(c + t + 2)},${f(g * 0.5)} ${f(c + t + spread * 0.4)},${f(g * 0.85)} ${f(c + t + spread)},${g} L${f(c - t - spread)},${g} C${f(c - t - spread * 0.4)},${f(g * 0.85)} ${f(c - t - 2)},${f(g * 0.5)} ${f(c - t)},0 Z`;
  return (
    <View style={styles.base} aria-hidden>
      <Svg width={width} height={H}>
        <Path d={flare} fill={BARK.mid} />
        {/* roots: seafoam line-work spreading out under the ground */}
        <Path
          d={`M${f(c - t)},${g} C${f(c - t - 30)},${g + 6} ${f(c - t - 70)},${g + 4} ${f(c - t - 120)},${g + 12} M${f(c - 4)},${g} C${f(c - 10)},${g + 10} ${f(c - 30)},${g + 16} ${f(c - 54)},${g + 22} M${f(c + t)},${g} C${f(c + t + 34)},${g + 8} ${f(c + t + 80)},${g + 4} ${f(c + t + 130)},${g + 14} M${f(c + 4)},${g} C${f(c + 12)},${g + 12} ${f(c + 34)},${g + 18} ${f(c + 60)},${g + 22}`}
          stroke={colors.accent}
          strokeWidth={line.hair}
          fill="none"
          strokeLinecap="round"
          opacity={0.55}
        />
        <Path d={`M0,${g} L${f(width)},${g}`} stroke={colors.ruleStrong} strokeWidth={line.hair} />
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
  canopy: { zIndex: 2 },

  tree: { position: 'relative' },
  year: { minHeight: YEAR_MIN_HEIGHT, justifyContent: 'flex-end', paddingTop: 40 },

  yearMark: { paddingBottom: space.md },
  groove: { height: 3, backgroundColor: BARK.crack, borderRadius: 2, opacity: 0.9, marginBottom: space.sm },
  yearText: { alignItems: 'center' },
  yearLabel: { fontFamily: fonts.numeral, fontSize: 19, lineHeight: 24, color: BARK.ink },
  yearIndex: { ...typeScale.caption, color: BARK.meta },

  goalRow: { position: 'relative', marginBottom: space.lg, justifyContent: 'center' },
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
  zoomOut: {
    position: 'absolute',
    left: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 36,
    backgroundColor: colors.band,
    borderWidth: line.hair,
    borderColor: colors.ruleStrong,
    borderRadius: 999,
    paddingLeft: space.sm,
    paddingRight: space.md,
  },

  overview: { width: '100%', maxWidth: COLUMN_MAX_WIDTH, alignSelf: 'center' },
  overviewHead: { alignItems: 'center', paddingHorizontal: space.sidePadding, paddingBottom: space.sm },
  overviewArea: { flex: 1, width: '100%', maxWidth: COLUMN_MAX_WIDTH, alignSelf: 'center' },
  spruceRow: { position: 'absolute', left: 0, right: 0, justifyContent: 'center', paddingLeft: space.md },
  spruceLabel: { width: 96 },
  spruceLeader: { position: 'absolute', height: 1, backgroundColor: colors.ruleStrong },
  sideGoal: { paddingVertical: space.xs, paddingHorizontal: 4, borderRadius: 6, minHeight: 44 },
  sideTitle: { fontFamily: fonts.numeral, fontSize: 16, lineHeight: 20, color: colors.ink, flexShrink: 1 },
  sideMeta: { ...typeScale.caption, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  sideMonthly: { fontFamily: fonts.numeral, fontSize: 17, lineHeight: 22, color: colors.ink, marginTop: 2 },
  overviewTitle: { ...typeScale.title, fontSize: 22, lineHeight: 28, color: colors.ink, marginTop: 2 },
  overviewSummary: { ...typeScale.caption, color: colors.ink2, marginTop: 4, textAlign: 'center' },
  overviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  miniGroove: { position: 'absolute', bottom: 0, height: 2, borderRadius: 1, backgroundColor: BARK.crack },
  overviewYear: { width: 66 },
  overviewYearLabel: { fontFamily: fonts.numeral, fontSize: 16, lineHeight: 19, color: colors.ink },
  overviewYearIndex: { fontFamily: fonts.textMedium, fontSize: 11, lineHeight: 14, color: colors.ink2 },
  overviewGoals: { flex: 1, gap: 2 },
  overviewGoal: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  overviewGoalText: { fontFamily: fonts.textSemi, fontSize: 12, lineHeight: 16, color: BARK.ink, flexShrink: 1 },
  overviewGoalMore: { fontFamily: fonts.textMedium, fontSize: 11, color: BARK.meta },
  miniTwig: { position: 'absolute', top: 2 },
  miniMoss: {
    position: 'absolute',
    top: 6,
    width: 26,
    height: 18,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 9,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 13,
    backgroundColor: BARK.moss,
  },
  overviewActions: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    alignSelf: 'center',
  },

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
