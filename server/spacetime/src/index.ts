/**
 * Branches — SpacetimeDB module.
 *
 * Stage 0 scope: a `counter` table and an `increment` reducer, used to prove
 * (a) two clients sync in real time and (b) the module can call into
 * packages/engine, which is where every number must come from
 * (02 Ground Rules #1 and #7). The real data model arrives in Stage 2.
 */
import { schema, table, t } from 'spacetimedb/server';
import { ENGINE_VERSION, f1SavingsNoInterest } from '@branches/engine';

const counter = table(
  { name: 'counter', public: true },
  {
    id: t.u32().primaryKey(),
    value: t.u32(),
    /**
     * Written by the engine, never by hand. Proves the WASM module really
     * bundled and executed packages/engine: F1(12000, 24) must be 500.
     */
    engineCheck: t.f64(),
    engineVersion: t.string(),
    lastBumpedBy: t.option(t.identity()),
  }
);

const connectedClient = table(
  { name: 'connected_client', public: true },
  {
    identity: t.identity().primaryKey(),
    connectedAt: t.timestamp(),
  }
);

const spacetimedb = schema({ counter, connectedClient });
export default spacetimedb;

const COUNTER_ID = 0;

export const init = spacetimedb.init(ctx => {
  ctx.db.counter.insert({
    id: COUNTER_ID,
    value: 0,
    engineCheck: f1SavingsNoInterest(12000, 24),
    engineVersion: ENGINE_VERSION,
    lastBumpedBy: undefined,
  });
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  if (ctx.db.connectedClient.identity.find(ctx.sender)) return;
  ctx.db.connectedClient.insert({ identity: ctx.sender, connectedAt: ctx.timestamp });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  ctx.db.connectedClient.identity.delete(ctx.sender);
});

export const increment = spacetimedb.reducer(ctx => {
  const row = ctx.db.counter.id.find(COUNTER_ID);
  if (!row) throw new Error('counter row missing; republish the module');
  ctx.db.counter.id.update({
    ...row,
    value: row.value + 1,
    // Recomputed in the engine on every call, so a stale/absent engine shows up.
    engineCheck: f1SavingsNoInterest(12000, 24),
    engineVersion: ENGINE_VERSION,
    lastBumpedBy: ctx.sender,
  });
});

export const reset = spacetimedb.reducer(ctx => {
  const row = ctx.db.counter.id.find(COUNTER_ID);
  if (!row) return;
  ctx.db.counter.id.update({ ...row, value: 0, lastBumpedBy: undefined });
});
