import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbTrialRepository } from "../src/core/storage/IndexedDbTrialRepository";
import { MemoryTrialRepository, type TrialRepository } from "../src/core/storage/TrialRepository";
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
