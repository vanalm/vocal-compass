import { describe, expect, it } from "vitest";
import { SILENT_LEVEL, describeMicError, evaluateMicCheck, type MicCheckSample } from "../src/core/pitch/micInput";

/** Frames 70 ms apart, as the microphone engine polls them. */
function frames(count: number, make: (i: number) => Partial<MicCheckSample>): MicCheckSample[] {
  return Array.from({ length: count }, (_, i) => ({ at: i * 70, level: 0.01, midi: null, ...make(i) }));
}

describe("evaluateMicCheck", () => {
  it("keeps listening before anything conclusive", () => {
    expect(evaluateMicCheck([])).toEqual({ kind: "listening" });
    expect(evaluateMicCheck(frames(10, () => ({ level: 0 })))).toEqual({ kind: "listening" });
  });

  it("passes on a steady note and names it", () => {
    const sung = frames(20, (i) => (i >= 10 ? { midi: 57.1 + (i % 2) * 0.2 } : {}));
    expect(evaluateMicCheck(sung)).toEqual({ kind: "ok", midi: 57 });
  });

  it("needs the note held, not a blip", () => {
    const blips = frames(40, (i) => (i % 4 === 0 ? { midi: 57 } : {}));
    expect(evaluateMicCheck(blips).kind).toBe("listening");
  });

  it("a wandering pitch is not yet a steady note", () => {
    const sliding = frames(20, (i) => ({ midi: 50 + i * 0.4 }));
    expect(evaluateMicCheck(sliding).kind).toBe("listening");
  });

  it("calls digital silence after a couple of seconds", () => {
    expect(evaluateMicCheck(frames(40, () => ({ level: SILENT_LEVEL / 4 })))).toEqual({ kind: "silent" });
  });

  it("room sound is not silence; with no note for a while it asks for one", () => {
    expect(evaluateMicCheck(frames(40, () => ({ level: 0.003 }))).kind).toBe("listening");
    expect(evaluateMicCheck(frames(130, () => ({ level: 0.003 })))).toEqual({ kind: "no-note" });
  });
});

describe("describeMicError", () => {
  const named = (name: string) => Object.assign(new Error("raw"), { name });

  it("says how to unblock a denied permission", () => {
    expect(describeMicError(named("NotAllowedError"))).toMatch(/address bar.*System Settings/);
  });

  it("covers a missing device and a busy one", () => {
    expect(describeMicError(named("NotFoundError"))).toMatch(/No microphone/);
    expect(describeMicError(named("NotReadableError"))).toMatch(/Another app/);
  });

  it("falls back to the error's own message", () => {
    expect(describeMicError(new Error("Web Audio is unavailable."))).toBe("Web Audio is unavailable.");
    expect(describeMicError("?")).toBe("Microphone access failed.");
  });
});
