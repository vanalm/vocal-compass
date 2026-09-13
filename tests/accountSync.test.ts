import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSync, type AccountStore } from "../src/core/sync/AccountSync";
import {
  ApiClient,
  ApiError,
  OfflineError,
  RetryLaterError,
  SignedOutError,
  type AccountUser,
  type SyncRequest,
  type SyncResponse,
} from "../src/core/sync/ApiClient";
import { MemoryTrialRepository } from "../src/core/storage/TrialRepository";
import type { TrialRecord } from "../src/core/types";

const USER: AccountUser = { id: "u1", email: "singer@example.com", name: null };
const NOW = "2026-09-12T12:00:00.000Z";

const trial = (id: string) => ({ id, createdAt: "2026-09-01T10:00:00.000Z" }) as TrialRecord;
const page = (extra: Partial<SyncResponse> = {}): SyncResponse => ({
  userId: USER.id,
  accepted: 0,
  rejected: [],
  records: [],
  tombstones: [],
  cursor: 1,
  hasMore: false,
  ...extra,
});

function memoryStore(): AccountStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** An account whose server is these mocks: signed in as `user`, every sync an empty page. */
function setup(user: AccountUser | null = USER) {
  const api = {
    me: vi.fn(async (): Promise<AccountUser | null> => user),
    syncOnce: vi.fn(async (_body: SyncRequest): Promise<SyncResponse> => page()),
    logout: vi.fn(async (): Promise<{ logoutUrl: string | null }> => ({ logoutUrl: null })),
    exportAccount: vi.fn(async () => "{}"),
    deleteAccount: vi.fn(async (): Promise<{ logoutUrl: string | null }> => ({ logoutUrl: null })),
  };
  const repo = new MemoryTrialRepository();
  const store = memoryStore();
  const onPulled = vi.fn();
  const account = new AccountSync({ api, repo, store, onPulled });
  return { api, repo, store, onPulled, account, state: () => account.getState() };
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets pending promises and zero-delay timers run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("AccountSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays signed out without a session, and never syncs", async () => {
    const { api, account, state } = setup(null);
    expect(state().phase).toBe("loading");
    await account.start();
    expect(state()).toMatchObject({ user: null, phase: "signed-out" });
    account.scheduleSync();
    account.resume();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.syncOnce).not.toHaveBeenCalled();
  });

  it("syncs as soon as it finds a user, and remembers when for the next page load", async () => {
    const { api, store, account, state, onPulled } = setup();
    const listener = vi.fn();
    account.subscribe(listener);
    await account.start();
    expect(api.syncOnce).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({
      user: USER,
      phase: "idle",
      lastSyncedAt: NOW,
      lastResult: { pushed: 0, pulled: 0, rejected: 0, skipped: 0 },
    });
    expect(listener).toHaveBeenCalled();
    expect(onPulled).not.toHaveBeenCalled();

    const hanging = { ...api, syncOnce: vi.fn(() => new Promise<SyncResponse>(() => undefined)) };
    const reloaded = new AccountSync({ api: hanging, repo: new MemoryTrialRepository(), store, onPulled });
    void reloaded.start();
    await settle();
    expect(reloaded.getState()).toMatchObject({ phase: "syncing", lastSyncedAt: NOW });
  });

  it("reads an unreachable server at load as offline, not signed out, and checks again when the network returns", async () => {
    const { api, account, state } = setup();
    api.me.mockRejectedValueOnce(new OfflineError());
    await account.start();
    expect(state()).toMatchObject({ user: null, phase: "offline" });

    account.resume();
    await settle();
    expect(state()).toMatchObject({ user: USER, phase: "idle" });
    expect(api.syncOnce).toHaveBeenCalledTimes(1);
  });

  it("syncs once, 4 s after the last of several saves", async () => {
    const { api, account } = setup();
    await account.start();
    api.syncOnce.mockClear();

    account.scheduleSync();
    await vi.advanceTimersByTimeAsync(3_000);
    account.scheduleSync();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(api.syncOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.syncOnce).toHaveBeenCalledTimes(1);
  });

  it("runs one sync at a time, folding every request made meanwhile into one follow-up", async () => {
    const { api, account, state } = setup();
    await account.start();
    const slow = deferred<SyncResponse>();
    api.syncOnce.mockClear().mockReturnValueOnce(slow.promise);

    const first = account.syncNow();
    void account.syncNow();
    void account.syncNow();
    await settle();
    expect(api.syncOnce).toHaveBeenCalledTimes(1);
    expect(state().phase).toBe("syncing");

    slow.resolve(page());
    await first;
    await settle();
    expect(api.syncOnce).toHaveBeenCalledTimes(2);
    expect(state().phase).toBe("idle");
  });

  it("signs out when the server no longer knows the session", async () => {
    const { api, account, state } = setup();
    api.syncOnce.mockRejectedValueOnce(new SignedOutError("Sign in to sync."));
    await account.start();
    expect(state()).toMatchObject({ user: null, phase: "signed-out" });
  });

  it("keeps the user while offline, and syncs when the network returns", async () => {
    const { api, account, state } = setup();
    api.syncOnce.mockRejectedValueOnce(new OfflineError());
    await account.start();
    expect(state()).toMatchObject({ user: USER, phase: "offline" });

    account.resume();
    await settle();
    expect(state().phase).toBe("idle");
  });

  it("pauses when rate limited, and tries again after the server's delay, which saves don't cut short", async () => {
    const { api, account, state } = setup();
    api.syncOnce.mockRejectedValueOnce(new RetryLaterError("Too many requests.", 30));
    await account.start();
    expect(state()).toMatchObject({ phase: "error", error: "Too many requests." });

    account.scheduleSync();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(api.syncOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.syncOnce).toHaveBeenCalledTimes(2);
    expect(state()).toMatchObject({ phase: "idle", error: null });
  });

  it("waits out a busy server's Retry-After the same way, then tries again", async () => {
    const { api, account, state } = setup();
    const busy = new ApiClient({
      fetchFn: async () =>
        new Response(JSON.stringify({ detail: "The server is busy. Try again shortly." }), {
          status: 503,
          headers: { "content-type": "application/json", "retry-after": "2" },
        }),
    });
    api.syncOnce.mockImplementationOnce((body) => busy.syncOnce(body));
    await account.start();
    expect(state()).toMatchObject({ user: USER, phase: "error", error: "The server is busy. Try again shortly." });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(api.syncOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.syncOnce).toHaveBeenCalledTimes(2);
    expect(state()).toMatchObject({ phase: "idle", error: null });
  });

  it("shows the server's reason when a sync fails any other way", async () => {
    const { api, account, state } = setup();
    api.syncOnce.mockRejectedValueOnce(new ApiError("Something went wrong.", 500));
    await account.start();
    expect(state()).toMatchObject({ user: USER, phase: "error", error: "Something went wrong." });
  });

  it("syncs on becoming visible only once the last sync is more than five minutes old", async () => {
    const { api, account } = setup();
    await account.start();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    account.refreshIfStale();
    await settle();
    expect(api.syncOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    account.refreshIfStale();
    await settle();
    expect(api.syncOnce).toHaveBeenCalledTimes(2);
  });

  it("refreshes the screens after a sync that changed local data, and after recovering from a failed one", async () => {
    const { api, repo, account, onPulled } = setup();
    api.syncOnce.mockResolvedValueOnce(page({ records: [{ kind: "trial", record: trial("t1") }] }));
    await account.start();
    expect(await repo.all()).toEqual([trial("t1")]);
    expect(onPulled).toHaveBeenCalledTimes(1);

    await account.syncNow();
    expect(onPulled).toHaveBeenCalledTimes(1);

    // A failed sync may have applied a page before failing, so the next success refreshes even with nothing new.
    api.syncOnce.mockRejectedValueOnce(new OfflineError());
    await account.syncNow();
    await account.syncNow();
    expect(onPulled).toHaveBeenCalledTimes(2);
  });

  it("signs out without touching local practice, and ignores a sync still in flight", async () => {
    const { api, repo, account, state } = setup();
    await repo.save(trial("t1"));
    const slow = deferred<SyncResponse>();
    api.syncOnce.mockReturnValueOnce(slow.promise);
    api.logout.mockResolvedValueOnce({ logoutUrl: "https://auth.example/logout" });

    void account.start();
    await settle();
    expect(state().phase).toBe("syncing");
    expect(await account.signOut()).toEqual({ logoutUrl: "https://auth.example/logout" });

    slow.resolve(page());
    await settle();
    expect(state()).toMatchObject({ user: null, phase: "signed-out", lastSyncedAt: null });
    expect(await repo.all()).toEqual([trial("t1")]);
  });

  it("forgets this device's sync bookkeeping when the account is deleted", async () => {
    const { account, repo, store, state } = setup();
    await account.start();
    expect([...store.map.keys()]).toEqual(["vc-last-synced:u1"]);
    expect(await repo.loadLedger("u1")).toBeDefined();

    await account.deleteAccount();
    expect(store.map.size).toBe(0);
    expect(await repo.loadLedger("u1")).toBeUndefined();
    expect(state().phase).toBe("signed-out");
  });

  it("signs out, touching nothing, when another tab has signed this browser in to a different account", async () => {
    const { api, repo, account, state } = setup();
    api.syncOnce.mockResolvedValueOnce(page({ userId: "u2", records: [{ kind: "trial", record: trial("t9") }], cursor: 50 }));
    await account.start();
    expect(state()).toMatchObject({ user: null, phase: "signed-out" });
    expect(await repo.all()).toEqual([]);
    expect(await repo.loadLedger("u1")).toBeUndefined();
  });

  it("signs out when an account request finds the session gone, and still fails for the caller", async () => {
    const { api, account, state } = setup();
    await account.start();
    api.exportAccount.mockRejectedValueOnce(new SignedOutError("Sign in to sync."));
    await expect(account.exportAccount()).rejects.toBeInstanceOf(SignedOutError);
    expect(state().phase).toBe("signed-out");
  });

  it("drops a waiting sync on stop", async () => {
    const { api, account } = setup();
    await account.start();
    account.scheduleSync();
    account.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.syncOnce).toHaveBeenCalledTimes(1);
  });

  it("checks for the account again after a save when it couldn't be reached at load", async () => {
    const { api, account, state } = setup();
    api.me.mockRejectedValueOnce(new ApiError("Too many requests.", 429));
    await account.start();
    expect(state()).toMatchObject({ user: null, phase: "offline" });

    account.scheduleSync();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(state()).toMatchObject({ user: USER, phase: "idle" });
    expect(api.syncOnce).toHaveBeenCalledTimes(1);
  });

  describe("clearing local data", () => {
    it("brings a signed-in account's copy straight back, pulling from the start", async () => {
      const { api, repo, account, onPulled } = setup();
      api.syncOnce.mockResolvedValueOnce(page({ records: [{ kind: "trial", record: trial("t1") }], cursor: 3 }));
      await account.start();
      api.syncOnce.mockClear().mockResolvedValueOnce(page({ records: [{ kind: "trial", record: trial("t1") }], cursor: 3 }));

      await account.clearLocalData();
      expect(api.syncOnce.mock.calls.map(([body]) => body.cursor)).toEqual([0]);
      expect(await repo.all()).toEqual([trial("t1")]);
      expect(onPulled).toHaveBeenCalledTimes(3); // the first pull, the wipe, the pull back
    });

    it("while signed out, still brings the whole account back at the next sign-in", async () => {
      const { api, repo, account } = setup();
      api.syncOnce.mockResolvedValueOnce(page({ records: [{ kind: "trial", record: trial("t1") }], cursor: 3 }));
      await account.start();
      await account.signOut();
      api.syncOnce.mockClear();

      await account.clearLocalData();
      expect(api.syncOnce).not.toHaveBeenCalled();
      expect(await repo.all()).toEqual([]);

      api.syncOnce.mockResolvedValueOnce(page({ records: [{ kind: "trial", record: trial("t1") }], cursor: 3 }));
      await account.start();
      expect(api.syncOnce.mock.calls.map(([body]) => body.cursor)).toEqual([0]);
      expect(await repo.all()).toEqual([trial("t1")]);
    });

    it("disowns a sync in flight, whose ledger predates the wipe, and syncs again from the start", async () => {
      const { api, repo, account, state } = setup();
      api.syncOnce.mockResolvedValueOnce(page({ records: [{ kind: "trial", record: trial("t1") }], cursor: 3 }));
      await account.start();
      const slow = deferred<SyncResponse>();
      api.syncOnce.mockClear().mockReturnValueOnce(slow.promise);
      void account.syncNow();
      await settle();

      const cleared = account.clearLocalData();
      await settle();
      slow.resolve(page({ records: [{ kind: "trial", record: trial("t2") }], cursor: 5 }));
      await cleared;
      await settle();

      expect(api.syncOnce.mock.calls.map(([body]) => body.cursor)).toEqual([3, 0]);
      expect(await repo.loadLedger("u1")).toMatchObject({ cursor: 1 });
      expect(state().phase).toBe("idle");
    });
  });
});
