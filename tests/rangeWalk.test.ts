import { describe, expect, it } from "vitest";
import { RangeWalk, type WalkEffect } from "../src/core/pitch/RangeWalk";

const OPTS = {
  gapMs: 1000,
  singWindowMs: 4000,
  holdMs: 500,
  resultMs: 1500,
  toleranceSemitones: 0.75,
  minTargetMidi: 36,
  maxTargetMidi: 84,
};
const FRAME = 70;

/** Tone finishes at t, the pause elapses: returns when the singer's turn opens. */
function openSing(walk: RangeWalk, t: number, effect: WalkEffect): number {
  walk.toneEnded(t, effect.toneId!);
  walk.tick(t + OPTS.gapMs);
  return t + OPTS.gapMs;
}

/** Feed a pitch every frame for ms, ticking alongside; returns the end time. */
function singFor(walk: RangeWalk, midi: number | null, t: number, ms: number): number {
  let at = t;
  for (; at <= t + ms; at += FRAME) {
    walk.feed(midi, at);
    walk.tick(at);
  }
  return at;
}

/** From a playTone effect: finish the tone, pause, hold the target steadily. */
function completeHit(walk: RangeWalk, effect: WalkEffect, t: number, offset = 0): number {
  const singAt = openSing(walk, t, effect);
  return singFor(walk, effect.playTone! + offset, singAt, 600);
}

/** From a playTone effect: finish the tone, pause, stay silent until time runs out. */
function completeMiss(walk: RangeWalk, effect: WalkEffect, t: number): number {
  const singAt = openSing(walk, t, effect);
  walk.tick(singAt + OPTS.singWindowMs);
  return singAt + OPTS.singWindowMs;
}

describe("RangeWalk — turn-taking", () => {
  it("opens by playing the starting note", () => {
    const walk = new RangeWalk(57, OPTS);
    const effect = walk.start();
    expect(effect.playTone).toBe(57);
    expect(walk.snapshot(0).phase).toBe("listen");
  });

  it("ignores the microphone while the note plays and during the pause", () => {
    const walk = new RangeWalk(57, OPTS);
    const effect = walk.start();
    singFor(walk, 57, 0, 800);
    walk.toneEnded(900, effect.toneId!);
    singFor(walk, 57, 900, 800);
    const snap = walk.snapshot(1700);
    expect(snap.phase).toBe("ready");
    expect(snap.steps).toHaveLength(0);
  });

  it("the pause lasts gapMs before it is the singer's turn", () => {
    const walk = new RangeWalk(57, OPTS);
    const effect = walk.start();
    walk.toneEnded(0, effect.toneId!);
    walk.tick(999);
    expect(walk.snapshot(999).phase).toBe("ready");
    expect(walk.snapshot(500).readyProgress).toBeCloseTo(0.5, 5);
    walk.tick(1000);
    expect(walk.snapshot(1000).phase).toBe("sing");
  });

  it("a stale tone-ended from an earlier playback does not skip the pause", () => {
    const walk = new RangeWalk(57, OPTS);
    const first = walk.start();
    walk.toneEnded(1000, first.toneId!);
    const replay = walk.hearAgain();
    expect(replay.playTone).toBe(57);
    walk.toneEnded(1100, first.toneId!); // late event from the first playback
    expect(walk.snapshot(1100).phase).toBe("listen");
    walk.toneEnded(2000, replay.toneId!);
    expect(walk.snapshot(2000).phase).toBe("ready");
  });
});

