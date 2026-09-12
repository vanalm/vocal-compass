import { describe, expect, it } from "vitest";
import { phraseProgress } from "../src/core/phrase/progression";
import type { PhraseRecord } from "../src/core/types";

const rec = (guide: PhraseRecord["guide"], accuracy: number, verified = false): PhraseRecord =>
  ({
    id: Math.random().toString(),
    createdAt: "2026-09-10T10:00:00.000Z",
    phraseId: "p1",
    role: "melody",
    guide,
    verified,
    sequenceAccuracy: accuracy,
  }) as PhraseRecord;

describe("phraseProgress", () => {
  it("starts on the full guide", () => {
    expect(phraseProgress([], "p1", "melody").guide).toBe("full");
  });

  it("fades the guide a step after a pass (>= 80%)", () => {
    expect(phraseProgress([rec("full", 0.8)], "p1", "melody").guide).toBe("anchor");
    expect(phraseProgress([rec("full", 0.9), rec("anchor", 0.85)], "p1", "melody").guide).toBe("none");
  });

  it("a failing attempt does not fade the guide", () => {
    expect(phraseProgress([rec("full", 0.6)], "p1", "melody").guide).toBe("full");
  });

  it("stays at none once earned and reports the best verified accuracy", () => {
    const records = [rec("full", 0.9), rec("anchor", 0.9), rec("none", 0.7, true), rec("none", 0.85, true)];
    const p = phraseProgress(records, "p1", "melody");
    expect(p.guide).toBe("none");
    expect(p.bestVerified).toBeCloseTo(0.85, 5);
  });

  it("progress is scoped per phrase and role", () => {
    const other = { ...rec("full", 1), phraseId: "p2" } as PhraseRecord;
    expect(phraseProgress([other], "p1", "melody").guide).toBe("full");
  });
});
