import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbTrialRepository } from "../src/core/storage/IndexedDbTrialRepository";
import { MemoryTrialRepository, type TrialRepository } from "../src/core/storage/TrialRepository";
import type { PhraseRecord } from "../src/core/types";

const record = (id: string, createdAt: string): PhraseRecord => ({
  id,
  createdAt,
  phraseId: "l1-arc-13531",
  phraseName: "Arc",
  level: 1,
  keyTonicMidi: 57,
  bpm: 90,
  role: "melody",
  guide: "full",
  verified: false,
  hits: 4,
  misses: 1,
  extras: 0,
  sequenceAccuracy: 0.8,
  meanAbsOnsetMs: 60,
  landingHit: true,
  trace: [{ t: 0, midi: 57, clarity: 0.9, rms: 0.04 }],
});

const cases: Array<[string, () => TrialRepository]> = [
  ["memory", () => new MemoryTrialRepository()],
  ["indexeddb", () => new IndexedDbTrialRepository()],
];

describe("phrase record storage", () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
  });

  it.each(cases)("%s: saves, upserts, lists sorted", async (_, make) => {
    const repo = make();
    await repo.savePhrase(record("b", "2026-09-11T10:00:00.000Z"));
    await repo.savePhrase(record("a", "2026-09-10T10:00:00.000Z"));
    await repo.savePhrase(record("a", "2026-09-10T10:00:00.000Z"));
    expect((await repo.phrases()).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it.each(cases)("%s: round-trips through export/import and clears", async (_, make) => {
    const repo = make();
    await repo.savePhrase(record("a", "2026-09-10T10:00:00.000Z"));
    const restored = make();
    await restored.importJson(await repo.exportJson());
    expect((await restored.phrases()).map((p) => p.id)).toEqual(["a"]);
    await restored.clear();
    expect(await restored.phrases()).toEqual([]);
  });

  it.each(cases)("%s: a phrase tombstone deletes and blocks re-import", async (_, make) => {
    const repo = make();
    await repo.savePhrase(record("a", "2026-09-10T10:00:00.000Z"));
    const backup = await repo.exportJson();
    await repo.applyTombstone({ id: "s1", createdAt: "2026-09-11T00:00:00.000Z", kind: "phrase", recordId: "a" });
    expect(await repo.phrases()).toEqual([]);
    await repo.importJson(backup);
    expect(await repo.phrases()).toEqual([]);
  });

  it.each(cases)("%s: tolerates pre-phrase payloads", async (_, make) => {
    const repo = make();
    await repo.importJson(JSON.stringify({ app: "vocal-compass", version: 4, trials: [], ranges: [], sessions: [], tombstones: [] }));
    expect(await repo.phrases()).toEqual([]);
  });
});
