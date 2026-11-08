/**
 * Display formatting. Tables store integer cents (05 Data Model), so the UI
 * converts at the edge and never does arithmetic on money itself — every number
 * shown originates in the engine (02 Ground Rules #1).
 */

export function dollars(cents: number, options?: { showCents?: boolean }): string {
  const value = cents / 100;
  const showCents = options?.showCents ?? Math.abs(cents) % 100 !== 0;
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
}

/** `$1,200/mo`, for a recurring amount. */
export function perMonth(cents: number): string {
  return `${dollars(cents)}/mo`;
}

/** Human group headings for inferred-item kinds (10 Screens#Onboarding). */
export const KIND_LABELS: Record<string, string> = {
  income: 'Income',
  fixed: 'Bills',
  debt: 'Loans',
  retirement: 'Set aside',
  external_account: 'Other accounts',
  flexible: 'Everyday spending',
};

/** The order groups appear in, matching the engine's documented sort. */
export const KIND_ORDER = [
  'income',
  'fixed',
  'debt',
  'retirement',
  'external_account',
  'flexible',
] as const;
