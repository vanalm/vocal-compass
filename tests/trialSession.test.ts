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
