# @branches/bindings

**Generated. Do not edit by hand.** Every file under `src/` is overwritten by:

```bash
npm run stdb:bindings
```

Regenerate after **every** change to `server/spacetime` tables or reducers.
Clients that use stale bindings fail in confusing ways (missing columns, or a
reducer signature mismatch) rather than with a clear error.

Three consumers, because all three are SpacetimeDB clients
([[04 Architecture]]): `apps/mobile`, `services/agent`, and `scripts/verify`.

The output is committed deliberately, so a fresh clone and CI can typecheck
without a running database.

Generated with `--import-extension ts`: the default extensionless imports
resolve in Metro but **not** in Node ESM, which breaks the Node-run
verification scripts. The `.ts` form works in both.
