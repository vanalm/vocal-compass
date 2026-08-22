import { describe, expect, it } from "vitest";
import { NoiseFloorTracker } from "../src/core/pitch/NoiseFloorTracker";

function feed(tracker: NoiseFloorTracker, rms: number, times: number) {
  for (let i = 0; i < times; i += 1) tracker.update(rms);
}

describe("NoiseFloorTracker", () => {
  it("starts at the absolute-minimum threshold (old fixed-gate behavior)", () => {
    const tracker = new NoiseFloorTracker();
    expect(tracker.threshold).toBe(0.008);
    expect(tracker.tooNoisy).toBe(false);
  });

  it("keeps the absolute minimum in a quiet room", () => {
    const tracker = new NoiseFloorTracker();
    feed(tracker, 0.002, 50);
    expect(tracker.threshold).toBe(0.008);
  });

  it("raises the threshold above sustained background noise", () => {
    const tracker = new NoiseFloorTracker();
    feed(tracker, 0.02, 50); // car-interior level
    expect(tracker.floor).toBeCloseTo(0.02, 3);
    expect(tracker.threshold).toBeCloseTo(0.06, 3); // floor * ratio
    expect(tracker.tooNoisy).toBe(false);
  });

  it("ignores loud transients: a door slam does not raise the floor", () => {
    const tracker = new NoiseFloorTracker();
    feed(tracker, 0.002, 40);
    feed(tracker, 0.5, 3);
    expect(tracker.threshold).toBe(0.008);
  });

  it("recovers after the noise stops", () => {
    const tracker = new NoiseFloorTracker();
    feed(tracker, 0.02, 50);
    feed(tracker, 0.002, 50);
    expect(tracker.threshold).toBe(0.008);
  });

  it("flags tooNoisy when the floor itself drowns quiet singing", () => {
    const tracker = new NoiseFloorTracker();
    feed(tracker, 0.08, 50);
    expect(tracker.tooNoisy).toBe(true);
  });

  it("reset returns to the initial state", () => {
    const tracker = new NoiseFloorTracker();
    feed(tracker, 0.08, 50);
    tracker.reset();
    expect(tracker.threshold).toBe(0.008);
    expect(tracker.tooNoisy).toBe(false);
  });
});
