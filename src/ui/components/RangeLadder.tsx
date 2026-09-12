import { noteName, type RangeStepResult } from "../../core";

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

/**
 * A keyboard strip that fills in as the range is found: matched notes lit,
 * missed ones dimmed, the current note outlined, the starting note dotted.
 * Seeing where the voice sits among the keys is part of what the walk teaches.
 */
export function RangeLadder({
  anchorMidi,
  targetMidi,
  steps,
}: {
  anchorMidi: number;
  targetMidi: number | null;
  steps: RangeStepResult[];
}) {
  const hits = new Set(steps.filter((s) => s.hit).map((s) => s.targetMidi));
  const missed = new Set(steps.filter((s) => !s.hit).map((s) => s.targetMidi));
  const marks = [anchorMidi, ...hits, ...missed, ...(targetMidi === null ? [] : [targetMidi])];
  const lo = Math.min(anchorMidi - 12, ...marks) - 1;
  const hi = Math.max(anchorMidi + 12, ...marks) + 1;

  const keys = [];
  for (let m = lo; m <= hi; m += 1) {
    const pitchClass = ((m % 12) + 12) % 12;
    const classes = [
      "vc-key",
      BLACK_KEYS.has(pitchClass) ? "black" : "white",
      hits.has(m) ? "hit" : missed.has(m) ? "miss" : "",
      m === targetMidi ? "target" : "",
      m === anchorMidi ? "anchor" : "",
    ]
      .filter(Boolean)
      .join(" ");
    keys.push(
      <div key={m} className={classes} title={noteName(m)}>
        {pitchClass === 0 && <span>{noteName(m)}</span>}
      </div>,
    );
  }

  const matched = [...hits];
  const label = matched.length
    ? `Matched ${noteName(Math.min(...matched))} to ${noteName(Math.max(...matched))}`
    : "No notes matched yet";

  return (
    <div className="vc-ladder" role="img" aria-label={label}>
      <div className="vc-ladder-keys">{keys}</div>
    </div>
  );
}
