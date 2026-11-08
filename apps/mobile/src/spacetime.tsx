import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import type { Identity } from 'spacetimedb';
import { DbConnection } from '@branches/bindings';
import { SPACETIME_DB_NAME, SPACETIME_HOST } from './config';
import { loadToken, saveToken } from './token-store';

type IdentityState = { identity: Identity | null; reusedToken: boolean };

const IdentityContext = createContext<IdentityState>({ identity: null, reusedToken: false });

/** The identity this device connected as, for the "same identity after reload" check. */
export function useIdentity(): IdentityState {
  return useContext(IdentityContext);
}

/**
 * Builds the connection once the stored token has been read.
 *
 * The builder's withToken() is synchronous but AsyncStorage is not, so we must
 * resolve the token *before* constructing the builder — otherwise the first
 * connection gets a brand-new identity and the persisted one is orphaned.
 */
export function BranchesSpacetimeProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | undefined>();
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [identityState, setIdentityState] = useState<IdentityState>({
    identity: null,
    reusedToken: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadToken().then(stored => {
      if (cancelled) return;
      setToken(stored);
      setTokenLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectionBuilder = useMemo(() => {
    if (!tokenLoaded) return null;
    const hadToken = token !== undefined;
    return DbConnection.builder()
      .withUri(SPACETIME_HOST)
      .withDatabaseName(SPACETIME_DB_NAME)
      .withToken(token)
      .withAutomaticReconnect()
      .onConnect((_conn, identity, newToken) => {
        void saveToken(newToken);
        setIdentityState({ identity, reusedToken: hadToken });
      })
      .onConnectError((_ctx, error) => {
        console.warn('[spacetime] connect failed:', error.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenLoaded]);

  if (!connectionBuilder) return null;

  return (
    <IdentityContext.Provider value={identityState}>
      <SpacetimeDBProvider connectionBuilder={connectionBuilder}>{children}</SpacetimeDBProvider>
    </IdentityContext.Provider>
  );
}
