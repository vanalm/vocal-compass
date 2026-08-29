import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbTrialRepository } from "../src/core/storage/IndexedDbTrialRepository";
import { MemoryTrialRepository, type TrialRepository } from "../src/core/storage/TrialRepository";
import type { ExerciseSession } from "../src/core/types";

const session = (id: string, createdAt: string): ExerciseSession => ({
  id,
  createdAt,
  planId: "vfe",
  stepsCompleted: 4,
});

const cases: Array<[string, () => TrialRepository]> = [
  ["memory", () => new MemoryTrialRepository()],
  ["indexeddb", () => new IndexedDbTrialRepository()],
];

describe("exercise session storage", () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
  });

  it.each(cases)("%s: saves, upserts by id, lists sorted", async (_, make) => {
    const repo = make();
    await repo.saveSession(session("b", "2026-09-02T10:00:00.000Z"));
    await repo.saveSession(session("a", "2026-09-01T10:00:00.000Z"));
    await repo.saveSession(session("a", "2026-09-01T10:00:00.000Z"));
    expect((await repo.sessions()).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it.each(cases)("%s: round-trips sessions through export/import and clears them", async (_, make) => {
    const repo = make();
    await repo.saveSession(session("a", "2026-09-01T10:00:00.000Z"));
    const restored = make();
    await restored.importJson(await repo.exportJson());
    expect((await restored.sessions()).map((s) => s.id)).toEqual(["a"]);
    await restored.clear();
    expect(await restored.sessions()).toEqual([]);
  });

  it.each(cases)("%s: tolerates v2 payloads with no sessions field", async (_, make) => {
    const repo = make();
    await repo.importJson(JSON.stringify({ app: "vocal-compass", version: 2, trials: [], ranges: [] }));
    expect(await repo.sessions()).toEqual([]);
  });
});
