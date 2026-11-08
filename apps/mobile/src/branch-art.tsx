import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Circle, G, Path } from 'react-native-svg';
import { colors } from './theme';

/**
 * Branch art: the plan drawn as a living branch instead of a line.
 *
 * Shared by the Home chart and the session's paths. Everything is a flat fill
 * or a thin line in the app's palette (no gradients), drawn from a fixed seed
 * so it is identical on every render.
 */

export const BARK = {
  mid: '#6E4632',
  dark: '#5E3B2A',
  knot: '#4E3223',
  lit: '#8C5B3E',
  grain: '#3E281C',
  leaf: '#2E6B3D',
  leafVein: '#46904F',
  petal: colors.accent,
  petalInner: '#C4F1E1',
  petalVein: '#5FC4A4',
  center: colors.warn,
  stamen: '#F6ECE0',
  wilt: colors.error,
  wiltDark: '#C9614A',
};

export type Pt = [number, number];
const f = (n: number) => n.toFixed(1);

/** Points along a cubic Bézier. */
export function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Unit normal at each point of a polyline (pointing "up" for a rightward line). */
function normals(spine: readonly Pt[]): Pt[] {
  return spine.map((_, i) => {
    const a = spine[Math.max(0, i - 1)]!;
    const b = spine[Math.min(spine.length - 1, i + 1)]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [dy / len, -dx / len];
  });
}

/**
 * A tapered bark branch along a spine: the filled body, a sunlit upper edge,
 * and short grain strokes. `w0`/`w1` are the half-widths at the start and end.
 */
export function barkPaths(spine: readonly Pt[], w0: number, w1: number) {
  if (spine.length < 2) return { body: '', lit: '', grain: '' };
  const nm = normals(spine);
  const hw = (i: number) => w0 + (w1 - w0) * (i / (spine.length - 1));
  const upper = spine.map((p, i) => [p[0] + nm[i]![0] * hw(i), p[1] + nm[i]![1] * hw(i)] as Pt);
  const lower = spine.map((p, i) => [p[0] - nm[i]![0] * hw(i), p[1] - nm[i]![1] * hw(i)] as Pt);
  const body =
    `M${upper.map(p => `${f(p[0])},${f(p[1])}`).join(' L')}` +
    ` L${[...lower].reverse().map(p => `${f(p[0])},${f(p[1])}`).join(' L')} Z`;
  const lit = `M${spine
    .map((p, i) => `${f(p[0] + nm[i]![0] * hw(i) * 0.55)},${f(p[1] + nm[i]![1] * hw(i) * 0.55)}`)
    .join(' L')}`;
  let grain = '';
  for (let i = 2; i < spine.length - 2; i += 4) {
    const k = i % 8 === 2 ? -0.3 : 0.25;
    const a = spine[i]!;
    const b = spine[Math.min(spine.length - 1, i + 2)]!;
    grain += ` M${f(a[0] + nm[i]![0] * hw(i) * k)},${f(a[1] + nm[i]![1] * hw(i) * k)} L${f(b[0] + nm[i]![0] * hw(i) * k)},${f(b[1] + nm[i]![1] * hw(i) * k)}`;
  }
  return { body, lit, grain };
}

export function BarkBranch({
  spine,
  w0,
  w1,
  fill = BARK.mid,
  topLine,
}: {
  spine: readonly Pt[];
  w0: number;
  w1: number;
  fill?: string;
  /** A thin coloured line along the top edge: whose pick this branch is. */
  topLine?: string;
}) {
  const p = barkPaths(spine, w0, w1);
  if (!p.body) return null;
  return (
    <G>
      <Path d={p.body} fill={fill} />
      <Path d={p.lit} stroke={topLine ?? BARK.lit} strokeWidth={topLine ? 2 : 1.4} fill="none" strokeLinecap="round" />
      <Path d={p.grain} stroke={BARK.grain} strokeWidth={0.8} fill="none" opacity={0.75} strokeLinecap="round" />
    </G>
  );
}

/** One leaf: a pointed oval with a lighter midrib. Base at (0,0), pointing +x. */
export function Leaf({ x, y, angle, scale = 1 }: { x: number; y: number; angle: number; scale?: number }) {
  return (
    <G transform={`translate(${f(x)} ${f(y)}) rotate(${f(angle)}) scale(${scale})`}>
      <Path d="M0 0 C 4 -6, 12 -7, 16 -2 C 11 2, 4 3, 0 0 Z" fill={BARK.leaf} />
      <Path d="M0 0 C 6 -2, 11 -3, 16 -2" stroke={BARK.leafVein} strokeWidth={0.8} fill="none" />
    </G>
  );
}

/** A twig sprouting from (x,y) in direction `dir` (1 up-right, -1 up-left), with leaves. */
export function Twig({ x, y, dir = 1, size = 1 }: { x: number; y: number; dir?: 1 | -1; size?: number }) {
  const s = size;
  const ex = x + dir * 14 * s;
  const ey = y - 20 * s;
  return (
    <G>
      <Path
        d={`M${f(x)},${f(y)} C${f(x + dir * 2 * s)},${f(y - 10 * s)} ${f(x + dir * 7 * s)},${f(y - 16 * s)} ${f(ex)},${f(ey)}`}
        stroke={BARK.mid}
        strokeWidth={2.4 * s}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d={`M${f(x + dir * 5 * s)},${f(y - 12 * s)} C${f(x + dir * 1 * s)},${f(y - 16 * s)} ${f(x - dir * 4 * s)},${f(y - 17 * s)} ${f(x - dir * 8 * s)},${f(y - 17 * s)}`}
        stroke={BARK.mid}
        strokeWidth={1.3 * s}
        fill="none"
        strokeLinecap="round"
      />
      <Leaf x={ex} y={ey} angle={dir > 0 ? -38 : -142} scale={0.85 * s} />
      <Leaf x={x - dir * 8 * s} y={y - 17 * s} angle={dir > 0 ? -165 : -15} scale={0.65 * s} />
      <Leaf x={ex - dir * 3 * s} y={ey + 3 * s} angle={dir > 0 ? -100 : -80} scale={0.55 * s} />
    </G>
  );
}

