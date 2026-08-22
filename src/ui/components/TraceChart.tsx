import { segmentTrace, type TrialRecord } from "../../core";

/** SVG pitch trace for the review screen: what the voice actually did. */
export function TraceChart({ record }: { record: Pick<TrialRecord, "trace" | "definition"> }) {
  const { trace, definition } = record;
  if (trace.length < 2) return null;

  const t0 = trace[0].t;
  const duration = Math.max(1, trace[trace.length - 1].t - t0);
  const midis = trace.map((p) => p.midi);
  const lo = Math.min(...midis, definition.targetMidi) - 1;
  const hi = Math.max(...midis, definition.targetMidi) + 1;
  const x = (t: number) => ((t - t0) / duration) * 100;
  const y = (m: number) => 100 - ((m - lo) / (hi - lo)) * 100;

  // One path per voiced segment: silence renders as a gap, not a diagonal.
  const segments = segmentTrace(trace);

  return (
    <svg className="vc-trace" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Pitch trace">
      <line x1="0" x2="100" y1={y(definition.targetMidi)} y2={y(definition.targetMidi)} stroke="#53d69e" strokeDasharray="2 2" strokeWidth="0.6" />
      <line x1="0" x2="100" y1={y(definition.startMidi)} y2={y(definition.startMidi)} stroke="#5b7d70" strokeDasharray="1 3" strokeWidth="0.5" />
      {segments.map((segment, i) =>
        segment.length === 1 ? (
          <circle key={i} cx={x(segment[0].t)} cy={y(segment[0].midi)} r="0.8" fill="#eef6f2" />
        ) : (
          <path
            key={i}
            d={segment
              .map((p, j) => `${j === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.midi).toFixed(1)}`)
              .join(" ")}
            fill="none"
            stroke="#eef6f2"
            strokeWidth="1.1"
          />
        ),
      )}
    </svg>
  );
}
