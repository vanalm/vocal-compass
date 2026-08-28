import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbTrialRepository } from "../src/core/storage/IndexedDbTrialRepository";
import { MemoryTrialRepository, type TrialRepository } from "../src/core/storage/TrialRepository";
import type { RangeMeasurement } from "../src/core/types";

const measurement = (id: string, createdAt: string): RangeMeasurement => ({
  id,
  createdAt,
  lowMidi: 45.2,
  highMidi: 69.8,
});

function repositoryCases(): Array<[string, () => TrialRepository]> {
  return [
    ["memory", () => new MemoryTrialRepository()],
    ["indexeddb", () => new IndexedDbTrialRepository()],
  ];
}

describe("range measurement storage", () => {
  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh database per test
  });

  it.each(repositoryCases())("%s: saves and lists measurements sorted by time", async (_, make) => {
    const repo = make();
    await repo.saveRange(measurement("b", "2026-08-21T10:00:00.000Z"));
    await repo.saveRange(measurement("a", "2026-08-20T10:00:00.000Z"));
    const ranges = await repo.ranges();
    expect(ranges.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it.each(repositoryCases())("%s: round-trips measurements through export/import", async (_, make) => {
    const repo = make();
    await repo.saveRange(measurement("a", "2026-08-20T10:00:00.000Z"));
    const json = await repo.exportJson();

    const restored = make();
    await restored.importJson(json);
    expect((await restored.ranges()).map((r) => r.id)).toEqual(["a"]);
  });

  it.each(repositoryCases())("%s: imports a v1 payload with no ranges field", async (_, make) => {
    const repo = make();
    const imported = await repo.importJson(
      JSON.stringify({ app: "vocal-compass", version: 1, trials: [] }),
    );
    expect(imported).toBe(0);
    expect(await repo.ranges()).toEqual([]);
  });

  it.each(repositoryCases())("%s: clear removes measurements too", async (_, make) => {
    const repo = make();
    await repo.saveRange(measurement("a", "2026-08-20T10:00:00.000Z"));
    await repo.clear();
    expect(await repo.ranges()).toEqual([]);
  });
});
