import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbTrialRepository } from "../src/core/storage/IndexedDbTrialRepository";
import { MemoryTrialRepository, type TrialRepository } from "../src/core/storage/TrialRepository";
import { SyncLedger } from "../src/core/sync/SyncLedger";
import type { TrialRecord } from "../src/core/types";

const repositories: Array<[string, () => TrialRepository]> = [
  ["memory", () => new MemoryTrialRepository()],
  ["indexeddb", () => new IndexedDbTrialRepository()],
];

describe.each(repositories)("SyncLedger in the %s repository", (_, make) => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
  });

  it("starts fresh when nothing is saved", async () => {
    const ledger = await SyncLedger.load("u1", make());
    expect(ledger.userId).toBe("u1");
    expect(ledger.cursor).toBe(0);
    expect(ledger.hasSent("trial", "t1")).toBe(false);
  });

  it("saves the cursor and sent ids under the user and loads them back", async () => {
    const repo = make();
    const ledger = await SyncLedger.load("u1", repo);
    ledger.markSent("trial", ["t1", "t2"]);
    ledger.markSent("tombstone", ["s1"]);
    ledger.setCursor(42);
    await ledger.save();

    expect(await repo.loadLedger("u1")).toEqual({
      version: 1,
      cursor: 42,
      sent: { trial: ["t1", "t2"], range: [], session: [], phrase: [], tombstone: ["s1"] },
    });
    const reloaded = await SyncLedger.load("u1", repo);
    expect(reloaded.cursor).toBe(42);
    expect(reloaded.hasSent("trial", "t2")).toBe(true);
    expect(reloaded.hasSent("tombstone", "s1")).toBe(true);
  });

  it("keeps a separate ledger per account, and forgets one without the others", async () => {
    const repo = make();
    const alex = await SyncLedger.load("alex", repo);
    alex.markSent("trial", ["t1"]);
    alex.setCursor(9);
    await alex.save();

    const sam = await SyncLedger.load("sam", repo);
    expect(sam.cursor).toBe(0);
    expect(sam.hasSent("trial", "t1")).toBe(false);
    sam.setCursor(3);
    await sam.save();

    await SyncLedger.forget("sam", repo);
    expect((await SyncLedger.load("alex", repo)).cursor).toBe(9);
    expect((await SyncLedger.load("sam", repo)).cursor).toBe(0);
  });

  it("goes when the records do: clearing local data leaves every account's ledger fresh", async () => {
    const repo = make();
    await repo.save({ id: "t1", createdAt: "2026-09-01T10:00:00.000Z" } as TrialRecord);
    for (const userId of ["alex", "sam"]) {
      const ledger = await SyncLedger.load(userId, repo);
      ledger.markSent("trial", ["t1"]);
      ledger.setCursor(5);
      await ledger.save();
    }

    await repo.clear();
    for (const userId of ["alex", "sam"]) {
      const ledger = await SyncLedger.load(userId, repo);
      expect([ledger.cursor, ledger.hasSent("trial", "t1")]).toEqual([0, false]);
    }
  });
});

describe("SyncLedger in an IndexedDB saved by the version before ledgers", () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
  });

  it("upgrades the database, keeping its records", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("vocal-compass", 5);
      request.onupgradeneeded = () => {
        for (const name of ["trials", "ranges", "sessions", "tombstones", "phrases"]) {
          request.result.createObjectStore(name, { keyPath: "id" }).createIndex("createdAt", "createdAt");
        }
        request.transaction!.objectStore("trials").put({ id: "t1", createdAt: "2026-09-01T10:00:00.000Z" });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const repo = new IndexedDbTrialRepository();
    const ledger = await SyncLedger.load("u1", repo);
    ledger.setCursor(4);
    await ledger.save();
    expect((await SyncLedger.load("u1", repo)).cursor).toBe(4);
    expect((await repo.all()).map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("SyncLedger", () => {
  it("keeps kinds apart: a sent trial id says nothing about a range with the same id", async () => {
    const ledger = await SyncLedger.load("u1", new MemoryTrialRepository());
    ledger.markSent("trial", ["x"]);
    expect(ledger.hasSent("range", "x")).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "{oops"],
    ["another version", { version: 2, cursor: 5, sent: {} }],
    ["a negative cursor", { version: 1, cursor: -1, sent: {} }],
    ["ids that are not strings", { version: 1, cursor: 5, sent: { trial: ["t1", 2] } }],
  ])("starts fresh from a saved ledger that is %s", async (_, saved) => {
    const repo = new MemoryTrialRepository();
    await repo.saveLedger("u1", saved);
    const ledger = await SyncLedger.load("u1", repo);
    expect(ledger.cursor).toBe(0);
    expect(ledger.hasSent("trial", "t1")).toBe(false);
  });

  it("pulls again from the start when saved by a version that didn't know a kind, keeping what was sent", async () => {
    const repo = new MemoryTrialRepository();
    await repo.saveLedger("u1", { version: 1, cursor: 7, sent: { trial: ["t1"], range: [], session: [], tombstone: [] } });
    const ledger = await SyncLedger.load("u1", repo);
    expect(ledger.cursor).toBe(0);
    expect(ledger.hasSent("trial", "t1")).toBe(true);
    expect(ledger.hasSent("phrase", "p1")).toBe(false);
  });

  it("passes on a save that fails, so a full disk stops the sync instead of passing unnoticed", async () => {
    const repo = new MemoryTrialRepository();
    repo.saveLedger = async () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
    const ledger = await SyncLedger.load("u1", repo);
    await expect(ledger.save()).rejects.toThrow("quota");
  });
});
