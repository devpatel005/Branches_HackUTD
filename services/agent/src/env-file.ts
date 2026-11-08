/**
 * Makes `services/agent/.env` authoritative over the ambient shell.
 *
 * Node's `--env-file-if-exists` deliberately does **not** override variables
 * already present in `process.env`. That cost an afternoon once: a stale
 * `export GEMINI_API_KEY=...` in `~/.zshrc` silently shadowed the real key in
 * `.env`, and every call came back `400 API_KEY_INVALID` — which reads exactly
 * like "the key in .env is bad" when the key in .env was fine all along.
 *
 * So: `.env` wins, and any value it displaces is reported by name. A service
 * directory's own config file should beat whatever happens to be exported in
 * the terminal that started it.
 *
 * Import this for its side effect, before anything reads `process.env`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), '.env');

/** Never print a credential. Prefix and length are enough to tell two apart. */
function mask(name: string, value: string): string {
  return /KEY|SECRET|TOKEN|PASSWORD/i.test(name) ? `${value.slice(0, 4)}…(${value.length} chars)` : value;
}

/** Minimal `KEY=value`: comments, blank lines, and optional matched quotes. */
function parse(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    out.set(name, value);
  }
  return out;
}

export function loadEnvFile(): string[] {
  let text: string;
  try {
    text = readFileSync(ENV_PATH, 'utf8');
  } catch {
    return []; // No .env is a normal way to run: the mock needs no key.
  }

  const shadowed: string[] = [];
  for (const [name, value] of parse(text)) {
    const ambient = process.env[name];
    if (ambient !== undefined && ambient !== value) {
      shadowed.push(name);
      console.warn(
        `.env overrides ${name} from the environment:\n` +
          `    .env         ${mask(name, value)}\n` +
          `    environment  ${mask(name, ambient)}   <- ignored (check ~/.zshrc)`
      );
    }
    process.env[name] = value;
  }
  return shadowed;
}

loadEnvFile();
