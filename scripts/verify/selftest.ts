/**
 * Proves the harness itself reports failure (Stage 0 "Done when": the verify
 * runner prints a table and exits non-zero on a deliberately failing check).
 *
 * This script is SUPPOSED to exit 1. run-all.ts runs it with an inverted
 * expectation — if it ever exits 0, the harness has stopped detecting failures
 * and every other suite's PASS becomes meaningless.
 */
import { check, finish, printTable, type Check } from './table.ts';

const checks: Check[] = [
  check('X1', 'a check that genuinely passes', 2 + 2, 4),
  check('X2', 'DELIBERATE FAILURE — the harness must report this', 2 + 2, 5),
  check('X3', 'list comparison is order-sensitive', [1, 2, 3], [1, 2, 3]),
  check('X4', 'DELIBERATE FAILURE — list order matters', [3, 2, 1], [1, 2, 3]),
];

const ok = printTable('Harness selftest (2 failures expected)', checks);
console.log(
  ok
    ? 'UNEXPECTED: the selftest passed. The harness is no longer catching failures.'
    : 'Expected: 2 failures reported above, exiting 1.'
);
finish(ok);
