/**
 * Design tokens from 09 Design System. Dark only — there is no light theme.
 * Partner colours were picked so they never collide with the green/red
 * good/at-risk meanings. Final values are OPEN(OD-14).
 */
export const colors = {
  bg: '#000000',
  surface: '#121212',
  surfaceRaised: '#1C1C1E',
  hairline: '#2C2C2E',
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  accent: '#00C805',
  negative: '#FF5000',
  caution: '#FFB800',
  memberA: '#4DA8FF',
  memberB: '#B18CFF',
  agent: '#E5E5EA',
} as const;

/** 8-point grid; 20px side padding (09 Design System#Layout). */
export const space = {
  sidePadding: 20,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const type = {
  display: { fontSize: 44, fontWeight: '700' },
  title: { fontSize: 28, fontWeight: '700' },
  headline: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '500' },
} as const;

/** Numbers use tabular figures so they don't jitter while rolling. */
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

/** Web renders in a centred column (10 Screens). */
export const WEB_MAX_WIDTH = 480;
