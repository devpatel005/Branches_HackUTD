/**
 * The shared secret the agent service presents to claim the `agent` role.
 *
 * Why a module constant: a SpacetimeDB module has no access to `process.env` at
 * runtime, so the expected value has to be baked into the WASM at publish time.
 * Changing it means republishing.
 *
 * **Change this before any deploy that matters.** With a default value in the
 * repository the check stops any *casual* client from claiming the role, but it
 * is not a secret from anyone who can read the source. That is proportionate
 * while every byte in the database is mock data (02 Ground Rules #3) and the
 * repo is private — and it is still far better than first-come registration,
 * which would make the role check decorative and quietly undermine
 * "the agent proposes; humans decide" (02 Ground Rules #4).
 *
 * OPEN(OD-19): a real deployment wants this injected at build time.
 */
export const AGENT_SHARED_SECRET = 'branches-dev-agent-secret';
