import { noteName, type PitchZone, type PracticeDay, type RangeMeasurement } from "../../core";

/** Accuracy by pitch zone: where in the range the destinations land or miss. */
export function RegisterHeatMap({ zones }: { zones: PitchZone[] }) {
  if (zones.length === 0) return <div className="vc-empty">Scored trials build the register map.</div>;

  return (
    <div className="vc-heatmap" role="img" aria-label="Accuracy by pitch zone">
      {zones.map((zone) => (
        <div
          key={zone.lowMidi}
          className="vc-heatmap-cell"
          title={
            zone.accuracy == null
              ? `${zone.label}: no scored trials`
              : `${zone.label}: ${Math.round(zone.accuracy * 100)}% of ${zone.scored}` +
                (zone.medianResidualCents != null
                  ? ` · residual ${Math.round(zone.medianResidualCents)}¢`
                  : "") +
                (zone.medianStabilityCents != null
                  ? ` · wobble ${Math.round(zone.medianStabilityCents)}¢`
                  : "")
          }
        >
          <div
            className="vc-heatmap-swatch"
            style={
              zone.accuracy == null
                ? undefined
                : { background: `hsl(${8 + zone.accuracy * 144} 60% ${28 + zone.accuracy * 14}%)` }
            }
          />
          <span>{noteName(zone.lowMidi)}</span>
          {zone.medianResidualCents != null && (
            <span className="vc-heatmap-residual">{Math.round(zone.medianResidualCents)}¢</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Low/high range lines over successive measurements. */
export function RangeChart({ ranges }: { ranges: RangeMeasurement[] }) {
  if (ranges.length === 0) return <div className="vc-empty">No measurements yet — run a probe.</div>;

  const lows = ranges.map((r) => r.lowMidi);
  const highs = ranges.map((r) => r.highMidi);
  const lo = Math.min(...lows) - 1;
  const hi = Math.max(...highs) + 1;
  const x = (i: number) => (ranges.length === 1 ? 50 : (i / (ranges.length - 1)) * 100);
  const y = (m: number) => 58 - ((m - lo) / (hi - lo)) * 54;
  const line = (values: number[]) => values.map((m, i) => `${x(i)},${y(m)}`).join(" ");
  const latest = ranges[ranges.length - 1];

  return (
    <>
      <p className="vc-small">
        Latest: {noteName(latest.lowMidi)} – {noteName(latest.highMidi)} (
        {(latest.highMidi - latest.lowMidi).toFixed(1)} st)
      </p>
      <svg className="vc-chart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Range over time">
        {ranges.length > 1 && (
          <>
            <polyline fill="none" stroke="#53d69e" strokeWidth="1.2" points={line(highs)} />
            <polyline fill="none" stroke="#5b7d70" strokeWidth="1.2" points={line(lows)} />
          </>
        )}
        {ranges.map((r, i) => (
          <g key={r.id}>
            <circle cx={x(i)} cy={y(r.highMidi)} r="1.4" fill="#53d69e" />
            <circle cx={x(i)} cy={y(r.lowMidi)} r="1.4" fill="#5b7d70" />
          </g>
        ))}
      </svg>
    </>
  );
}

/** Minutes practiced per calendar day, derived from record timestamps. */
export function PracticeChart({ days }: { days: PracticeDay[] }) {
  if (days.length === 0) return <div className="vc-empty">Practice minutes appear once trials are saved.</div>;

  const recent = days.slice(-28);
  const max = Math.max(...recent.map((d) => d.minutes), 1);
  const total = recent.reduce((sum, d) => sum + d.minutes, 0);
  const barWidth = 100 / recent.length;

  return (
    <>
      <p className="vc-small">
        {total} min across {recent.length} day{recent.length === 1 ? "" : "s"} (last 28 shown)
      </p>
      <svg className="vc-chart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Practice minutes per day">
        {recent.map((d, i) => {
          const h = (d.minutes / max) * 54;
          return (
            <rect
              key={d.date}
              x={i * barWidth + barWidth * 0.15}
              y={58 - h}
              width={barWidth * 0.7}
              height={h}
              fill="#53d69e"
            >
              <title>{`${d.date}: ${d.minutes} min, ${d.items} items`}</title>
            </rect>
          );
        })}
      </svg>
    </>
  );
}
