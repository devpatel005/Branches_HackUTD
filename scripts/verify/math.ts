/**
 * V1 Math — 12 Verification#V1 Math.
 *
 * The five formula goldens F1-F5 from 06 Engine Spec#Formulas, the r = 0 edge
 * cases, and the money-rounding guards that several engine goldens depend on.
 *
 * Money comparisons are exact to the cent.
 */
import {
  f1SavingsNoInterest,
  f2SinkingFund,
  f3FutureValueOfSeries,
  f4LoanPayment,
  f5Inflate,
  monthlyRate,
  toCents,
  toIntegerCents,
  fromIntegerCents,
} from '@branches/engine';
import { check, finish, printTable, type Check } from './table.ts';

const checks: Check[] = [
  // ---- The five goldens ------------------------------------------------
  check('F1', 'savings, no interest: FV 12,000 / n 24', f1SavingsNoInterest(12000, 24), 500),
  check('F2', 'sinking fund: FV 20,000, n 36, 4%', f2SinkingFund(20000, 36, 0.04), 523.81),
  check(
    'F3',
    'future value of series: PV 5,000, PMT 300, n 60, 4%',
    f3FutureValueOfSeries(5000, 300, 60, 0.04),
    25994.68
  ),
  check('F4', 'loan payment: P 350,000, n 360, 6.25%', f4LoanPayment(350000, 360, 0.0625), 2155.01),
  check('F5', 'inflation: C0 5,000, 60 months, 2.7%', f5Inflate(5000, 60, 0.027), 5712.45),

  // ---- r = 0 edge cases (06 Engine Spec: F2 becomes F1, F4 becomes P/n) ----
  check('Z1', 'F2 with r = 0 falls back to F1', f2SinkingFund(12000, 24, 0), f1SavingsNoInterest(12000, 24)),
  check('Z2', 'F2 with r = 0 equals FV / n', f2SinkingFund(20000, 36, 0), 555.56),
  check('Z3', 'F4 with r = 0 equals P / n', f4LoanPayment(350000, 360, 0), 972.22),
  check('Z4', 'F3 with r = 0 equals PV + PMT * n', f3FutureValueOfSeries(5000, 300, 60, 0), 23000),
  check('Z5', 'F5 with 0% inflation leaves the cost alone', f5Inflate(5000, 60, 0), 5000),
  check('Z6', 'monthlyRate divides the annual rate by 12', monthlyRate(0.12), 0.01),

  // ---- Money rounding --------------------------------------------------
  // M1 guards the exact half-cent tie that 06 Engine Spec E1 depends on. A
  // naive Math.round(x * 100) / 100 returns 5273.64 here and E1 then FAILS.
  check('M1', 'toCents: half-cent tie rounds up (E1 Japan inflated cost)', toCents(5000 * Math.pow(1.027, 2)), 5273.65),
  check('M2', 'toCents: ordinary value unaffected (E1 House inflated cost)', toCents(40000 * Math.pow(1.027, 5)), 45699.58),
  // M3 is OPEN(OD-17) — see 15 Money and Rounding.
  check('M3', 'toCents: negative ties round away from zero (OD-17)', toCents(-2.345), -2.35),
  check('M4', 'toCents: symmetry, toCents(-x) === -toCents(x) (OD-17)', toCents(-2.345), -toCents(2.345)),
  check('M5', 'toCents: already-exact cents pass through', toCents(1899.28), 1899.28),
  check('M6', 'toIntegerCents: dollars to integer cents for storage', toIntegerCents(1899.28), 189928),
  check('M7', 'fromIntegerCents round-trips', fromIntegerCents(toIntegerCents(5273.65)), 5273.65),
];

finish(printTable('V1 Math', checks));