describe("RangeWalk — judging a turn", () => {
  it("holding the note for holdMs is a hit, with cents and time-to-match", () => {
    const walk = new RangeWalk(57, OPTS);
    const effect = walk.start();
    const singAt = openSing(walk, 0, effect);
    singFor(walk, 57.2, singAt + 300, 560);
    const snap = walk.snapshot(singAt + 900);
    expect(snap.phase).toBe("result");
    expect(snap.lastResult!.hit).toBe(true);
    expect(snap.lastResult!.centsOff).toBeCloseTo(20, 0);
    expect(snap.lastResult!.timeToMatchMs).toBeGreaterThanOrEqual(800);
    expect(snap.lowMidi).toBe(57);
    expect(snap.highMidi).toBe(57);
  });

  it("hold progress rises while the note is held", () => {
    const walk = new RangeWalk(57, OPTS);
    const effect = walk.start();
    const singAt = openSing(walk, 0, effect);
    singFor(walk, 57, singAt, 250);
    expect(walk.snapshot(singAt + 250).holdProgress).toBeCloseTo(0.5, 1);
  });

  it("one dropped frame and one stray frame do not break a steady hold", () => {
    const walk = new RangeWalk(57, OPTS);
    const effect = walk.start();
    const t = openSing(walk, 0, effect);
    for (const [dt, midi] of [
      [0, 57], [70, 57], [140, 57], [210, null], [280, 64],
      [350, 57], [420, 57], [490, 57], [560, 57],
    ] as Array<[number, number | null]>) {
      walk.feed(midi, t + dt);
    }
    expect(walk.snapshot(t + 560).lastResult?.hit).toBe(true);
  });

  it("two stray frames in a row restart the hold", () => {
    const walk = new RangeWalk(57, OPTS);
    const effect = walk.start();
    const t = openSing(walk, 0, effect);
    for (const [dt, midi] of [
      [0, 57], [70, 57], [140, 57], [210, 64], [280, 64],
      [350, 57], [420, 57], [490, 57], [560, 57], [630, 57],
    ] as Array<[number, number]>) {
      walk.feed(midi, t + dt);
    }
    expect(walk.snapshot(t + 630).phase).toBe("sing");
  });

  it("running out of time is a miss that reports what was actually sung", () => {
    const walk = new RangeWalk(57, OPTS);
    const effect = walk.start();
    const singAt = openSing(walk, 0, effect);
    singFor(walk, 55.4, singAt, 300);
    walk.tick(singAt + OPTS.singWindowMs);
    const r = walk.snapshot(singAt + OPTS.singWindowMs).lastResult!;
    expect(r.hit).toBe(false);
    expect(r.sungMidi).toBeCloseTo(55.4, 5);
    expect(r.centsOff).toBe(-160);
    expect(r.octaveOff).toBeNull();
  });

  it("silence for the whole turn is a miss with no pitch heard", () => {
    const walk = new RangeWalk(57, OPTS);
    completeMiss(walk, walk.start(), 0);
    const r = walk.snapshot(10_000).lastResult!;
    expect(r.hit).toBe(false);
    expect(r.sungMidi).toBeNull();
    expect(r.centsOff).toBeNull();
  });

  it("matching the starting note an octave away re-centres the walk on that octave", () => {
    const walk = new RangeWalk(57, OPTS);
    completeHit(walk, walk.start(), 0, 12);
    const snap = walk.snapshot(5000);
    expect(snap.lastResult!.hit).toBe(true);
    expect(snap.anchorMidi).toBe(69);
    expect(snap.lowMidi).toBe(69);
  });

  it("after the start, holding the wrong octave is a miss that ends the turn early and says so", () => {
    const walk = new RangeWalk(57, OPTS);
    const t = completeHit(walk, walk.start(), 0);
    const down = walk.next(t);
    expect(down.playTone).toBe(56);
    const end = completeHit(walk, down, t + 100, 12);
    const snap = walk.snapshot(end);
    expect(snap.phase).toBe("result");
    expect(snap.lastResult!.hit).toBe(false);
    expect(snap.lastResult!.octaveOff).toBe(1);
    expect(snap.lowMidi).toBe(57);
  });
});

