import { describe, expect, it } from "vitest";
import { RangeWalk } from "../src/core/pitch/RangeWalk";

const OPTS = { matchFrames: 3, toleranceSemitones: 0.75, stepTimeoutMs: 6000 };

/** Feed n matching frames at 70ms spacing; returns last feed result. */
function match(walk: RangeWalk, midi: number, from = 0, n = 3) {
  let result;
  for (let i = 0; i < n; i += 1) result = walk.feed(midi, from + i * 70);
  return result!;
}

describe("RangeWalk", () => {
  it("starts by asking for the anchor tone", () => {
    const walk = new RangeWalk(57, OPTS);
    expect(walk.state.phase).toBe("anchor");
    expect(walk.state.targetMidi).toBe(57);
  });

  it("advances only after enough consecutive matched frames", () => {
    const walk = new RangeWalk(57, OPTS);
    walk.feed(57, 0);
    walk.feed(57.2, 70);
    expect(walk.state.phase).toBe("anchor");
    const result = walk.feed(56.9, 140);
    expect(result.advanced).toBe(true);
    expect(walk.state.phase).toBe("down");
    expect(walk.state.targetMidi).toBe(56);
    expect(result.toneToPlay).toBe(56);
  });

  it("an off-pitch or silent frame resets the consecutive count", () => {
    const walk = new RangeWalk(57, OPTS);
    walk.feed(57, 0);
    walk.feed(57, 70);
    walk.feed(null, 140); // silence
    walk.feed(57, 210);
    walk.feed(57, 280);
    expect(walk.state.phase).toBe("anchor");
    walk.feed(57, 350);
    expect(walk.state.phase).toBe("down");
  });

  it("walks down a semitone per matched step, tracking the floor", () => {
    const walk = new RangeWalk(57, OPTS);
    match(walk, 57);
    match(walk, 56, 300);
    match(walk, 55, 600);
    expect(walk.state.targetMidi).toBe(54);
    expect(walk.state.lowMidi).toBe(55);
  });

  it("skipStep at the floor turns the walk upward from above the anchor", () => {
    const walk = new RangeWalk(57, OPTS);
    match(walk, 57);
    match(walk, 56, 300);
    const result = walk.skipStep();
    expect(walk.state.phase).toBe("up");
    expect(walk.state.targetMidi).toBe(58);
    expect(result.toneToPlay).toBe(58);
    expect(walk.state.lowMidi).toBe(56);
  });

  it("a step timeout also ends the direction", () => {
    const walk = new RangeWalk(57, OPTS);
    match(walk, 57);
    walk.feed(null, 7000); // 6s+ without matching the down target
    expect(walk.state.phase).toBe("up");
  });

  it("skipStep on the way up finishes the walk with both extremes", () => {
    const walk = new RangeWalk(57, OPTS);
    match(walk, 57); // anchor
    match(walk, 56, 300);
    walk.skipStep(); // floor: 56
    match(walk, 58, 900);
    match(walk, 59, 1200);
    const result = walk.skipStep(); // ceiling: 59
    expect(walk.state.phase).toBe("done");
    expect(result.toneToPlay).toBeUndefined();
    expect(walk.state.lowMidi).toBe(56);
    expect(walk.state.highMidi).toBe(59);
  });

  it("exposes match progress for the UI's held-frames indicator", () => {
    const walk = new RangeWalk(57, OPTS);
    expect(walk.state.matchProgress).toBe(0);
    walk.feed(57, 0);
    expect(walk.state.matchProgress).toBeCloseTo(1 / 3, 5);
    walk.feed(57, 70);
    expect(walk.state.matchProgress).toBeCloseTo(2 / 3, 5);
  });

  it("never records an extreme it did not hear matched", () => {
    const walk = new RangeWalk(57, OPTS);
    match(walk, 57);
    walk.skipStep(); // could not go down at all
    walk.skipStep(); // could not go up either
    expect(walk.state.phase).toBe("done");
    expect(walk.state.lowMidi).toBe(57); // anchor was matched
    expect(walk.state.highMidi).toBe(57);
  });
});
