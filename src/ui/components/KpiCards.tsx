import type { KpiSummary } from "../../core";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function ms(v: number | null): string {
  if (v == null) return "—";
  return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
}

/** The KPI grid's cards, in order. */
export function kpiCards(summary: KpiSummary): Array<{ label: string; value: string; hint: string }> {
  // Every rate is a share of scored trials: before the first one there is no rate, and 0% would read as a failing one.
  const rate = (v: number, hint: string) =>
    summary.scored === 0 ? { value: "—", hint: "no scored trials yet" } : { value: pct(v), hint };
  return [
    { label: "Independent destination accuracy", ...rate(summary.independentAccuracy, "correct, no hints") },
    { label: "Destination accuracy", ...rate(summary.destinationAccuracy, `${summary.scored} scored trials`) },
    { label: "Availability rate", ...rate(summary.availabilityRate, "target present before singing") },
    { label: "Map-loss rate", ...rate(summary.mapLossRate, "lost or no-target events") },
    { label: "Median selection latency", value: ms(summary.medianLatencyMs), hint: "go-cue → first voiced" },
    { label: "Hint rate", ...rate(summary.hintRate, "trials needing rescue") },
    { label: "Median recovery", value: ms(summary.medianRecoveryMs), hint: "lost → commitment" },
    {
      label: "Correct-target residual",
      value: summary.correctTargetMedianResidual == null ? "—" : `${summary.correctTargetMedianResidual.toFixed(0)}¢`,
      hint: "intonation on correct destinations only",
    },
  ];
}

/** The KPI grid — deliberately several numbers, never one "singing score". */
export function KpiCards({ summary }: { summary: KpiSummary }) {
  return (
    <div className="vc-kpis">
      {kpiCards(summary).map((c) => (
        <div className="vc-kpi" key={c.label}>
          <span>{c.label}</span>
          <strong>{c.value}</strong>
          <em>{c.hint}</em>
        </div>
      ))}
    </div>
  );
}
