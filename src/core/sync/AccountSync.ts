import type { TrialRepository } from "../storage/TrialRepository";
import { OfflineError, RetryLaterError, SignedOutError, type AccountUser, type ApiClient } from "./ApiClient";
import { SyncLedger } from "./SyncLedger";
import { syncAccount, type SyncResult } from "./syncAccount";

/** Saves this close together share one sync: a run of trials is one request, not one per trial. */
const SAVE_SETTLE_MS = 4_000;
/** A tab shown again after this long syncs, to pick up what other devices did meanwhile. */
const STALE_AFTER_MS = 5 * 60_000;

export type AccountPhase = "loading" | "signed-out" | "idle" | "syncing" | "offline" | "error";

export interface AccountState {
  /** Null when signed out, and while no session could be checked. */
  user: AccountUser | null;
  phase: AccountPhase;
  /** When this device last finished a sync with `user` (ISO). */
  lastSyncedAt: string | null;
  /** Counts from the last sync this page ran. */
  lastResult: SyncResult | null;
  /** Why sync is paused, in the server's words when it gave any; set only in the error phase. */
  error: string | null;
}

/** Where small per-account notes live; window.localStorage is one. */
export interface AccountStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const lastSyncedKey = (userId: string) => `vc-last-synced:${userId}`;

/**
 * The account and its sync, as one small state machine the UI subscribes
 * to. Practice never waits on it: saves land on this device first, and sync
 * catches up when it can — shortly after saves, when the network returns,
 * and when a tab comes back after a while.
 *
 * One sync runs at a time; asking for more while one runs queues a single
 * follow-up. Whatever ends a session (sign-out, deletion, a 401, `stop`)
 * aborts its signal, and work under an aborted signal never touches state
 * and never saves a ledger.
 */
export class AccountSync {
  private state: AccountState = { user: null, phase: "loading", lastSyncedAt: null, lastResult: null, error: null };
  private readonly listeners = new Set<() => void>();
  private session = new AbortController();
  private running: Promise<void> | null = null;
  private followUp = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Automatic syncs wait until this time (epoch ms): the server asked for a pause. */
  private pausedUntil = 0;
  /** A failed sync may have applied some pages first, so the next success refreshes the screens either way. */
  private refreshOwed = false;

