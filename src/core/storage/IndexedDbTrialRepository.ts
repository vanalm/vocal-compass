import type { TrialRecord } from "../types";
import type { TrialRepository } from "./TrialRepository";

const DB_NAME = "vocal-compass";
const DB_VERSION = 1;
const STORE = "trials";

export class IndexedDbTrialRepository implements TrialRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  static isSupported(): boolean {
    return typeof indexedDB !== "undefined";
  }

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: "id" });
            store.createIndex("createdAt", "createdAt");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
      });
    }
    return this.dbPromise;
  }

  private async tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
  }

  async save(record: TrialRecord): Promise<void> {
    await this.tx("readwrite", (store) => store.put(record));
  }

  async all(): Promise<TrialRecord[]> {
    const records = await this.tx<TrialRecord[]>("readonly", (store) => store.getAll());
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async clear(): Promise<void> {
    await this.tx("readwrite", (store) => store.clear());
  }

  async exportJson(): Promise<string> {
    return JSON.stringify({ app: "vocal-compass", version: 1, trials: await this.all() }, null, 2);
  }

  async importJson(json: string): Promise<number> {
    const parsed = JSON.parse(json) as { trials?: TrialRecord[] };
    const trials = parsed.trials ?? [];
    for (const t of trials) await this.save(t);
    return trials.length;
  }
}
