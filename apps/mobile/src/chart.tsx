import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { colors, fonts, line, space, type as typeScale } from './theme';

/**
 * ProjectionChart — the plan drawn as a single path through the forest.
 *
 * - One flat line (seafoam, or salmonberry if any goal is at risk). No fill
 *   under it, no gradient, no gridlines.
 * - Goals are transit-map stations on the line: a ring with a one-line label.
 * - Tight years are flat lichen bands behind the line (10% opacity).
 * - Scrubbing shows a hairline cursor and reports the point to the hero.
 */

export type ChartPoint = { month: number; value: number };
export type ChartMarker = { month: number; label: string; atRisk: boolean; dateStr?: string };

const HEIGHT = 176;
const PAD_TOP = 34;
const PAD_BOTTOM = 18;

export function ProjectionChart({
  points,
  markers = [],
  atRisk = false,
  tightYears = [],
  startYear,
  onScrub,
}: {
  points: readonly ChartPoint[];
  markers?: readonly ChartMarker[];
  atRisk?: boolean;
  /** 1-based plan years containing a tight month (engine output). */
  tightYears?: readonly number[];
  /** Calendar year of plan month 0, for the three axis labels. */
  startYear?: number;
  floor?: number;
  onScrub?: (point: ChartPoint | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const [scrubX, setScrubX] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const widthRef = useRef(0);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;

  const lineColor = atRisk ? colors.error : colors.accent;

  const geometry = useMemo(() => {
    if (points.length < 2 || width <= 0) return null;
    const values = points.map(p => p.value);
    const min = Math.min(...values, 0);
    const max = Math.max(...values);
    const span = max - min || Math.max(1, Math.abs(max) * 0.1);
    const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const lastMonth = points[points.length - 1]!.month;
    const firstMonth = points[0]!.month;
    const monthSpan = Math.max(1, lastMonth - firstMonth);

    const xOfMonth = (month: number) => ((month - firstMonth) / monthSpan) * width;
    const x = (i: number) => xOfMonth(points[i]!.month);
    const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * plotH;

    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' ');
    const monthToIndex = new Map(points.map((p, i) => [p.month, i]));
    return { path, x, y, xOfMonth, monthToIndex };
  }, [points, width]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: e => scrubAt(e.nativeEvent.locationX),
        onPanResponderMove: e => scrubAt(e.nativeEvent.locationX),
        onPanResponderRelease: endScrub,
        onPanResponderTerminate: endScrub,
      }),
    []
  );

  function scrubAt(locationX: number) {
    const list = pointsRef.current;
    const w = widthRef.current;
    if (list.length < 2 || w <= 0) return;
    setTouched(true);
    const clamped = Math.max(0, Math.min(w, locationX));
    const index = Math.round((clamped / w) * (list.length - 1));
    const point = list[index];
    if (!point) return;
    setScrubX(clamped);
    onScrubRef.current?.(point);
  }

  function endScrub() {
    setScrubX(null);
    onScrubRef.current?.(null);
  }

  function onLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    widthRef.current = next;
    setWidth(next);
  }

  const scrubIndex =
    scrubX !== null && points.length > 1 && width > 0
      ? Math.round((scrubX / width) * (points.length - 1))
      : null;
  const scrubPoint = scrubIndex !== null ? points[scrubIndex] : null;

  return (
    <View style={styles.container}>
      <View
        style={styles.plot}
        onLayout={onLayout}
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Ten-year projection. Drag along the line to see any month."
      >
        {!touched ? (
          <View pointerEvents="none" style={styles.hint}>
            <Text style={styles.hintText}>Drag along the line</Text>
          </View>
        ) : null}

        {geometry ? (
          <Svg width={width} height={HEIGHT}>
            {/* Tight years: flat lichen bands, behind everything. */}
            {tightYears.map(year => {
              const x0 = geometry.xOfMonth((year - 1) * 12);
              const x1 = geometry.xOfMonth(year * 12);
              return (
                <Rect
                  key={`tight-${year}`}
                  x={x0}
                  y={PAD_TOP - 10}
                  width={Math.max(2, x1 - x0)}
                  height={HEIGHT - PAD_TOP - PAD_BOTTOM + 14}
                  fill={colors.warn}
                  opacity={0.1}
                />
              );
            })}

            {/* Ground line. */}
            <Line
              x1={0}
              y1={HEIGHT - PAD_BOTTOM + 4}
              x2={width}
              y2={HEIGHT - PAD_BOTTOM + 4}
              stroke={colors.rule}
              strokeWidth={line.hair}
            />

            {/* The plan. */}
            <Path
              d={geometry.path}
              stroke={lineColor}
              strokeWidth={line.plan}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Goals as stations on the line. */}
            {markers.map((marker, i) => {
              const index = geometry.monthToIndex.get(marker.month);
              const point = index !== undefined ? points[index] : undefined;
              if (index === undefined || !point) return null;
              const cx = geometry.x(index);
              const cy = geometry.y(point.value);
              const full = marker.dateStr ? `${marker.label}, ${marker.dateStr}` : marker.label;
              // A savings line rises left to right, so the clear space is below and to
              // the right of a stop. Near the right edge, flip to below-left. If two
              // stops are close, the second label drops a line.
              const prev = i > 0 ? markers[i - 1] : undefined;
              const prevIndex = prev ? geometry.monthToIndex.get(prev.month) : undefined;
              const crowded = prevIndex !== undefined && Math.abs(geometry.x(prevIndex) - cx) < 150;
              const ty = Math.min(HEIGHT - PAD_BOTTOM - 4, cy + (crowded ? 34 : 20));
              // Fit the label: right of the stop, else left of it, else drop the date
              // (the goal rows under the chart always show it). ~6.4px per character.
              const fits = (t: string, a: 'start' | 'end') =>
                a === 'start' ? cx + 8 + t.length * 6.4 <= width : cx - 8 - t.length * 6.4 >= 0;
              let text = full;
              let anchor: 'start' | 'end' = 'start';
              if (!fits(full, 'start')) {
                if (fits(full, 'end')) anchor = 'end';
                else {
                  text = marker.label;
                  anchor = fits(text, 'start') ? 'start' : 'end';
                }
              }
              return (
                <G key={`${marker.month}-${marker.label}`}>
                  <Circle
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={colors.bg}
                    stroke={marker.atRisk ? colors.error : colors.ink}
                    strokeWidth={line.path}
                  />
                  <SvgText
                    x={anchor === 'start' ? cx + 8 : cx - 8}
                    y={ty}
                    fill={marker.atRisk ? colors.error : colors.ink2}
                    fontSize={12}
                    fontFamily={fonts.textMedium}
                    textAnchor={anchor}
                  >
                    {text}
                  </SvgText>
                </G>
              );
            })}

            {/* Scrub cursor. */}
            {scrubX !== null && scrubPoint && scrubIndex !== null ? (
              <G>
                <Line
                  x1={geometry.x(scrubIndex)}
                  y1={PAD_TOP - 14}
                  x2={geometry.x(scrubIndex)}
                  y2={HEIGHT - PAD_BOTTOM + 4}
                  stroke={colors.ink2}
                  strokeWidth={line.hair}
                />
                <Circle
                  cx={geometry.x(scrubIndex)}
                  cy={geometry.y(scrubPoint.value)}
                  r={6}
                  fill={lineColor}
                  stroke={colors.bg}
                  strokeWidth={2}
                />
              </G>
            ) : null}
          </Svg>
        ) : (
          <View style={{ height: HEIGHT }} />
        )}
      </View>

      {startYear !== undefined ? (
        <View style={styles.axis}>
          <Text style={styles.axisLabel}>{startYear}</Text>
          <Text style={styles.axisLabel}>{startYear + 5}</Text>
          <Text style={styles.axisLabel}>{startYear + 10}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  plot: { height: HEIGHT, position: 'relative' },
  hint: { position: 'absolute', top: 0, right: 0, zIndex: 2 },
  hintText: { ...typeScale.caption, fontFamily: fonts.serifItalic, fontSize: 14, color: colors.ink2 },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: space.xs + 2,
  },
  axisLabel: { ...typeScale.caption, color: colors.ink2 },
});
