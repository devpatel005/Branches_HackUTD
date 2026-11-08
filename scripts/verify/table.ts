/**
 * The one table renderer every verification script uses, so every area prints
 * the same shape (12 Verification#How verification works):
 *
 *   ID · description · expected · actual · PASS/FAIL, then a summary line.
 *
 * Money comparisons are exact to the cent; lists compare exactly, order included.
 */
export type Check = {
  id: string;
  description: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
};

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** Stable, order-sensitive formatting so diffs are readable and deterministic. */
export function fmt(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '(none)';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (Array.isArray(value)) return `[${value.map(fmt).join(', ')}]`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Exact comparison, including array order. */
export function eq(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/** Build a check by comparing exactly. */
export function check(id: string, description: string, actual: unknown, expected: unknown): Check {
  return { id, description, expected, actual, pass: eq(actual, expected) };
}

export function printTable(title: string, checks: Check[]): boolean {
  const rows = checks.map(c => ({
    id: c.id,
    description: c.description,
    expected: fmt(c.expected),
    actual: fmt(c.actual),
    status: c.pass ? 'PASS' : 'FAIL',
    pass: c.pass,
  }));

  const headers = { id: 'ID', description: 'DESCRIPTION', expected: 'EXPECTED', actual: 'ACTUAL', status: 'RESULT' };
  const widths = {
    id: Math.max(headers.id.length, ...rows.map(r => r.id.length)),
    description: Math.max(headers.description.length, ...rows.map(r => r.description.length)),
    expected: Math.max(headers.expected.length, ...rows.map(r => r.expected.length)),
    actual: Math.max(headers.actual.length, ...rows.map(r => r.actual.length)),
    status: headers.status.length,
  };
  const pad = (s: string, w: number) => s.padEnd(w);

  console.log(`\n${BOLD}${title}${RESET}`);
  console.log(
    `${DIM}${pad(headers.id, widths.id)}  ${pad(headers.description, widths.description)}  ` +
      `${pad(headers.expected, widths.expected)}  ${pad(headers.actual, widths.actual)}  ${headers.status}${RESET}`
  );
  console.log(
    `${DIM}${'-'.repeat(widths.id)}  ${'-'.repeat(widths.description)}  ` +
      `${'-'.repeat(widths.expected)}  ${'-'.repeat(widths.actual)}  ${'-'.repeat(widths.status)}${RESET}`
  );

  for (const r of rows) {
    const colour = r.pass ? GREEN : RED;
    console.log(
      `${pad(r.id, widths.id)}  ${pad(r.description, widths.description)}  ` +
        `${pad(r.expected, widths.expected)}  ${pad(r.actual, widths.actual)}  ${colour}${r.status}${RESET}`
    );
  }

  const failed = rows.filter(r => !r.pass).length;
  const summary =
    failed === 0
      ? `${GREEN}${rows.length}/${rows.length} passed${RESET}`
      : `${RED}${rows.length - failed}/${rows.length} passed — ${failed} FAILED${RESET}`;
  console.log(`\n${summary}\n`);
  return failed === 0;
}
