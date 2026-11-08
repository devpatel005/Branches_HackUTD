import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { colors } from './theme';

/**
 * The projection chart — 09 Design System#Signature components.
 *
 * One line, no gridlines, no axes, scrubbable with a finger. The line plots
 * **total savings**: the emergency fund plus every unsettled goal balance, so
 * it rises as money accumulates and visibly drops when a goal is paid for.
 * That drop is why the goal markers mean something.
 *
 * Line colour carries one meaning only: accent when every goal is funded,
 * negative when any goal is at risk.
 *
 * Drawn with `react-native-svg`, which works in Expo Go and on web
 * (04 Architecture), and scrubbed with `PanResponder` so no gesture library is
 * needed. There is no animation here: Stage 8 owns motion.
 */

export type ChartPoint = { month: number; value: number };
export type ChartMarker = { month: number; label: string; atRisk: boolean };

const HEIGHT = 180;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 12;

export function ProjectionChart({
  points,
  markers = [],
  atRisk = false,
  floor,
  onScrub,
}: {
  points: readonly ChartPoint[];
  markers?: readonly ChartMarker[];
  atRisk?: boolean;
  /** The emergency-fund floor, drawn as a faint reference line when in range. */
  floor?: number;
  /** Called with the scrubbed point, and with null on release. */
  onScrub?: (point: ChartPoint | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const [scrubX, setScrubX] = useState<number | null>(null);
  const widthRef = useRef(0);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const lineColor = atRisk ? colors.negative : colors.accent;

  const geometry = useMemo(() => {
    if (points.length < 2 || width <= 0) return null;

    const values = points.map(p => p.value);
    const rawMin = Math.min(...values, floor ?? Number.POSITIVE_INFINITY);
    const rawMax = Math.max(...values);
    // A flat line would divide by zero; give it a nominal band instead.
    const span = rawMax - rawMin || Math.max(1, Math.abs(rawMax) * 0.1);
    const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

    const x = (index: number) => (index / (points.length - 1)) * width;
    const y = (value: number) => PADDING_TOP + (1 - (value - rawMin) / span) * plotHeight;

    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`)
      .join(' ');

    const monthToIndex = new Map(points.map((p, i) => [p.month, i]));

    return { path, x, y, monthToIndex, floorY: floor !== undefined ? y(floor) : null };
  }, [points, width, floor]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => handleScrub(event.nativeEvent.locationX),
        onPanResponderMove: event => handleScrub(event.nativeEvent.locationX),
        onPanResponderRelease: () => {
          setScrubX(null);
          onScrub?.(null);
        },
        onPanResponderTerminate: () => {
          setScrubX(null);
          onScrub?.(null);
        },
      }),
    [onScrub]
  );

  function handleScrub(locationX: number) {
    const list = pointsRef.current;
    const w = widthRef.current;
    if (list.length < 2 || w <= 0) return;
    const clamped = Math.max(0, Math.min(w, locationX));
    const index = Math.round((clamped / w) * (list.length - 1));
    const point = list[index];
    if (!point) return;
    setScrubX(clamped);
    onScrub?.(point);
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
    <View style={styles.wrapper} onLayout={onLayout} {...panResponder.panHandlers}>
      {geometry ? (
        <Svg width={width} height={HEIGHT}>
          {geometry.floorY !== null ? (
            <Line
              x1={0}
              y1={geometry.floorY}
              x2={width}
              y2={geometry.floorY}
              stroke={colors.hairline}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ) : null}

          <Path d={geometry.path} stroke={lineColor} strokeWidth={2} fill="none" />

          {markers.map(marker => {
            const index = geometry.monthToIndex.get(marker.month);
            if (index === undefined) return null;
            const point = points[index];
            if (!point) return null;
            return (
              <Circle
                key={`${marker.month}-${marker.label}`}
                cx={geometry.x(index)}
                cy={geometry.y(point.value)}
                r={4}
                fill={marker.atRisk ? colors.negative : colors.accent}
                stroke={colors.bg}
                strokeWidth={2}
              />
            );
          })}

          {scrubX !== null && scrubPoint ? (
            <>
              <Line
                x1={scrubX}
                y1={0}
                x2={scrubX}
                y2={HEIGHT}
                stroke={colors.textSecondary}
                strokeWidth={1}
              />
              <Circle
                cx={geometry.x(scrubIndex!)}
                cy={geometry.y(scrubPoint.value)}
                r={5}
                fill={lineColor}
                stroke={colors.bg}
                strokeWidth={2}
              />
            </>
          ) : null}
        </Svg>
      ) : (
        <View style={{ height: HEIGHT }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { height: HEIGHT, justifyContent: 'center' },
});
