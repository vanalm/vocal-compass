import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IndexedDbTrialRepository } from "../src/core/storage/IndexedDbTrialRepository";
import { MemoryTrialRepository } from "../src/core/storage/TrialRepository";
import { exercises } from "../src/core/exercises/registry";
import { TrialSession } from "../src/core/trial/TrialSession";
import type { TrialRecord, TrialRepository } from "../src/core";

function makeRecord(): TrialRecord {
  const trial = exercises.get("route").createTrial({ difficulty: "steps", delayMs: 0 });
  const session = new TrialSession(trial, "blind");
  session.beginListening();
  session.beginImagining();
  session.beginSinging();
  for (let i = 0; i < 6; i += 1) {
    session.addSample({ at: i * 80, hz: 0, midi: trial.targetMidi, clarity: 0.9, rms: 0.05 });
  }
  session.finishSinging();
  return session.toRecord();
}

function repositoryContract(name: string, make: () => TrialRepository) {
  describe(name, () => {
    it("saves, lists, exports, imports, clears", async () => {
      const repo = make();
      await repo.clear();
      const record = makeRecord();
      await repo.save(record);
      const all = await repo.all();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(record.id);

      const json = await repo.exportJson();
      expect(json).toContain(record.id);

      await repo.clear();
      expect(await repo.all()).toHaveLength(0);

      const imported = await repo.importJson(json);
      expect(imported).toBe(1);
      expect(await repo.all()).toHaveLength(1);
    });
  });
}

repositoryContract("MemoryTrialRepository", () => new MemoryTrialRepository());
repositoryContract("IndexedDbTrialRepository", () => new IndexedDbTrialRepository());
