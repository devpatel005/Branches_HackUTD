/**
 * V9 Never-stuck — Stage 8.
 *
 * 10 Screens#States every screen needs lists the states every screen owes the
 * user; this asserts the one that is a *trap* rather than a rough edge: a screen
 * that renders nothing, or renders a spinner forever, with no action on it.
 *
 * It is a static scan, deliberately. These regressions are all one line long —
 * an early `return null` while a hook settles, a new screen copying
 * `if (!x) return <Loading/>` from an old one — and they are invisible in
 * development, because locally the server is always up and the data always
 * arrives. The failure only appears on stage, which is the one place nobody can
 * fix it.
 *
 * What it cannot check is whether the copy is any good. That stays in the
 * manual V8 checklist.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { check, finish, printTable, type Check } from './table.ts';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..', 'apps', 'mobile', 'app');
const srcRoot = join(here, '..', '..', 'apps', 'mobile', 'src');

function filesUnder(dir: string, ext = '.tsx'): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Strip comments, so a comment that mentions `return null` is not a hit. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const checks: Check[] = [];
const screens = filesUnder(appRoot);

checks.push(check('S0', 'app screens were found to scan', screens.length > 0, true));

// ======================================================================
// S1 - no screen renders a blank page while it waits
// ======================================================================
/**
 * `_layout.tsx` files are exempt: a layout that only redirects legitimately
 * renders nothing, and `+html.tsx` is a web document shell.
 */
const RENDERS_NOTHING_EXEMPT = ['_layout.tsx', '+html.tsx'];

/**
 * Only the **default export** is a screen.
 *
 * A guarded `return null` means different things in the two places it appears.
 * In the screen component, `if (!household) return null` is a blank page with
 * nothing to read and nothing to tap. In a sheet further down the same file,
 * `if (!branch) return null` is simply a sheet that is not open, and is
 * correct — so scoping by indentation alone reports the second as if it were
 * the first. The exported component's body is the thing that owns the page.
 */
function screenBody(source: string): string {
  const start = source.search(/^export default function /m);
  if (start === -1) return '';
  // Up to the next declaration at column 0, which is the end of this component.
  const rest = source.slice(start + 'export default function '.length);
  const end = rest.search(/^(export |function |const |type |class )/m);
  return end === -1 ? rest : rest.slice(0, end);
}

const blankReturns: string[] = [];
for (const path of screens) {
  const name = path.split('/').pop()!;
  if (RENDERS_NOTHING_EXEMPT.includes(name)) continue;

  for (const match of screenBody(code(path)).matchAll(/if \([^)]*\) return null;/g)) {
    blankReturns.push(`${relative(appRoot, path)}: ${match[0].trim()}`);
  }
}

checks.push(
  check('S1', 'no screen bails out to a blank page while data loads', blankReturns, [])
);

// ======================================================================
// S2 - the shared Loading state cannot wait forever in silence
// ======================================================================
// Six screens short-circuit to `Loading`, so this one component is the floor
// under all of them. If the escape hatch is removed, every one of them becomes
// an indefinite spinner again.
const components = readFileSync(join(srcRoot, 'components.tsx'), 'utf8');

checks.push(
  check('S2a', 'Loading reveals a hint after a timeout', /SLOW_MS/.test(components), true),
  check(
    'S2b',
    'and offers a reload rather than only an explanation',
    /window\.location\.reload/.test(components),
    true
  ),
  check(
    'S2c',
    'and names the connection problem when there is one',
    /useConnectionTrouble/.test(components),
    true
  )
);

// ======================================================================
// S3 - a connection failure reaches the user, not just the console
// ======================================================================
const provider = readFileSync(join(srcRoot, 'spacetime.tsx'), 'utf8');
const onConnectError = provider.slice(provider.indexOf('.onConnectError'));

checks.push(
  check('S3a', 'the provider exposes connection trouble as state', /setConnectError/.test(onConnectError), true),
  check(
    'S3b',
    'and a successful connect clears it, so a recovered connection stops nagging',
    /setConnectError\(null\)/.test(provider),
    true
  )
);

// ======================================================================
// S4 - agent progress always has a way around it
// ======================================================================
/**
 * The subtle one. The agent being *registered* is not the same as its service
 * being alive: if it dies mid-job the `agent_job` row simply stops changing, no
 * subscription event ever arrives, and a progress line sits on screen
 * indefinitely. Any screen that shows `progressText` must therefore also handle
 * `stalled`, and `useAgentActivity` must own a clock — without one there is
 * nothing to re-render when the thing being detected is the absence of change.
 */
const events = readFileSync(join(srcRoot, 'events.ts'), 'utf8');

const showsProgress = screens.filter(path => /agent\.progressText/.test(code(path)));
const missingStall = showsProgress
  .filter(path => !/agent\.stalled/.test(code(path)))
  .map(path => relative(appRoot, path));

checks.push(
  check('S4a', 'at least one screen shows agent progress', showsProgress.length > 0, true),
  check('S4b', 'every screen showing agent progress also handles a stall', missingStall, []),
  check('S4c', 'the stall signal exists', /stalled:/.test(events), true),
  check(
    'S4d',
    'and it is driven by a clock, since a wedged job never re-renders',
    /setInterval/.test(events),
    true
  ),
  check(
    'S4e',
    'the clock only runs while work is outstanding',
    /if \(!hasOutstanding\) return;/.test(events),
    true
  )
);

// ======================================================================
// S5 - the waiting room is not a trap
// ======================================================================
// `createHousehold` refuses once you are already a member, so a user who lands
// here with a typo in their name, or alone, previously had no action at all.
const welcome = readFileSync(join(appRoot, 'welcome.tsx'), 'utf8');
const waitingRoom = welcome.slice(welcome.indexOf('function WaitingForPartner'));

checks.push(
  check('S5a', 'the waiting room offers at least one action', /<Button/.test(waitingRoom), true),
  check('S5b', 'the name can be corrected in place', /setDisplayName/.test(waitingRoom), true),
  check(
    'S5c',
    'and it points at the second-identity trick for one browser',
    /device=b/.test(waitingRoom),
    true
  )
);

// ======================================================================
// S6 - an empty branch list is recoverable
// ======================================================================
const session = readFileSync(join(appRoot, 'session.tsx'), 'utf8');
const emptyBranches = session.slice(
  session.indexOf('branches.length === 0 ?'),
  session.indexOf('branches.map(branch =>')
);

checks.push(
  check(
    'S6',
    'no branches on screen still offers a retry and a way out',
    /<Button/.test(emptyBranches) && /Back to Chat/.test(emptyBranches),
    true
  )
);

// ======================================================================
// S7 - the agent-off path is advertised where it is needed
// ======================================================================
// 07 Agent Spec#Deterministic fallbacks: the demo must work end to end with the
// agent turned off. That is only true if the user can tell.
const chat = code(join(appRoot, '(tabs)', 'chat.tsx'));

checks.push(
  check('S7a', 'chat detects whether an agent exists at all', /useHasAgent/.test(chat), true),
  check(
    'S7b',
    'and the form path is reachable regardless',
    /EventFormSheet/.test(chat) && /setEventFormOpen/.test(chat),
    true
  )
);

finish(printTable('V9 Never-stuck (Stage 8)', checks));
