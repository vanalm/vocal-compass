import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AccountSync, type AccountStore } from "../../core";
import { readAuthNotice, SIGNED_IN } from "../accountStatus";
import { saveJsonFile } from "../download";
import { useServices } from "../services";

/** localStorage, or a stand-in for this page's lifetime where the browser blocks it. */
function deviceStore(): AccountStore {
  try {
    return window.localStorage;
  } catch {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    };
  }
}

/**
 * The account and its sync for the whole app; the shell owns the one
 * instance. Local writes call `scheduleSync`, and `onPulled` refreshes the
 * screens when changes from another device land.
 */
export function useAccount({ onPulled }: { onPulled: () => Promise<void> }) {
  const { api, repository } = useServices();
  const pulled = useRef(onPulled);
  pulled.current = onPulled;
  const [sync] = useState(
    () => new AccountSync({ api, repo: repository, store: deviceStore(), onPulled: () => pulled.current() }),
  );
  const state = useSyncExternalStore(sync.subscribe, sync.getState);
  // Read in the first render, so the shell can open on the screen that explains it.
  const [auth] = useState(() => readAuthNotice(window.location.search));

  useEffect(() => {
    if (!auth.returning) return;
    const { pathname, hash } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${auth.search}${hash}`);
  }, [auth]);

  useEffect(() => {
    void sync.start();
    const online = () => sync.resume();
    const visible = () => {
      if (document.visibilityState === "visible") sync.refreshIfStale();
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
      sync.stop();
    };
  }, [sync]);

  const actions = useMemo(() => {
    // Ending the session at the identity provider as well takes a visit to its page.
    const leave = ({ logoutUrl }: { logoutUrl: string | null }) => {
      if (logoutUrl) window.location.assign(logoutUrl);
    };
    return {
      /** Leaves for the identity provider's page, which sends the browser back here, marked as back from signing in. */
      signIn: (screenHint?: "sign-in" | "sign-up") =>
        window.location.assign(
          api.loginUrl({ returnTo: `${window.location.pathname}?auth=${SIGNED_IN}`, screenHint }),
        ),
      signOut: async () => leave(await sync.signOut()),
      syncNow: () => sync.syncNow(),
      scheduleSync: () => sync.scheduleSync(),
      clearLocalData: () => sync.clearLocalData(),
      exportAccount: async () => saveJsonFile(await sync.exportAccount(), "vocal-compass-account"),
      deleteAccount: async () => leave(await sync.deleteAccount()),
    };
  }, [api, sync]);

  return { ...state, authNotice: auth.notice, returningFromSignIn: auth.returning, ...actions };
}

export type Account = ReturnType<typeof useAccount>;
