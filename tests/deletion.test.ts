import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbTrialRepository } from "../src/core/storage/IndexedDbTrialRepository";
import { MemoryTrialRepository, type TrialRepository } from "../src/core/storage/TrialRepository";
import { SyncClient, type KeyValueStore } from "../src/core/sync/SyncClient";
import type { TrialRecord } from "../src/core/types";

const trial = (id: string): TrialRecord =>
  ({ id, createdAt: "2026-09-01T10:00:00.000Z" }) as TrialRecord;

const cases: Array<[string, () => TrialRepository]> = [
  ["memory", () => new MemoryTrialRepository()],
  ["indexeddb", () => new IndexedDbTrialRepository()],
];

describe("trial deletion with tombstones", () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
  });

  it.each(cases)("%s: deleteTrial removes the record and leaves a tombstone", async (_, make) => {
    const repo = make();
    await repo.save(trial("t1"));
    await repo.save(trial("t2"));
    await repo.deleteTrial("t1");
    expect((await repo.all()).map((t) => t.id)).toEqual(["t2"]);
    const stones = await repo.tombstones();
    expect(stones).toHaveLength(1);
    expect(stones[0].kind).toBe("trial");
    expect(stones[0].recordId).toBe("t1");
  });

  it.each(cases)("%s: a tombstoned record cannot come back through importJson", async (_, make) => {
    const repo = make();
    await repo.save(trial("t1"));
    const backup = await repo.exportJson(); // contains t1, no tombstone
    await repo.deleteTrial("t1");
    await repo.importJson(backup);
    expect(await repo.all()).toEqual([]);
  });

  it.each(cases)("%s: tombstones survive export/import", async (_, make) => {
    const repo = make();
    await repo.save(trial("t1"));
    await repo.deleteTrial("t1");
    const restored = make();
    await restored.importJson(await repo.exportJson());
    expect((await restored.tombstones()).map((s) => s.recordId)).toEqual(["t1"]);
  });

  it.each(cases)("%s: applyTombstone deletes a matching local record", async (_, make) => {
    const repo = make();
    await repo.save(trial("t1"));
    await repo.applyTombstone({ id: "x", createdAt: "2026-09-02T00:00:00.000Z", kind: "trial", recordId: "t1" });
    expect(await repo.all()).toEqual([]);
    expect((await repo.tombstones()).map((s) => s.recordId)).toEqual(["t1"]);
  });
});

describe("sync with tombstones", () => {
  function memoryStore(): KeyValueStore {
    const map = new Map<string, string>();
    return { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v), remove: (k) => void map.delete(k) };
  }
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("pushes tombstones, applies server tombstones, and never re-imports the dead", async () => {
    const fetchFn = vi.fn();
    const client = new SyncClient("http://s.test", { fetchFn: fetchFn as unknown as typeof fetch, storage: memoryStore() });
    const repo = new MemoryTrialRepository();
    fetchFn.mockResolvedValueOnce(jsonResponse(200, { sent: true, dev_code: "1" }));
    await client.requestCode("a@b.c");
    fetchFn.mockResolvedValueOnce(jsonResponse(200, { token: "tok", email: "a@b.c" }));
    await client.verify("a@b.c", "1");

    await repo.save(trial("keep"));
    await repo.save(trial("dead-local"));
    await repo.deleteTrial("dead-local");

    // Server still holds dead-local + dead-remote, and a tombstone for dead-remote.
    fetchFn.mockResolvedValueOnce(
      jsonResponse(200, {
        trials: [trial("keep"), trial("dead-remote")],
        ranges: [],
        sessions: [],
        tombstones: [
          { id: "st1", createdAt: "2026-09-02T00:00:00.000Z", kind: "trial", recordId: "dead-remote" },
        ],
      }),
    );
    await client.sync(repo);

    const [, init] = fetchFn.mock.calls[2];
    const body = JSON.parse(init.body);
    expect(body.trials.map((t: TrialRecord) => t.id)).toEqual(["keep"]);
    expect(body.tombstones.map((s: { recordId: string }) => s.recordId)).toEqual(["dead-local"]);
    expect((await repo.all()).map((t) => t.id)).toEqual(["keep"]);
    expect((await repo.tombstones()).map((s) => s.recordId).sort()).toEqual(["dead-local", "dead-remote"]);
  });
});
