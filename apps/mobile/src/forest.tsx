import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { colors, line } from './theme';

/**
 * The illustration layer — "Field Guide at Dusk".
 *
 * Everything here is drawn in code with react-native-svg (works in Expo Go and
 * on web) from a fixed seed, so it renders identically every time and costs no
 * image assets. Flat fills and strokes only: no gradients, no blur, no glow.
 *
 *   ForestCanopy  layered flat treelines, a moon, river currents: the header art
 *   FernLeaf      a line-art leaf with veins, like a field-guide specimen plate
 *   BranchPaths   transit-map paths that fork into lanes: the product's signature
 */

// ---------------------------------------------------------------------------
// Deterministic randomness (a fixed seed means the forest never "jumps").
// ---------------------------------------------------------------------------

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

/** One tiered spruce, as polygon points, standing on `base`. */
function spruce(x: number, base: number, h: number, w: number): string {
  const left = [
    [x - 0.5 * w, base],
    [x - 0.17 * w, base - 0.3 * h],
    [x - 0.38 * w, base - 0.27 * h],
    [x - 0.11 * w, base - 0.57 * h],
    [x - 0.25 * w, base - 0.54 * h],
    [x, base - h],
  ];
  const right = left
    .slice(0, -1)
    .reverse()
    .map(([px, py]) => [2 * x - px!, py!]);
  return [...left, ...right].map(([px, py]) => `${f(px!)},${f(py!)}`).join(' L');
}

/**
 * A whole treeline that follows rolling terrain: the ground rises and falls on
 * two slow waves, trees cluster and thin out, and the odd gap opens. Closed down
 * to `bottom`. Deterministic for a given seed.
 */
function treeline(
  width: number,
  base: number,
  bottom: number,
  minH: number,
  maxH: number,
  spacing: number,
  seed: number,
  ridge = 8
): string {
  const rand = seeded(seed);
  const p1 = rand() * 6.28;
  const p2 = rand() * 6.28;
  const ground = (x: number) =>
    base + ridge * Math.sin(x / (width * 0.23) + p1) + ridge * 0.5 * Math.sin(x / (width * 0.09) + p2);
  // Density drifts slowly too, so stands of tall trees alternate with thin patches.
  const stand = (x: number) => 0.55 + 0.45 * Math.sin(x / (width * 0.13) + p2 * 1.7);

  let d = `M0,${f(bottom)} L0,${f(ground(0))}`;
  let x = -spacing / 2;
  while (x < width + spacing) {
    const g = ground(x);
    if (rand() > 0.12) {
      const h = (minH + rand() * (maxH - minH)) * (0.6 + 0.5 * stand(x));
      const w = h * (0.36 + rand() * 0.16);
      d += ` L${spruce(x, g, h, w)}`;
    } else {
      d += ` L${f(x)},${f(g)}`;
    }
    x += spacing * (0.55 + rand() * 0.9);
  }
  d += ` L${f(width)},${f(ground(width))} L${f(width)},${f(bottom)} Z`;
  return d;
}