  constructor(
    private readonly deps: {
      api: Pick<ApiClient, "me" | "logout" | "syncOnce" | "exportAccount" | "deleteAccount">;
      repo: TrialRepository;
      store: AccountStore;
      /** Local data changed underneath the screens. */
      onPulled: () => void | Promise<void>;
    },
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getState = (): AccountState => this.state;

  /** Checks who is signed in, then syncs if anyone is. */
  async start(): Promise<void> {
    const { signal } = this.session;
    let user: AccountUser | null;
    try {
      user = await this.deps.api.me();
    } catch {
      // Until a session is known, any failure only says the account can't be reached right now.
      if (!signal.aborted) this.set({ phase: "offline" });
      return;
    }
    if (signal.aborted) return;
    if (!user) return this.signedOut();
    this.set({ user, phase: "idle", lastSyncedAt: this.lastSynced(user.id), error: null });
    await this.syncNow();
  }

  /** Cancels a waiting sync and disowns work in flight; `start` may run again after. */
  stop(): void {
    this.session.abort();
    this.session = new AbortController();
    this.followUp = false;
    clearTimeout(this.timer);
  }

  /** Syncs now, or straight after the sync in flight. With no user known, checks the session again instead. */
  syncNow(): Promise<void> {
    const { user } = this.state;
    if (!user) return this.start();
    clearTimeout(this.timer);
    if (this.running) {
      this.followUp = true;
      return this.running;
    }
    this.running = this.run(user, this.session.signal).finally(() => {
      this.running = null;
      if (this.followUp) {
        this.followUp = false;
        void this.syncNow();
      }
    });
    return this.running;
  }

  /** After a local save: sync once saves settle, or check again for the account if it couldn't be reached. */
  scheduleSync(): void {
    if (this.state.user || this.state.phase === "offline") this.arm(SAVE_SETTLE_MS);
  }

  /** The network is back: retry whatever it stopped. */
  resume(): void {
    if (this.state.user || this.state.phase === "offline") this.arm(0);
  }

  /** The tab is showing again: sync if the last sync is old, or never got through. */
  refreshIfStale(): void {
    const { phase, lastSyncedAt } = this.state;
    const stale = lastSyncedAt === null || Date.now() - Date.parse(lastSyncedAt) > STALE_AFTER_MS;
    if (phase === "offline" || ((phase === "idle" || phase === "error") && stale)) this.arm(0);
  }

  /** Ends the session; this device keeps its practice. Send the browser to `logoutUrl` when there is one. */
  async signOut(): Promise<{ logoutUrl: string | null }> {
    const result = await this.deps.api.logout();
    this.signedOut();
    return result;
  }

  /**
   * Deletes every record on this device. What it had exchanged with any
   * account goes with them, so a signed-in account's copy syncs back in
   * full. A sync in flight is disowned first: its ledger predates the wipe.
   */
  async clearLocalData(): Promise<void> {
    this.stop();
    await this.deps.repo.clear();
    await this.deps.onPulled();
    if (this.state.user) await this.syncNow();
  }

  /** Everything the account holds, as backup JSON. */
  exportAccount(): Promise<string> {
    return this.watchSession(this.deps.api.exportAccount());
  }

  /**
   * Deletes the account and the server's copy of its records, and forgets
   * what this device kept about syncing with it. Local practice stays.
   */
  async deleteAccount(): Promise<{ logoutUrl: string | null }> {
    const { user } = this.state;
    const result = await this.watchSession(this.deps.api.deleteAccount());
    // Signed out first, so a sync in flight can't save the ledger again once it is gone.
    this.signedOut();
    if (user) {
      await SyncLedger.forget(user.id, this.deps.repo);
      this.deps.store.removeItem(lastSyncedKey(user.id));
    }
    return result;
  }

  /** A request that finds the session gone shows as signed out, and still fails for its caller. */
  private async watchSession<T>(request: Promise<T>): Promise<T> {
    try {
      return await request;
    } catch (error) {
      if (error instanceof SignedOutError) this.signedOut();
      throw error;
    }
  }

  private async run(user: AccountUser, signal: AbortSignal): Promise<void> {
    this.set({ phase: "syncing", error: null });
    try {
      const ledger = await SyncLedger.load(user.id, this.deps.repo);
      const result = await syncAccount(this.deps.repo, this.deps.api, ledger, { signal });
      if (signal.aborted) return;
      const lastSyncedAt = new Date().toISOString();
      try {
        this.deps.store.setItem(lastSyncedKey(user.id), lastSyncedAt);
      } catch {
        /* full storage: the time is right until the page reloads */
      }
      this.pausedUntil = 0;
      this.set({ phase: "idle", lastSyncedAt, lastResult: result });
      if (result.pulled > 0 || this.refreshOwed) {
        this.refreshOwed = false;
        await this.deps.onPulled();
      }
    } catch (error) {
      if (signal.aborted) return;
      this.refreshOwed = true;
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (error instanceof SignedOutError) return this.signedOut();
    if (error instanceof OfflineError) return this.set({ phase: "offline" });
    this.set({ phase: "error", error: error instanceof Error ? error.message : String(error) });
    if (error instanceof RetryLaterError) {
      this.pausedUntil = Date.now() + error.retryAfter * 1000;
      this.arm(0);
    }
  }

  private signedOut(): void {
    this.stop();
    this.pausedUntil = 0;
    this.set({ user: null, phase: "signed-out", lastSyncedAt: null, lastResult: null, error: null });
  }

  /** Syncs after `delay`, or when a pause the server asked for ends if that is later; replaces a sync already waiting. */
  private arm(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), Math.max(delay, this.pausedUntil - Date.now()));
  }

  private lastSynced(userId: string): string | null {
    const saved = this.deps.store.getItem(lastSyncedKey(userId));
    return saved && !Number.isNaN(Date.parse(saved)) ? saved : null;
  }

  private set(patch: Partial<AccountState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
