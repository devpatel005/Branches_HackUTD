/**
 * Runs every verification suite and aggregates the result
 * (12 Verification#How verification works). Exits non-zero if any suite fails.
 *
 * Suites are added as the stages land. `expectFailure` suites are harness
 * checks: they must exit non-zero, and a zero exit is itself a failure.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

type Suite = {
  name: string;
  script: string;
  expectFailure?: boolean;
  /** Needs a published SpacetimeDB; skipped with a notice when none is reachable. */
  requiresServer?: boolean;
  stage: string;
};

const SUITES: Suite[] = [
  { name: 'V1 Math', script: 'math.ts', stage: 'Stage 1' },
  { name: 'V2 Engine', script: 'engine.ts', stage: 'Stage 1' },
  { name: 'Engine purity', script: 'purity.ts', stage: 'Stage 1' },
  { name: 'Harness selftest', script: 'selftest.ts', expectFailure: true, stage: 'Stage 0' },
  { name: 'Stage 0 data path', script: 'stdb.ts', requiresServer: true, stage: 'Stage 0' },
  // Stage 2: { name: 'V3 Inference', script: 'inference.ts', stage: 'Stage 2' },
  // Stage 3: { name: 'V4 Data flow', script: 'flow.ts', stage: 'Stage 3' },
  // Stage 6: { name: 'V5 Agent contract', script: 'agent.ts', stage: 'Stage 6' },
];

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const YELLOW = '\x1b[33m';

/** Cheap reachability probe so a missing server reads as SKIP, not FAIL. */
async function serverReachable(): Promise<boolean> {
  const host = process.env.SPACETIME_HOST ?? 'ws://127.0.0.1:3000';
  const httpUrl = host.replace(/^ws/, 'http').replace(/\/$/, '');
  try {
    const res = await fetch(`${httpUrl}/v1/ping`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const canReachServer = await serverReachable();
const results: { suite: Suite; ok: boolean; code: number; skipped?: boolean }[] = [];

for (const suite of SUITES) {
  if (suite.requiresServer && !canReachServer) {
    results.push({ suite, ok: true, code: 0, skipped: true });
    continue;
  }
  const run = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', join(here, suite.script)],
    { stdio: 'inherit' }
  );
  const code = run.status ?? 1;
  const ok = suite.expectFailure ? code !== 0 : code === 0;
  results.push({ suite, ok, code });
}

console.log(`${BOLD}Verification summary${RESET}`);
for (const { suite, ok, code, skipped } of results) {
  const label = suite.expectFailure ? `${suite.name} (expected to fail)` : suite.name;
  if (skipped) {
    console.log(`  ${YELLOW}SKIP${RESET}  ${label}  ${suite.stage}  no SpacetimeDB reachable`);
    continue;
  }
  const status = ok ? `${GREEN}OK${RESET}` : `${RED}FAILED${RESET}`;
  console.log(`  ${status}  ${label}  ${suite.stage}  exit=${code}`);
}

const skippedCount = results.filter(r => r.skipped).length;
if (skippedCount > 0) {
  console.log(
    `\n${YELLOW}${skippedCount} suite(s) skipped.${RESET} Start a server and republish to include them:` +
      '\n  npm run stdb:start          (separate terminal)' +
      '\n  npm run stdb:publish:local'
  );
}

const failed = results.filter(r => !r.ok).length;
console.log(
  failed === 0
    ? `\n${GREEN}All ${results.length} suites behaved as expected.${RESET}\n`
    : `\n${RED}${failed} of ${results.length} suites did not behave as expected.${RESET}\n`
);
process.exit(failed === 0 ? 0 : 1);
