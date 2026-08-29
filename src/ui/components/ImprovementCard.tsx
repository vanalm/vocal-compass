import { improvementSummary, type Movement, type RangeMeasurement, type TrialRecord } from "../../core";

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${16 - v * 14}`)
    .join(" ");
  return (
    <svg className="vc-spark" viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.6" points={points} />
    </svg>
  );
}

function Stat({
  label,
  movement,
  format,
  unit,
}: {
  label: string;
  movement: Movement;
  format: (v: number) => string;
  unit: string;
}) {
  const flat = movement.deltaPts === 0;
  // Arrow shows which way the NUMBER moved; colour shows whether that is good.
  // Residual falling 95¢ -> 32¢ is a down arrow in green, not an up arrow.
  const tone = flat ? "flat" : movement.improved ? "up" : "down";
  const arrow = flat ? "→" : movement.rose ? "↑" : "↓";
  return (
    <div className={`vc-move vc-move-${tone}`}>
      <span className="vc-move-label">{label}</span>
      <strong>{format(movement.latest)}</strong>
      <span className="vc-move-delta">
        {arrow} {flat ? "no change" : `${Math.abs(movement.deltaPts)}${unit} vs first ${format(movement.first)}`}
      </span>
    </div>
  );
}

/**
 * "Have I actually improved?" — earliest window vs most recent. Renders
 * nothing until there is enough data to answer honestly, and reports
 * declines as declines rather than showing only the flattering direction.
 */
export function ImprovementCard({
  trials,
  ranges,
}: {
  trials: TrialRecord[];
  ranges: RangeMeasurement[];
}) {
  const summary = improvementSummary(trials, ranges);
  if (!summary) {
    return (
      <div className="vc-empty">
        Progress appears once you have ~20 scored trials — enough to compare a first window against a recent one.
      </div>
    );
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const cents = (v: number) => `${Math.round(v)}¢`;

  return (
    <>
      <p className="vc-small">
        {summary.anyImprovement
          ? `Comparing your first ${summary.windowSize} scored trials with your most recent ${summary.windowSize}.`
          : `No clear gain yet across your first vs most recent ${summary.windowSize} trials — that is data, not failure.`}
      </p>
      <div className="vc-moves">
        <Stat label="Destination accuracy" movement={summary.destinationAccuracy} format={pct} unit=" pts" />
        <Stat label="Independent (no hints)" movement={summary.independentAccuracy} format={pct} unit=" pts" />
        <Stat label="Residual on correct" movement={summary.residualCents} format={cents} unit="¢" />
        <Stat label="Hint rate" movement={summary.hintRate} format={pct} unit=" pts" />
        {summary.range && (
          <div className={`vc-move vc-move-${summary.range.deltaSemitones === 0 ? "flat" : summary.range.improved ? "up" : "down"}`}>
            <span className="vc-move-label">Vocal range</span>
            <strong>{summary.range.latest.toFixed(1)} st</strong>
            <span className="vc-move-delta">
              {summary.range.deltaSemitones === 0 ? "→ no change" : `${summary.range.improved ? "↑" : "↓"} ${Math.abs(summary.range.deltaSemitones)} st vs first ${summary.range.first.toFixed(1)}`}
            </span>
          </div>
        )}
      </div>
      <div className="vc-spark-wrap">
        <span className="vc-small">Accuracy over time</span>
        <Sparkline values={summary.accuracySparkline} />
      </div>
    </>
  );
}