describe("RangeWalk — moving through the range", () => {
  it("after the starting note, each success steps one semitone lower", () => {
    const walk = new RangeWalk(57, OPTS);
    let t = completeHit(walk, walk.start(), 0);
    const a = walk.next(t);
    t = completeHit(walk, a, t + 100);
    const b = walk.next(t);
    expect([a.playTone, b.playTone]).toEqual([56, 55]);
    expect(walk.snapshot(t).direction).toBe("down");
    expect(walk.snapshot(t).lowMidi).toBe(56);
  });

  it("a miss never moves on by itself, even in auto mode; Try again replays the same note", () => {
    const walk = new RangeWalk(57, { ...OPTS, autoAdvance: true });
    const t = completeMiss(walk, walk.start(), 0);
    walk.tick(t + 60_000);
    expect(walk.snapshot(t + 60_000).phase).toBe("result");
    expect(walk.next(t + 60_000)).toEqual({});
    const again = walk.retry();
    expect(again.playTone).toBe(57);
    expect(walk.snapshot(t + 60_000).attempt).toBe(2);
  });

  it("auto mode moves on resultMs after a success; click mode waits", () => {
    const auto = new RangeWalk(57, { ...OPTS, autoAdvance: true });
    const t1 = completeHit(auto, auto.start(), 0);
    const judgedAt = auto.snapshot(t1).lastResult!.endedAt;
    expect(auto.tick(judgedAt + OPTS.resultMs - 1)).toEqual({});
    const moved = auto.tick(judgedAt + OPTS.resultMs);
    expect(moved.playTone).toBe(56);

    const click = new RangeWalk(57, OPTS);
    const t2 = completeHit(click, click.start(), 0);
    expect(click.tick(t2 + 60_000)).toEqual({});
    expect(click.snapshot(t2 + 60_000).phase).toBe("result");
  });

  it("That's my lowest pauses on a turn, then climbs from just above the starting note", () => {
    const walk = new RangeWalk(57, OPTS);
    let t = completeHit(walk, walk.start(), 0);
    t = completeHit(walk, walk.next(t), t + 100);
    t = completeMiss(walk, walk.next(t), t + 100); // tried 55, missed
    walk.endDirection(t);
    const turn = walk.snapshot(t);
    expect(turn.phase).toBe("turn");
    expect(turn.lowMidi).toBe(56); // the miss at 55 never counts
    const up = walk.next(t + 10);
    expect(up.playTone).toBe(58);
    expect(walk.snapshot(t + 10).direction).toBe("up");
  });

  it("That's my highest finishes the walk with both extremes from hits only", () => {
    const walk = new RangeWalk(57, OPTS);
    let t = completeHit(walk, walk.start(), 0);
    t = completeHit(walk, walk.next(t), t + 100);
    walk.endDirection(t);
    t = completeHit(walk, walk.next(t + 10), t + 100);
    t = completeMiss(walk, walk.next(t), t + 100);
    walk.endDirection(t);
    const done = walk.snapshot(t);
    expect(done.phase).toBe("done");
    expect(done.lowMidi).toBe(56);
    expect(done.highMidi).toBe(58);
  });

  it("stops a direction at the microphone's reliable limit", () => {
    const walk = new RangeWalk(37, OPTS);
    let t = completeHit(walk, walk.start(), 0);
    t = completeHit(walk, walk.next(t), t + 100); // 36 = the floor
    walk.next(t);
    const snap = walk.snapshot(t);
    expect(snap.phase).toBe("turn");
    expect(snap.endedAtLimit).toBe(true);
    expect(snap.lowMidi).toBe(36);
  });

  it("Hear it again during your turn replays the note without costing an attempt", () => {
    const walk = new RangeWalk(57, OPTS);
    const effect = walk.start();
    openSing(walk, 0, effect);
    const replay = walk.hearAgain();
    expect(replay.playTone).toBe(57);
    const snap = walk.snapshot(1200);
    expect(snap.phase).toBe("listen");
    expect(snap.attempt).toBe(1);
  });

  it("keeps every result in order, timestamped so the trace can be split per note", () => {
    const walk = new RangeWalk(57, OPTS);
    let t = completeHit(walk, walk.start(), 0);
    t = completeMiss(walk, walk.next(t), t + 100);
    const steps = walk.snapshot(t).steps;
    expect(steps.map((s) => [s.targetMidi, s.hit])).toEqual([[57, true], [56, false]]);
    for (const s of steps) expect(s.endedAt).toBeGreaterThan(s.startedAt);
  });
});
