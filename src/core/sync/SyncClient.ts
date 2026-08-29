import type { TrialRepository } from "../storage/TrialRepository";
import type { ExerciseSession, RangeMeasurement, TrialRecord } from "../types";

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const TOKEN_KEY = "vc-sync-token";
const EMAIL_KEY = "vc-sync-email";

function browserStorage(): KeyValueStore {
  return {
    get: (k) => window.localStorage.getItem(k),
    set: (k, v) => window.localStorage.setItem(k, v),
    remove: (k) => window.localStorage.removeItem(k),
  };
}

/**
 * Client for the sync server. Records are immutable, so sync is a union
 * merge: push everything local, save anything the server has that we don't.
 * The session token lives in injected storage (localStorage in the app).
 */
export class SyncClient {
  private readonly fetchFn: typeof fetch;
  private readonly storage: KeyValueStore;

  constructor(
    private readonly baseUrl: string,
    deps: { fetchFn?: typeof fetch; storage?: KeyValueStore } = {},
  ) {
    this.fetchFn = deps.fetchFn ?? ((...args) => fetch(...args));
    this.storage = deps.storage ?? browserStorage();
  }

  get signedInEmail(): string | null {
    return this.storage.get(TOKEN_KEY) ? this.storage.get(EMAIL_KEY) : null;
  }

  async requestCode(email: string): Promise<{ devCode?: string }> {
    const body = await this.post("/auth/request", { email });
    return { devCode: body.dev_code as string | undefined };
  }

  async verify(email: string, code: string): Promise<void> {
    const body = await this.post("/auth/verify", { email, code });
    this.storage.set(TOKEN_KEY, body.token as string);
    this.storage.set(EMAIL_KEY, body.email as string);
  }

  signOut(): void {
    this.storage.remove(TOKEN_KEY);
    this.storage.remove(EMAIL_KEY);
  }

  async sync(repo: TrialRepository): Promise<{ pushed: number; pulled: number }> {
    const token = this.storage.get(TOKEN_KEY);
    if (!token) throw new Error("Not signed in — sign in to sync.");

    const trials = await repo.all();
    const ranges = await repo.ranges();
    const sessions = await repo.sessions();
    const response = await this.fetchFn(`${this.baseUrl}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ trials, ranges, sessions }),
    });
    if (response.status === 401) {
      this.signOut();
      throw new Error("Session expired — sign in again.");
    }
    if (!response.ok) throw new Error(`Sync failed (${response.status}).`);

    const body = (await response.json()) as {
      trials: TrialRecord[];
      ranges: RangeMeasurement[];
      sessions?: ExerciseSession[];
    };
    let pulled = 0;
    const localTrialIds = new Set(trials.map((t) => t.id));
    for (const t of body.trials) {
      if (localTrialIds.has(t.id)) continue;
      await repo.save(t);
      pulled += 1;
    }
    const localRangeIds = new Set(ranges.map((r) => r.id));
    for (const r of body.ranges) {
      if (localRangeIds.has(r.id)) continue;
      await repo.saveRange(r);
      pulled += 1;
    }
    const localSessionIds = new Set(sessions.map((s) => s.id));
    for (const x of body.sessions ?? []) {
      if (localSessionIds.has(x.id)) continue;
      await repo.saveSession(x);
      pulled += 1;
    }
    return { pushed: trials.length + ranges.length + sessions.length, pulled };
  }

  private async post(path: string, payload: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(
        (detail as { detail?: string } | null)?.detail ?? `Request failed (${response.status}).`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
