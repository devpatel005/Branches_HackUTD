/**
 * Engine purity — the Stage 1 Done-when item "Engine has no imports of I/O,
 * time, or randomness."
 *
 * A static scan of packages/engine/src, because this is the rule most easily
 * broken by accident later: one `Date.now()` for a "current month" default, or
 * one `Math.random()` in a tie-break, and determinism (02 Ground Rules #5) is
 * gone with no visible symptom until two clients disagree.
 *
 * E10 in verify:engine catches a *detectable* non-determinism; this catches the
 * import before it ever gets the chance.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { check, finish, printTable, type Check } from './table.ts';

const here = dirname(fileURLToPath(import.meta.url));
const engineSrc = join(here, '..', '..', 'packages', 'engine', 'src');

/** Patterns that would break purity, with why each one matters. */
const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: 'Date.now()', pattern: /\bDate\s*\.\s*now\s*\(/ },
  { label: 'new Date(', pattern: /\bnew\s+Date\s*\(/ },
  { label: 'Math.random()', pattern: /\bMath\s*\.\s*random\s*\(/ },
  { label: 'crypto randomness', pattern: /\bcrypto\s*\.\s*(getRandomValues|randomUUID|randomBytes)\b/ },
  { label: 'performance.now()', pattern: /\bperformance\s*\.\s*now\s*\(/ },
  { label: 'process access', pattern: /\bprocess\s*\.\s*(env|argv|cwd|hrtime)\b/ },
  { label: 'node: builtin import', pattern: /from\s+['"]node:/ },
  { label: 'fs / path / http import', pattern: /from\s+['"](fs|path|http|https|os|child_process)['"]/ },
  { label: 'fetch()', pattern: /\bfetch\s*\(/ },
  { label: 'console output', pattern: /\bconsole\s*\.\s*\w+\s*\(/ },
  { label: 'timer', pattern: /\b(setTimeout|setInterval|setImmediate)\s*\(/ },
];

function engineFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...engineFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = engineFiles(engineSrc);
const checks: Check[] = [
  check('PU0', 'engine source files were found to scan', files.length > 0, true),
];

for (const { label, pattern } of FORBIDDEN) {
  const hits: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Strip comments first: the comments legitimately *mention* Date.now() and
    // Math.random() while explaining why they are banned.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    if (pattern.test(code)) hits.push(relative(engineSrc, file));
  }
  checks.push(
    check(`PU.${label.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`, `engine does not use ${label}`, hits, [])
  );
}

/** The engine may only depend on itself — no runtime dependencies at all. */
const enginePkg = JSON.parse(
  readFileSync(join(here, '..', '..', 'packages', 'engine', 'package.json'), 'utf8')
) as { dependencies?: Record<string, string> };

checks.push(
  check(
    'PU.deps',
    'engine has no runtime dependencies',
    Object.keys(enginePkg.dependencies ?? {}),
    []
  )
);

/** Every intra-engine import must be relative, so nothing external leaks in. */
const externalImports = new Set<string>();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = match[1]!;
    if (!spec.startsWith('.')) externalImports.add(spec);
  }
}
checks.push(
  check('PU.imports', 'engine imports nothing outside itself', [...externalImports].sort(), [])
);

finish(printTable('Engine purity (Stage 1 Done-when)', checks));
