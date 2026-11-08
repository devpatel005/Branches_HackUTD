/**
 * Stage 0 data-path check, and the seed of V4 Data flow (12 Verification).
 *
 * Connects two independent clients to a running SpacetimeDB, proving the pieces
 * the whole build sits on:
 *   - the generated bindings drive a real connection from Node
 *   - packages/engine executed inside the WASM reducer (engineCheck === 500)
 *   - a reducer called by client A is observed by client B over a subscription
 *     (the same path that makes the live session work)
 *   - reconnecting with a stored token returns the SAME identity, which is what
 *     keeps a household member themselves across reloads
 *
 * Needs a published module:
 *   npm run stdb:start   (separate terminal)
 *   npm run stdb:publish:local
 *   npm run verify:stdb
 */
import { DbConnection, tables, reducers } from '@branches/bindings';
import type { Identity } from 'spacetimedb';
import { check, printTable, type Check } from './table.ts';

const HOST = process.env.SPACETIME_HOST ?? 'ws://127.0.0.1:3000';
const DB = process.env.SPACETIME_DB_NAME ?? 'branches';
const TIMEOUT_MS = 15_000;

type Client = { conn: DbConnection; identity: Identity; token: string };

function connect(label: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: no connection within ${TIMEOUT_MS}ms — is the module published?`)),
      TIMEOUT_MS
    );
    const conn = DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .withToken(token)
      .onConnect((c, identity, newToken) => {
        clearTimeout(timer);
        resolve({ conn: c, identity, token: newToken });
      })
      .onConnectError((_ctx, error) => {
        clearTimeout(timer);
        reject(new Error(`${label}: ${error.message}`));
      })
      .build();
  });
}

/** Subscribe and resolve once the initial rows have arrived. */
function subscribeCounter(client: Client): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscription timed out')), TIMEOUT_MS);
    client.conn
      .subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(timer);
        resolve();
      })
      .onError((_ctx, error) => {
        clearTimeout(timer);
        reject(error);
      })
      .subscribe(['SELECT * FROM counter']);
  });
}

function readCounter(client: Client) {
  return [...client.conn.db.counter.iter()][0];
}

/** Resolve when B's subscription reports the counter reaching `target`. */
function waitForValue(client: Client, target: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const existing = readCounter(client);
    if (existing && existing.value >= target) return resolve(existing.value);
    const timer = setTimeout(
      () => reject(new Error(`B never saw the counter reach ${target}`)),
      TIMEOUT_MS
    );
    client.conn.db.counter.onUpdate((_ctx, _old, row) => {
      if (row.value >= target) {
        clearTimeout(timer);
        resolve(row.value);
      }
    });
  });
}

const checks: Check[] = [];

// Two clients, as in the demo: one phone, one laptop.
const a = await connect('client A');
const b = await connect('client B');
await Promise.all([subscribeCounter(a), subscribeCounter(b)]);

const before = readCounter(a);
if (!before) throw new Error('counter row missing — republish the module');

checks.push(
  check('D1', 'client A connected and received an identity', typeof a.identity.toHexString(), 'string'),
  check('D2', 'client B connected with a different identity', a.identity.toHexString() === b.identity.toHexString(), false),
  check('D3', 'engine ran inside the reducer: F1(12,000, 24)', before.engineCheck, 500),
  check('D4', 'engine version written by the module', before.engineVersion, '0.0.0-stage0')
);

// A calls the reducer; B must observe it through its own subscription.
const target = before.value + 1;
const observed = waitForValue(b, target);
await a.conn.reducers.increment();
const seenByB = await observed;

checks.push(
  check('D5', "client B observed client A's increment", seenByB, target),
  check('D6', 'the reducer recorded who called it', readCounter(a)?.lastBumpedBy?.toHexString(), a.identity.toHexString())
);

// Reconnect with A's stored token: the identity must be preserved.
a.conn.disconnect();
const aAgain = await connect('client A (reconnect)', a.token);
checks.push(
  check('D7', 'reconnecting with the stored token keeps the identity', aAgain.identity.toHexString(), a.identity.toHexString()),
  check('D8', 'connecting with no token yields a different identity', (await connect('client C')).identity.toHexString() === a.identity.toHexString(), false)
);

const ok = printTable('Stage 0 data path (V4 precursor)', checks);
process.exit(ok ? 0 : 1);