/**
 * A flower on a small stem: five teardrop petals, each with a paler inner
 * petal and a vein, a lichen centre ringed with stamens. `open` (0–1) scales
 * it up as it blooms. A wilted flower droops, closes and turns salmonberry.
 */
export function Flower({
  x,
  y,
  size = 1,
  open = 1,
  wilted = false,
}: {
  x: number;
  y: number;
  size?: number;
  open?: number;
  wilted?: boolean;
}) {
  if (open <= 0.01) return null;
  const s = size * (0.35 + 0.65 * open);
  if (wilted) {
    return (
      <G transform={`translate(${f(x)} ${f(y)})`}>
        <Path d={`M0,0 C 1,4 0,7 -3,9`} stroke={BARK.dark} strokeWidth={1.2} fill="none" strokeLinecap="round" />
        <G transform={`translate(-3 10) scale(${f(s)}) rotate(20)`}>
          {[-50, -10, 30].map(a => (
            <Path key={a} d="M0 0 C -3 3, -2 9, 0 11 C 2 9, 3 3, 0 0 Z" fill={BARK.wilt} transform={`rotate(${a})`} />
          ))}
          <Path d="M0 0 C 1 3, 1 7, 0 10" stroke={BARK.wiltDark} strokeWidth={0.7} fill="none" />
          <Circle r={2} fill={BARK.knot} />
        </G>
      </G>
    );
  }
  const petals = [0, 72, 144, 216, 288];
  return (
    <G transform={`translate(${f(x)} ${f(y)})`}>
      <Path d={`M0,0 L0,-6`} stroke={BARK.leafVein} strokeWidth={1.1} strokeLinecap="round" />
      <Leaf x={0} y={-3} angle={-20} scale={0.35} />
      <G transform={`translate(0 -11) scale(${f(s)}) rotate(${f(-18 + 18 * open)})`}>
        {petals.map(a => (
          <G key={a} transform={`rotate(${a})`}>
            <Path d="M0 0 C -4.5 -3, -4 -9, 0 -11 C 4 -9, 4.5 -3, 0 0 Z" fill={BARK.petal} />
            <Path d="M0 -1.5 C -2.2 -3.4, -2 -7, 0 -8.2 C 2 -7, 2.2 -3.4, 0 -1.5 Z" fill={BARK.petalInner} opacity={0.55} />
            <Path d="M0 -1 L0 -9" stroke={BARK.petalVein} strokeWidth={0.6} />
          </G>
        ))}
        <Circle r={3.2} fill={BARK.center} />
        {petals.map(a => (
          <Circle key={`s${a}`} r={0.75} cx={Math.sin(((a + 36) * Math.PI) / 180) * 2.1} cy={-Math.cos(((a + 36) * Math.PI) / 180) * 2.1} fill={BARK.stamen} />
        ))}
        <Circle r={1} cx={-0.6} cy={-0.6} fill={BARK.stamen} opacity={0.9} />
      </G>
    </G>
  );
}

/**
 * Growth animation. Returns a progress value (0–1) per key. A key restarts
 * from `from` whenever its token changes; new keys start from 0. Lanes start
 * a little after each other so the branches fan out rather than appear.
 * Respects the system "reduce motion" setting: everything is simply grown.
 */
export function useGrowth(tokens: readonly string[], duration = 750, stagger = 130) {
  const [progress, setProgress] = useState<number[]>(() => tokens.map(() => 0));
  const starts = useRef<number[]>([]);
  const froms = useRef<number[]>([]);
  const prev = useRef<string[]>([]);
  const frame = useRef<number | null>(null);
  const reduce = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => {
        reduce.current = v;
      })
      .catch(() => undefined);
  }, []);

  const key = tokens.join('|');
  useEffect(() => {
    const now = Date.now();
    const old = prev.current;
    const lengthChanged = old.length !== tokens.length;
    tokens.forEach((t, i) => {
      if (lengthChanged || old[i] === undefined) {
        starts.current[i] = now + i * stagger;
        froms.current[i] = 0;
      } else if (old[i] !== t) {
        starts.current[i] = now;
        froms.current[i] = 0.25;
      }
    });
    starts.current.length = tokens.length;
    froms.current.length = tokens.length;
    prev.current = [...tokens];

    if (reduce.current) {
      setProgress(tokens.map(() => 1));
      return;
    }
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = () => {
      const t = Date.now();
      let running = false;
      const next = tokens.map((_, i) => {
        const raw = (t - (starts.current[i] ?? t)) / duration;
        if (raw < 1) running = true;
        const from = froms.current[i] ?? 0;
        return raw <= 0 ? from : from + (1 - from) * ease(Math.min(1, raw));
      });
      setProgress(next);
      if (running) frame.current = requestAnimationFrame(tick);
    };
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return tokens.map((_, i) => progress[i] ?? 0);
}
