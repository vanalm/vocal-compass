import type { ExerciseSession, PhraseRecord, RangeMeasurement, Tombstone, TrialRecord } from "../types";
import { buildExportJson, importInto, type TrialRepository } from "./TrialRepository";

const DB_NAME = "vocal-compass";
// v2 ranges; v3 sessions; v4 tombstones; v5 phrases; v7 sync ledgers. Development builds briefly opened
// v6 without the ledger store, so ledgers take 7: the upgrade adds whatever is missing either way.
const DB_VERSION = 7;
const LEDGERS = "syncLedgers"; // keyed by user id
const PHRASES = "phrases";
const TOMBSTONES = "tombstones";
const SESSIONS = "sessions";
const TRIALS = "trials";
const RANGES = "ranges";

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
          if (!db.objectStoreNames.contains(TRIALS)) {
            const store = db.createObjectStore(TRIALS, { keyPath: "id" });
            store.createIndex("createdAt", "createdAt");
          }
          if (!db.objectStoreNames.contains(RANGES)) {
            const store = db.createObjectStore(RANGES, { keyPath: "id" });
            store.createIndex("createdAt", "createdAt");
          }
          if (!db.objectStoreNames.contains(SESSIONS)) {
            const store = db.createObjectStore(SESSIONS, { keyPath: "id" });
            store.createIndex("createdAt", "createdAt");
          }
          if (!db.objectStoreNames.contains(TOMBSTONES)) {
            const store = db.createObjectStore(TOMBSTONES, { keyPath: "id" });
            store.createIndex("createdAt", "createdAt");
          }
          if (!db.objectStoreNames.contains(PHRASES)) {
            const store = db.createObjectStore(PHRASES, { keyPath: "id" });
            store.createIndex("createdAt", "createdAt");
          }
          if (!db.objectStoreNames.contains(LEDGERS)) db.createObjectStore(LEDGERS);
        };
        request.onsuccess = () => {
          const db = request.result;
          // A newer version of the app in another tab needs to upgrade: let it, rather than block it until this tab closes.
          db.onversionchange = () => db.close();
          resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
      });
    }
    return this.dbPromise;
  }

  private async tx<T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
  }

  async save(record: TrialRecord): Promise<void> {
    await this.tx(TRIALS, "readwrite", (store) => store.put(record));
  }

  async all(): Promise<TrialRecord[]> {
    const records = await this.tx<TrialRecord[]>(TRIALS, "readonly", (store) => store.getAll());
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveRange(measurement: RangeMeasurement): Promise<void> {
    await this.tx(RANGES, "readwrite", (store) => store.put(measurement));
  }

  async ranges(): Promise<RangeMeasurement[]> {
    const records = await this.tx<RangeMeasurement[]>(RANGES, "readonly", (store) => store.getAll());
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveSession(session: ExerciseSession): Promise<void> {
    await this.tx(SESSIONS, "readwrite", (store) => store.put(session));
  }

  async sessions(): Promise<ExerciseSession[]> {
    const rows = await this.tx<ExerciseSession[]>(SESSIONS, "readonly", (store) => store.getAll());
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async savePhrase(record: PhraseRecord): Promise<void> {
    await this.tx(PHRASES, "readwrite", (store) => store.put(record));
  }

  async phrases(): Promise<PhraseRecord[]> {
    const rows = await this.tx<PhraseRecord[]>(PHRASES, "readonly", (store) => store.getAll());
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteTrial(id: string): Promise<void> {
    await this.applyTombstone({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      kind: "trial",
      recordId: id,
    });
  }

  async applyTombstone(stone: Tombstone): Promise<void> {
    const existing = await this.tombstones();
    if (!existing.some((s) => s.kind === stone.kind && s.recordId === stone.recordId)) {
      await this.tx(TOMBSTONES, "readwrite", (store) => store.put(stone));
    }
    const storeName =
      stone.kind === "trial"
        ? TRIALS
        : stone.kind === "range"
          ? RANGES
          : stone.kind === "phrase"
            ? PHRASES
            : SESSIONS;
    await this.tx(storeName, "readwrite", (store) => store.delete(stone.recordId));
  }

  async tombstones(): Promise<Tombstone[]> {
    const rows = await this.tx<Tombstone[]>(TOMBSTONES, "readonly", (store) => store.getAll());
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  loadLedger(userId: string): Promise<unknown> {
    return this.tx(LEDGERS, "readonly", (store) => store.get(userId));
  }

  async saveLedger(userId: string, ledger: unknown): Promise<void> {
    await this.tx(LEDGERS, "readwrite", (store) => store.put(ledger, userId));
  }

  async forgetLedger(userId: string): Promise<void> {
    await this.tx(LEDGERS, "readwrite", (store) => store.delete(userId));
  }

  async clear(): Promise<void> {
    await this.tx(TRIALS, "readwrite", (store) => store.clear());
    await this.tx(RANGES, "readwrite", (store) => store.clear());
    await this.tx(SESSIONS, "readwrite", (store) => store.clear());
    await this.tx(PHRASES, "readwrite", (store) => store.clear());
    await this.tx(TOMBSTONES, "readwrite", (store) => store.clear());
    await this.tx(LEDGERS, "readwrite", (store) => store.clear());
  }

  async exportJson(): Promise<string> {
    return buildExportJson(
      await this.all(),
      await this.ranges(),
      await this.sessions(),
      await this.phrases(),
      await this.tombstones(),
    );
  }

  async importJson(json: string): Promise<number> {
    return importInto(this, json);
  }
}