/** A gentle river current: a long sine-ish line made of smooth curves. */
function current(width: number, y: number, amp: number, wave: number, phase: number): string {
  let d = `M${f(-wave - phase)},${f(y)}`;
  for (let x = -wave - phase; x < width + wave; x += wave) {
    d += ` q${f(wave / 4)},${f(-amp)} ${f(wave / 2)},0 t${f(wave / 2)},0`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// ForestCanopy — the header art. Content (names, links) sits on top of it.
// ---------------------------------------------------------------------------

export function ForestCanopy({
  height = 168,
  children,
  style,
  seed = 7,
}: {
  height?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  seed?: number;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const far = height * 0.66;
  const mid = height * 0.8;
  const near = height * 0.93;
  // The moon sits below the header's text row so it never runs under a link.
  const moonX = width * (width < 600 ? 0.66 : 0.78);
  const moonY = height * 0.5;

  return (
    <View
      style={[styles.canopy, { height }, style]}
      onLayout={onLayout}
      aria-hidden
    >
      {width > 0 ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          {/* Sky is the band colour behind this view. The moon: a flat disc and two
              thin rings (the same ring language as the ready check). */}
          <Circle cx={moonX} cy={moonY} r={14} fill={colors.moon} opacity={0.92} />
          <Circle cx={moonX} cy={moonY} r={23} stroke={colors.accent} strokeWidth={line.hair} fill="none" opacity={0.22} />
          <Circle cx={moonX} cy={moonY} r={33} stroke={colors.accent} strokeWidth={line.hair} fill="none" opacity={0.1} />

          {/* Flat treelines, back to front: far is mistiest (lightest), near is the
              page colour, so the illustration flows straight into the screen. A flat
              band of mist (opacity, never a gradient) sits between far and mid. */}
          <Path d={treeline(width, far, height, 16, 40, 13, seed, 10)} fill={colors.treeFar} />
          <Rect x={0} y={far + 4} width={width} height={height - far} fill={colors.band} opacity={0.55} />
          <Path d={treeline(width, mid, height, 22, 58, 19, seed + 11, 7)} fill={colors.treeMid} />
          <Path d={treeline(width, near, height, 14, 70, 31, seed + 23, 4)} fill={colors.bg} />
          {/* Two tall framing spruces at the edges, like the trees that frame a view. */}
          <Path d={`M${f(width * 0.03)},${f(height)} L${spruce(width * 0.03, height, height * 0.9, height * 0.34)} Z`} fill={colors.bg} />
          <Path d={`M${f(width * 0.97)},${f(height)} L${spruce(width * 0.97, height, height * 0.78, height * 0.3)} Z`} fill={colors.bg} />

          {/* River currents across the foot of the forest. */}
          <Path d={current(width, height - 7, 2.2, 46, 0)} stroke={colors.accent} strokeWidth={line.hair} fill="none" opacity={0.28} />
          <Path d={current(width, height - 2, 1.6, 62, 17)} stroke={colors.accent} strokeWidth={line.hair} fill="none" opacity={0.14} />

          {/* A specimen leaf breaking in from the left edge (the one grid break). */}
          <FernLeafPaths x={-34} y={height * 1.02} length={Math.min(230, width * 0.42)} angle={-28} opacity={0.55} veins={22} />
        </Svg>
      ) : null}
      <View style={styles.canopyContent}>{children}</View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// FernLeaf — line-art leaf: outline, midrib and parallel veins.
// ---------------------------------------------------------------------------

type Pt = [number, number];
const quad = (a: Pt, c: Pt, b: Pt, t: number): Pt => [
  (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
  (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
];

/** Raw SVG group, for use inside another <Svg>. */
export function FernLeafPaths({
  x,
  y,
  length,
  angle,
  opacity = 0.5,
  color = colors.accent,
  veins = 16,
}: {
  x: number;
  y: number;
  length: number;
  angle: number;
  opacity?: number;
  color?: string;
  veins?: number;
}) {
  const L = length;
  const base: Pt = [0, 0];
  const tip: Pt = [L, 0];
  const rib: Pt = [L * 0.5, -L * 0.06];
  const top: Pt = [L * 0.42, -L * 0.24];
  const bottom: Pt = [L * 0.42, L * 0.18];

  let d = `M0,0 Q${f(top[0])},${f(top[1])} ${f(L)},0 Q${f(bottom[0])},${f(bottom[1])} 0,0`;
  d += ` M0,0 Q${f(rib[0])},${f(rib[1])} ${f(L)},0`;
  for (let i = 1; i <= veins; i++) {
    const t = i / (veins + 1);
    const m = quad(base, rib, tip, t);
    const t2 = Math.min(1, t + 0.09);
    const u = quad(base, top, tip, t2);
    const v = quad(base, bottom, tip, t2);
    d += ` M${f(m[0])},${f(m[1])} L${f(u[0])},${f(u[1])}`;
    d += ` M${f(m[0])},${f(m[1])} L${f(v[0])},${f(v[1])}`;
  }
  // a short stem
  d += ` M0,0 L${f(-L * 0.12)},${f(L * 0.03)}`;

  return (
    <G transform={`translate(${f(x)} ${f(y)}) rotate(${angle})`} opacity={opacity}>
      <Path d={d} stroke={color} strokeWidth={0.8} fill="none" strokeLinecap="round" />
    </G>
  );
}

/** A leaf on its own, sized by its box. Decorative: hidden from screen readers. */
export function FernLeaf({
  size = 96,
  angle = -30,
  opacity = 0.45,
  style,
}: {
  size?: number;
  angle?: number;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      pointerEvents="none"
      style={[{ width: size, height: size }, style]}
      aria-hidden
    >
      <Svg width={size} height={size}>
        {/* Centre the leaf in its box whatever the angle, so it is never clipped
            by its own canvas, only by whatever edge it is placed against. */}
        <FernLeafPaths
          x={size / 2 - (Math.cos((angle * Math.PI) / 180) * size * 0.86) / 2}
          y={size / 2 - (Math.sin((angle * Math.PI) / 180) * size * 0.86) / 2}
          length={size * 0.86}
          angle={angle}
          opacity={opacity}
        />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// BranchPaths — the signature. One path comes in, forks into lanes with
// transit-map bends (radius = line.bend), each lane ending at a station ring.
// ---------------------------------------------------------------------------

export type Lane = {
  /** Lane colour: a member's colour when they picked it, accent when both did. */
  color: string;
  /** Draw the station filled (the chosen lane). */
  chosen?: boolean;
};

export function BranchPaths({
  lanes,
  height = 76,
  trunkColor = colors.accent,
  merged = false,
}: {
  lanes: readonly Lane[];
  height?: number;
  trunkColor?: string;
  /** After commit: every lane folds back into one path. */
  merged?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const n = Math.max(1, lanes.length);
  const r = line.bend;
  const yMid = height / 2;
  const spread = Math.min((height - 16) / Math.max(1, n - 1), 26);
  const forkX = Math.min(96, width * 0.22);
  const endX = width - 10;

  const laneY = (i: number) => (merged ? yMid : yMid + (i - (n - 1) / 2) * spread);

  const path = (y: number) => {
    if (Math.abs(y - yMid) < 0.5) return `M${f(forkX - r)},${f(yMid)} H${f(endX)}`;
    const dir = y > yMid ? 1 : -1;
    return [
      `M${f(forkX - r)},${f(yMid)}`,
      `H${f(forkX - r)}`,
      `Q${f(forkX)},${f(yMid)} ${f(forkX)},${f(yMid + dir * r)}`,
      `V${f(y - dir * r)}`,
      `Q${f(forkX)},${f(y)} ${f(forkX + r)},${f(y)}`,
      `H${f(endX)}`,
    ].join(' ');
  };

  return (
    <View
      style={{ height }}
      onLayout={e => setWidth(Math.round(e.nativeEvent.layout.width))}
      aria-hidden
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {lanes.map((lane, i) => (
            <G key={i}>
              <Path
                d={path(laneY(i))}
                stroke={lane.color}
                strokeWidth={lane.chosen ? line.plan : line.path}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={lane.chosen ? 1 : 0.75}
              />
              <Circle
                cx={endX}
                cy={laneY(i)}
                r={5}
                fill={lane.chosen ? lane.color : colors.bg}
                stroke={lane.color}
                strokeWidth={line.path}
              />
            </G>
          ))}
          {/* The shared trunk, drawn last so no single lane's colour claims it. */}
          <Path d={`M0,${f(yMid)} H${f(forkX - r + 1)}`} stroke={trunkColor} strokeWidth={line.plan} fill="none" />
        </Svg>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Station — a transit-map stop marker as a plain View (cheap in long lists).
// ---------------------------------------------------------------------------

export function Station({ color, filled, size = 11 }: { color: string; filled?: boolean; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: line.path,
        borderColor: color,
        backgroundColor: filled ? color : colors.bg,
      }}
    />
  );
}

const styles = StyleSheet.create({
  canopy: {
    backgroundColor: colors.band,
    overflow: 'hidden',
    position: 'relative',
  },
  canopyContent: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
  },
});
