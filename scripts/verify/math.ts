/**
 * V1 Math (12 Verification#V1 Math). Stage 0 ships F1 and the money-rounding
 * guard only; F2-F5 and the r = 0 edge cases land in Stage 1.
 */
import { f1SavingsNoInterest, toCents } from '@branches/engine';
import { check, printTable, type Check } from './table.ts';

const checks: Check[] = [
  check('F1', 'savings no interest: FV 12,000 / n 24', f1SavingsNoInterest(12000, 24), 500),
  check('F1b', 'savings no interest: FV 1,000 / n 3 rounds to cents', f1SavingsNoInterest(1000, 3), 333.33),
  // Guards the half-cent tie that 06 Engine Spec E1 depends on. A naive
  // Math.round(x * 100) / 100 returns 5273.64 here and E1 then FAILS.
  check('M1', 'toCents: half-cent tie rounds up (E1 Japan inflated cost)', toCents(5000 * Math.pow(1.027, 2)), 5273.65),
  check('M2', 'toCents: ordinary value unaffected (E1 House inflated cost)', toCents(40000 * Math.pow(1.027, 5)), 45699.58),
  check('M3', 'toCents: negative values round away from zero symmetrically', toCents(-2.345), -2.35),
  check('M4', 'toCents: already-exact cents pass through', toCents(1899.28), 1899.28),
];

process.exit(printTable('V1 Math (Stage 0 subset)', checks) ? 0 : 1);
