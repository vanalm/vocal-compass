import { describe, expect, it } from "vitest";
import { TrialSession } from "../src/core/trial/TrialSession";
import { exercises } from "../src/core/exercises/registry";
import type { PitchSample } from "../src/core/types";

function makeSession(nowRef: { t: number }) {
  const trial = exercises.get("route").createTrial({
    difficulty: "steps",
    delayMs: 0,
    random: () => 0.3,
  });
  return new TrialSession(trial, "commit", undefined, () => nowRef.t);
}

function voicedSample(midi: number, at: number): PitchSample {
  return { at, hz: 0, midi, clarity: 0.9, rms: 0.05 };
}

describe("TrialSession state machine", () => {
  it("walks listen → imagine → sing → review and records latency", () => {
    const now = { t: 1000 };
    const session = makeSession(now);
    session.beginListening();
    session.beginImagining();
    now.t = 2000;
    session.beginSinging();
    for (let i = 0; i < 8; i += 1) {
      session.addSample(voicedSample(session.definition.targetMidi, 2400 + i * 80));
    }
    session.finishSinging();
    const record = session.toRecord();
    expect(record.selectionLatencyMs).toBe(400);
    expect(record.scored).toBe(true);
    expect(record.hintLevel).toBe(0);
    expect(record.lostEvent).toBe(false);
  });

  it("keeps the go-signal, every frame's level (voiced or not), and the mic it was sung on", () => {
    const now = { t: 1000 };
    const session = makeSession(now);
    session.micLowCut = "80";
    session.micInput = "USB mic";
    session.beginListening();
    session.beginImagining();
    session.addFrame({ raw: null, smoothed: null, level: 0.5 }); // before the go: not part of the attempt
    now.t = 2000;
    session.beginSinging();
    now.t = 2070;
    session.addFrame({ raw: null, smoothed: null, level: 0.0012345 });
    now.t = 2140;
    const sung = voicedSample(session.definition.targetMidi, 2140);
    session.addFrame({ raw: sung, smoothed: sung, level: 0.05 });
    for (let i = 1; i < 6; i += 1) session.addSample(voicedSample(session.definition.targetMidi, 2140 + i * 70));
    session.finishSinging();
    const record = session.toRecord();
    expect(record.goAt).toBe(2000);
    expect(record.levels).toEqual([
      { t: 2070, rms: 0.00123 },
      { t: 2140, rms: 0.05 },
    ]);
    expect(record.micLowCut).toBe("80");
    expect(record.micInput).toBe("USB mic");
  });

  it("rejects out-of-order transitions", () => {
    const session = makeSession({ t: 0 });
    expect(() => session.beginSinging()).toThrow();
    expect(() => session.toRecord()).toThrow();
  });

  it("tracks rescue level, lost event, and recovery time", () => {
    const now = { t: 0 };
    const session = makeSession(now);
    session.beginListening();
    session.beginImagining();
    now.t = 100;
    session.beginSinging();
    now.t = 500;
    session.markLost();
    session.useRescue(1);
    session.useRescue(3);
    session.useRescue(2); // ladder keeps the highest level used
    for (let i = 0; i < 6; i += 1) {
      session.addSample(voicedSample(session.definition.targetMidi, 2500 + i * 80));
    }
    session.finishSinging();
    const record = session.toRecord();
    expect(record.hintLevel).toBe(3);
    expect(record.lostEvent).toBe(true);
    expect(record.recoveryTimeMs).toBe(2000); // 2500 (first voiced) - 500 (lost)
  });

  it("intent confirmation flows into the final label", () => {
    const now = { t: 0 };
    const session = makeSession(now);
    session.beginListening();
    session.beginImagining();
    session.beginSinging();
    const wrong = session.definition.targetMidi + 1;
    for (let i = 0; i < 6; i += 1) session.addSample(voicedSample(wrong, i * 80));
    session.finishSinging();
    expect(session.needsIntentConfirmation()).toBe(true);
    session.confirmIntent("landing-miss");
    expect(session.toRecord().finalErrorKind).toBe("landing");
  });

  it("ignores samples outside the sing phase", () => {
    const session = makeSession({ t: 0 });
    session.addSample(voicedSample(60, 0));
    session.beginListening();
    session.addSample(voicedSample(60, 10));
    session.beginImagining();
    session.beginSinging();
    session.finishSinging();
    expect(session.currentAnalysis?.scored).toBe(false);
  });
});

describe("volume data in the trace", () => {
  it("keeps each sample's rms so loudness is analyzable later", () => {
    const now = { t: 1000 };
    const session = makeSession(now);
    session.beginListening();
    session.beginImagining();
    session.beginSinging();
    session.addSample({ at: 1200, hz: 220, midi: 57, clarity: 0.9, rms: 0.042 });
    session.finishSinging();
    const record = session.toRecord();
    expect(record.trace[0].rms).toBeCloseTo(0.042, 5);
  });
});
