import { describe, expect, it } from "vitest";
import { summarizeTrial } from "../src/core/trial/trialSummary";
import type { TrialDefinition } from "../src/core/types";

const definition = { targetMidi: 64, startMidi: 67, tonicMidi: 60 } as TrialDefinition;
const GO = 1_000;

/** Samples every 70 ms from `startMs` after the go-signal. */
function held(midi: number, startMs: number, frames: number, rms = 0.05) {
  return Array.from({ length: frames }, (_, i) => ({ t: GO + startMs + i * 70, midi, clarity: 0.95, rms }));
}

function summary(trace: ReturnType<typeof held>, extra: { levels?: number; latency?: number | null } = {}) {
  return summarizeTrial({
    trace,
    definition,
    goAt: GO,
    selectionLatencyMs: extra.latency ?? 600,
    levels: extra.levels === undefined ? undefined : Array.from({ length: extra.levels }, (_, i) => ({ t: GO + i * 70, rms: 0.01 })),
  });
}

describe("summarizeTrial — the notes sung", () => {
  it("lists each held note in order with its offset, timing and whether it was the target", () => {
    const result = summary([...held(65.2, 600, 8), ...held(63.9, 1_200, 12)]);
    expect(result.notes).toEqual([
      { midi: 65, name: "F4", centsOff: 20, startMs: 600, durationMs: 560, isTarget: false },
      { midi: 64, name: "E4", centsOff: -10, startMs: 1_200, durationMs: 840, isTarget: true },
    ]);
  });

  it("drops a slide's passing blip, and keeps one note split by it as one note", () => {
    const result = summary([...held(64, 0, 6), ...held(65, 420, 1), ...held(64, 490, 6)]);
    expect(result.notes.map((n) => [n.name, n.durationMs])).toEqual([["E4", 910]]);
  });

  it("times from the first sound when an older record has no go-signal", () => {
    const result = summarizeTrial({ trace: held(64, 500, 6), definition, selectionLatencyMs: null });
    expect(result.notes[0].startMs).toBe(0);
    expect(result.voicedShare).toBeNull();
  });
});

describe("summarizeTrial — steadiness", () => {
  it("a held note with little wobble is steady in pitch and volume", () => {
    const trace = held(64, 0, 10).map((p, i) => ({ ...p, midi: 64 + (i % 2 ? 0.04 : -0.04), rms: i % 2 ? 0.05 : 0.052 }));
    const result = summary(trace);
    expect(result.pitch).toEqual({ spreadCents: 4, steadiness: "steady" });
    expect(result.volume?.steadiness).toBe("steady");
  });

  it("a swelling, fading note is unsteady in volume", () => {
    const trace = held(64, 0, 10).map((p, i) => ({ ...p, rms: i % 2 ? 0.02 : 0.08 }));
    expect(summary(trace).volume?.steadiness).toBe("unsteady");
  });

  it("judges only the longest note, not the slide into it", () => {
    const trace = [...held(60, 0, 3), ...held(64, 210, 12)];
    expect(summary(trace).pitch?.spreadCents).toBe(0);
  });

  it("too little sound to judge gives no verdict", () => {
    const result = summary(held(64, 0, 3));
    expect(result.pitch).toBeNull();
    expect(result.volume).toBeNull();
  });
});

describe("summarizeTrial — the sing window", () => {
  it("reports the voiced share of every frame and the time to first sound", () => {
    const result = summary(held(64, 0, 30), { levels: 60, latency: 450 });
    expect(result.voicedShare).toBe(0.5);
    expect(result.timeToVoiceMs).toBe(450);
  });
});
