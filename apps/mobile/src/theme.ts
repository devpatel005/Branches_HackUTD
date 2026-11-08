/**
 * Design tokens — Branches "Field Guide at Dusk".
 *
 * The look comes from a Washington rainforest at night: deep spruce shadow,
 * moonlit mist, and seafoam line-work (leaf veins, river currents, the paths
 * that fork). Three rules keep it from turning into decoration:
 *   1. Flat colour only. No gradients anywhere. Depth comes from stacked flat
 *      layers (treelines) and opacity, the way a screen print does it.
 *   2. One accent (seafoam). It means "on track" and "the thing to press".
 *   3. Line-work is 1–1.5px and always means something: a plan, a path, a goal.
 *
 * Every colour below passes WCAG AA on `bg`, `surface` and `band` (checked:
 * ink 15:1, ink2 8:1, accent 11.7:1, warn 10.5:1, error 6.9:1, members 8.7:1+).
 * Dark only — there is no light theme.
 */
export const colors = {
  // Ground — the forest floor at night.
  bg: '#0D1C1C', //          night spruce: app background
  surface: '#132826', //     canopy: sheets, branch cards
  band: '#173230', //        title band (field-guide header strip)
  surfaceRaised: '#1A3633', // selected card, inputs
  surfaceHover: '#1F3D3A', //  press state
  rule: '#27403D', //        1px hairline
  ruleStrong: '#35524E', //  rules that carry meaning (timeline spine)

  // Ink — moonlight and mist.
  ink: '#E9EFE8', //         moon: numbers, titles
  ink2: '#9FB5AC', //        mist: labels, captions
  ink3: '#6E8780', //        deep mist: placeholders, decoration only

  // The one accent — seafoam line-work. Good / primary / the committed plan.
  accent: '#8FE3C8',
  onAccent: '#0D1C1C',

  // Meaning only.
  warn: '#E8C46A', //        lichen gold: tight years only
  warnBand: 'rgba(232, 196, 106, 0.08)', // flat lichen wash behind a tight year
  error: '#F2846A', //       salmonberry: at risk, shortfalls, "over"

  // People. Never used for anything but who.
  memberA: '#86BDEB', //     glacier melt (Maya)
  memberB: '#EBA6BE', //     salal flower (Jordan)
  agent: '#C9D6CF', //       the assistant: neutral mist, never a person colour

  // Illustration layers (flat fills used only by src/forest.tsx).
  treeFar: '#16302E',
  treeMid: '#112624',
  treeNear: '#0A1717',
  moon: '#E9EFE8',

  // Aliases so screens written against the old token names keep compiling.
  hairline: '#27403D',
  hairlineSubtle: '#1A3633',
  textPrimary: '#E9EFE8',
  textSecondary: '#9FB5AC',
  textMuted: '#6E8780',
  ink2Legacy: '#9FB5AC',
  cedar: '#8FE3C8',
  firMoss: '#8FE3C8',
  success: '#8FE3C8',
  lichen: '#E8C46A',
  caution: '#E8C46A',
  madrona: '#F2846A',
  negative: '#F2846A',
  maya: '#86BDEB',
  jordan: '#EBA6BE',
} as const;

/**
 * Font families. On native, a custom font's weight is chosen by family name,
 * not by `fontWeight`, so every style names the exact face it wants.
 * Loaded once in app/_layout.tsx.
 */
export const fonts = {
  numeral: 'Newsreader_500Medium',
  numeralBold: 'Newsreader_600SemiBold',
  serif: 'Newsreader_400Regular',
  serifItalic: 'Newsreader_400Regular_Italic',
  text: 'SchibstedGrotesk_400Regular',
  textMedium: 'SchibstedGrotesk_500Medium',
  textSemi: 'SchibstedGrotesk_600SemiBold',
} as const;

/** 4px base. Vertical rhythm deliberately varies: 24 / 32 / 48 / 72. */
export const space = {
  sidePadding: 20,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  hero: 72,
  // legacy names
  rhythm24: 24,
  rhythm32: 32,
  rhythm48: 48,
  rhythm72: 72,
} as const;

/** One radius for everything rectangular. Circles are circles by geometry. */
export const radius = 6 as const;

/** Line-work: the paths, the chart, the leaf veins. */
export const line = {
  hair: 1,
  path: 1.5,
  plan: 2,
  /** Transit-map bends: radius about 8x the stroke reads as a soft river bend. */
  bend: 12,
  /** Gap between parallel paths: one stroke width plus air. */
  parallelGap: 5,
} as const;

export const type = {
  heroDollars: { fontFamily: fonts.numeral, fontSize: 64, lineHeight: 68, letterSpacing: -1.5 },
  heroCents: { fontFamily: fonts.numeral, fontSize: 26, lineHeight: 30 },
  display: { fontFamily: fonts.numeral, fontSize: 48, lineHeight: 52, letterSpacing: -1 },
  title: { fontFamily: fonts.numeral, fontSize: 30, lineHeight: 36, letterSpacing: -0.4 },
  headline: { fontFamily: fonts.textSemi, fontSize: 18, lineHeight: 24 },
  numeral: { fontFamily: fonts.numeral, fontSize: 20, lineHeight: 24 },
  body: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24 },
  bodyItalic: { fontFamily: fonts.serifItalic, fontSize: 17, lineHeight: 25 },
  label: { fontFamily: fonts.textMedium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 18 },
  /** Field-guide plate numbers ("No. 1") — tiny, the only tracked text. */
  plate: { fontFamily: fonts.textMedium, fontSize: 11, lineHeight: 14, letterSpacing: 1.2 },
} as const;

/** Numbers use tabular lining figures so they don't jitter while rolling. */
export const tabularNums = { fontVariant: ['tabular-nums' as const, 'lining-nums' as const] };

/** Borders-only elevation: no shadows, no glow. */
export const borderElevation = {
  borderWidth: 1,
  borderColor: colors.rule,
} as const;

export const motion = {
  fast: 150,
  base: 250,
  slow: 600,
} as const;

/** Breakpoints (10 Screens: phone first; real two-column layout on laptops). */
export const breakpoints = { tablet: 600, laptop: 960 } as const;

/**
 * Branches is a phone app. On web it renders as a phone-width column
 * (10 Screens: centred, ~480px); only the live session widens on a laptop so
 * the three branch cards can sit side by side (Stage 8).
 */
export const COLUMN_MAX_WIDTH = 480;
export const WEB_MAX_WIDTH = 1120;
