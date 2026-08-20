import type { KpiSummary } from "../../core";

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function ms(v: number | null): string {
  if (v == null) return "—";
  return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
}

/** The KPI grid — deliberately several numbers, never one "singing score". */
export function KpiCards({ summary }: { summary: KpiSummary }) {
  const cards = [
    { label: "Independent destination accuracy", value: pct(summary.independentAccuracy), hint: "correct, no hints" },
    { label: "Destination accuracy", value: pct(summary.destinationAccuracy), hint: `${summary.scored} scored trials` },
    { label: "Availability rate", value: pct(summary.availabilityRate), hint: "target present before singing" },
    { label: "Map-loss rate", value: pct(summary.mapLossRate), hint: "lost or no-target events" },
    { label: "Median selection latency", value: ms(summary.medianLatencyMs), hint: "go-cue → first voiced" },
    { label: "Hint rate", value: pct(summary.hintRate), hint: "trials needing rescue" },
    { label: "Median recovery", value: ms(summary.medianRecoveryMs), hint: "lost → commitment" },
    {
      label: "Correct-target residual",
      value: summary.correctTargetMedianResidual == null ? "—" : `${summary.correctTargetMedianResidual.toFixed(0)}¢`,
      hint: "intonation on correct destinations only",
    },
  ];
  return (
    <div className="vc-kpis">
      {cards.map((c) => (
        <div className="vc-kpi" key={c.label}>
          <span>{c.label}</span>
          <strong>{c.value}</strong>
          <em>{c.hint}</em>
        </div>
      ))}
    </div>
  );
}
