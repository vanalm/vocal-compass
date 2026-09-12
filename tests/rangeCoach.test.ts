import { describe, expect, it } from "vitest";
import { coachTip, resultLine, summarizeRangeWalk } from "../src/core/pitch/rangeCoach";
import type { RangeWalkSnapshot } from "../src/core/pitch/RangeWalk";
import type { RangeStepResult } from "../src/core/types";

const step = (partial: Partial<RangeStepResult>): RangeStepResult => ({
  targetMidi: 57,
  direction: "down",
  attempt: 1,
  hit: true,
  octaveOff: null,
  sungMidi: 57,
  centsOff: 0,
  timeToMatchMs: 900,
  startedAt: 0,
  endedAt: 900,
  ...partial,
});

const snap = (partial: Partial<RangeWalkSnapshot>): RangeWalkSnapshot => ({
  direction: "down",
  phase: "listen",
  targetMidi: 56,
  anchorMidi: 57,
  lowMidi: 57,
  highMidi: 57,
  attempt: 1,
  holdProgress: 0,
  readyProgress: 0,
  singProgress: 0,
  lastResult: null,
  endedAtLimit: false,
  steps: [],
  ...partial,
});

describe("resultLine — what just happened, in plain words", () => {
  it("a hit close to centre says on pitch", () => {
    expect(resultLine(step({ centsOff: 6 }))).toMatch(/got it.*on pitch/i);
  });
  it("a hit off centre says by how much", () => {
    expect(resultLine(step({ centsOff: 30 }))).toMatch(/30¢ sharp/);
    expect(resultLine(step({ centsOff: -40 }))).toMatch(/40¢ flat/);
  });
  it("silence says no steady note", () => {
    expect(resultLine(step({ hit: false, sungMidi: null, centsOff: null }))).toMatch(/no steady note/i);
  });
  it("the wrong octave is named as such", () => {
    expect(resultLine(step({ hit: false, octaveOff: 1, sungMidi: 69, centsOff: 1200 }))).toMatch(/octave higher/i);
    expect(resultLine(step({ hit: false, octaveOff: -1, sungMidi: 45, centsOff: -1200 }))).toMatch(/octave lower/i);
  });
  it("a far miss counts semitones", () => {
    expect(resultLine(step({ hit: false, sungMidi: 54, centsOff: -300 }))).toMatch(/3 semitones lower/);
  });
  it("a miss at the right pitch that never held steady says so — never '0¢ flat'", () => {
    // Found with real audio: on pitch at C2 but dropping out near the detector floor.
    const line = resultLine(step({ hit: false, sungMidi: 57.02, centsOff: 2 }));
    expect(line).toMatch(/right note/i);
    expect(line).toMatch(/steady/i);
    expect(line).not.toMatch(/¢/);
  });

  it("a near miss counts cents", () => {
    expect(resultLine(step({ hit: false, sungMidi: 56, centsOff: -100 }))).toMatch(/close.*100¢ flat/i);
  });
});

describe("coachTip — one thing to try next", () => {
  it("the starting note is about matching pitch, not volume", () => {
    expect(coachTip(snap({ direction: "anchor", targetMidi: 57 }))).toMatch(/pitch, not the volume/i);
  });
  it("going down: relax; near the bottom: breathy still counts", () => {
    expect(coachTip(snap({ direction: "down", targetMidi: 55 }))).toMatch(/relax your jaw/i);
    expect(coachTip(snap({ direction: "down", targetMidi: 49 }))).toMatch(/breathy or gravelly/i);
  });
  it("going up: lighter first, then register change, then stop at tightness", () => {
    expect(coachTip(snap({ direction: "up", targetMidi: 58 }))).toMatch(/lighter, not louder/i);
    expect(coachTip(snap({ direction: "up", targetMidi: 62 }))).toMatch(/register/i);
    expect(coachTip(snap({ direction: "up", targetMidi: 67 }))).toMatch(/tight or scratchy/i);
  });
  it("a right-pitch miss is coached to hold steadier, not to move the pitch", () => {
    const tip = coachTip(
      snap({
        phase: "result",
        targetMidi: 57,
        lastResult: step({ hit: false, targetMidi: 57, sungMidi: 57.1, centsOff: 10 }),
      }),
    );
    expect(tip).toMatch(/steady|hold/i);
    expect(tip).not.toMatch(/higher|lower/i);
  });

  it("after a miss, the tip targets the mistake", () => {
    const miss = (r: Partial<RangeStepResult>, s: Partial<RangeWalkSnapshot> = {}) =>
      coachTip(snap({ phase: "result", lastResult: step({ hit: false, ...r }), ...s }));
    expect(miss({ octaveOff: 1, sungMidi: 68, centsOff: 1200 })).toMatch(/octave/i);
    expect(miss({ sungMidi: 56.5, centsOff: 150 }, { targetMidi: 55 })).toMatch(/lower/i);
    expect(miss({ sungMidi: 54, centsOff: -100 })).toMatch(/higher/i);
    expect(miss({ sungMidi: null, centsOff: null })).toMatch(/vowel/i);
    expect(miss({ sungMidi: null, centsOff: null }, { attempt: 2 })).toMatch(/may be your edge/i);
  });
});

describe("summarizeRangeWalk — what the walk taught you", () => {
  it("returns null when nothing was matched", () => {
    expect(summarizeRangeWalk([step({ hit: false, sungMidi: null, centsOff: null })])).toBeNull();
  });

  it("takes the range from hits only", () => {
    const summary = summarizeRangeWalk([
      step({ targetMidi: 57 }),
      step({ targetMidi: 52 }),
      step({ targetMidi: 50, hit: false }),
      step({ targetMidi: 63, direction: "up" }),
    ])!;
    expect([summary.lowMidi, summary.highMidi, summary.spanSemitones]).toEqual([52, 63, 11]);
  });

  it("finds the easiest five-note stretch by how fast you matched", () => {
    const steps = Array.from({ length: 11 }, (_, i) =>
      step({ targetMidi: 50 + i, timeToMatchMs: 50 + i >= 53 && 50 + i <= 57 ? 400 : 1500 }),
    );
    const summary = summarizeRangeWalk(steps)!;
    expect(summary.easiest).toEqual({ lowMidi: 53, highMidi: 57 });
    expect(summary.insights.join(" ")).toMatch(/easiest/i);
  });

  it("reports no easiest stretch without five consecutive matched notes", () => {
    const summary = summarizeRangeWalk([step({ targetMidi: 57 }), step({ targetMidi: 59 })])!;
    expect(summary.easiest).toBeNull();
  });

  it("names a pitch tendency at the edges when it is large enough to act on", () => {
    const steps = Array.from({ length: 8 }, (_, i) =>
      step({ targetMidi: 50 + i, centsOff: i >= 5 ? -30 : 0 }),
    );
    expect(summarizeRangeWalk(steps)!.insights.join(" ")).toMatch(/highest.*flat/i);
  });

  it("mentions wrong-octave answers", () => {
    const summary = summarizeRangeWalk([
      step({ targetMidi: 57 }),
      step({ targetMidi: 56, hit: false, octaveOff: 1, sungMidi: 68, centsOff: 1200 }),
    ])!;
    expect(summary.insights.join(" ")).toMatch(/octave/i);
  });
});
