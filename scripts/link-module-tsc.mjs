/**
 * `spacetime build` looks for tsc inside the module's own node_modules, but npm
 * workspaces hoists typescript to the repo root. Without this link the build
 * prints "tsc not found in node_modules" and SKIPS TYPECHECKING the module —
 * type errors would reach the published WASM silently.
 *
 * Runs on postinstall so it self-heals after any npm install.
 */
import { mkdirSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const moduleDir = join(repoRoot, 'server', 'spacetime');
const rootTs = join(repoRoot, 'node_modules', 'typescript');

if (!existsSync(rootTs)) {
  console.warn('[link-module-tsc] root typescript not installed yet; skipping');
  process.exit(0);
}

const links = [
  [join(moduleDir, 'node_modules', 'typescript'), rootTs],
  [join(moduleDir, 'node_modules', '.bin', 'tsc'), join(rootTs, 'bin', 'tsc')],
];

for (const [linkPath, target] of links) {
  mkdirSync(dirname(linkPath), { recursive: true });
  rmSync(linkPath, { force: true, recursive: true });
  symlinkSync(relative(dirname(linkPath), target), linkPath);
}
console.log('[link-module-tsc] linked typescript into server/spacetime');
