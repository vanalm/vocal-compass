import {
  exercises,
  noteName,
  practiceDays,
  type RangeMeasurement,
  type TrialRecord,
} from "../../core";
import { useServices } from "../services";
import { KpiCards } from "../components/KpiCards";
import { RangeProbe } from "../components/RangeProbe";
import { PracticeChart, RangeChart } from "../components/ProgressCharts";

export function ProgressScreen({
  trials,
  ranges,
  onSaveRange,
  onExport,
  onClear,
}: {
  trials: TrialRecord[];
  ranges: RangeMeasurement[];
  onSaveRange: (m: RangeMeasurement) => Promise<void>;
  onExport: () => void;
  onClear: () => void;
}) {
  const { kpi } = useServices();
  const summary = kpi.summarize(trials);
  const byExercise = kpi.byExercise(trials);
  const delayCurve = kpi.byDelay(trials);
  const trend = kpi.trend(trials);
  const recent = [...trials].slice(-12).reverse();
  const days = practiceDays([
    ...trials.map((t) => t.createdAt),
    ...ranges.map((r) => r.createdAt),
  ]);

  return (
    <div className="vc-grid">
      <section className="vc-card vc-side" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>Overall</h3>
          <div className="vc-actions" style={{ marginTop: 0 }}>
            <button className="vc-button" onClick={onExport}>Export JSON</button>
            <button
              className="vc-button danger"
              onClick={() => {
                if (window.confirm("Delete every saved trial? Export first if you want a backup.")) onClear();
              }}
            >
              Clear data
            </button>
          </div>
        </div>
        <KpiCards summary={summary} />
      </section>

      <div className="vc-chart-grid" style={{ gridColumn: "span 12" }}>
        <section className="vc-card vc-chart-card">
          <div className="vc-chart-title">
            <div>
              <h3>Vocal range</h3>
              <p>Held extremes per probe — usable range, not accidents</p>
            </div>
          </div>
          <RangeChart ranges={ranges} />
          <RangeProbe onSave={onSaveRange} />
        </section>

        <section className="vc-card vc-chart-card">
          <div className="vc-chart-title">
            <div>
              <h3>Practice time</h3>
              <p>Minutes per day, derived from saved work</p>
            </div>
          </div>
          <PracticeChart days={days} />
        </section>

        <section className="vc-card vc-chart-card">
          <div className="vc-chart-title">
            <div>
              <h3>Destination accuracy trend</h3>
              <p>Rolling buckets of 10 scored trials</p>
            </div>
          </div>
          {trend.length < 2 ? (
            <div className="vc-empty">Save at least 20 trials to see a trend.</div>
          ) : (
            <svg className="vc-chart" viewBox="0 0 100 60" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="#53d69e"
                strokeWidth="1.4"
                points={trend
                  .map((p, i) => `${(i / (trend.length - 1)) * 100},${58 - p.accuracy * 54}`)
                  .join(" ")}
              />
            </svg>
          )}
        </section>

        <section className="vc-card vc-chart-card">
          <div className="vc-chart-title">
            <div>
              <h3>Retention by silent delay</h3>
              <p>Does the target survive silence?</p>
            </div>
          </div>
          {delayCurve.length === 0 ? (
            <div className="vc-empty">Run Silent Map trials with different delays.</div>
          ) : (
            <table className="vc-table">
              <thead>
                <tr><th>Delay</th><th>Accuracy</th><th>Trials</th></tr>
              </thead>
              <tbody>
                {delayCurve.map((d) => (
                  <tr key={d.delayMs}>
                    <td>{d.delayMs / 1000} s</td>
                    <td>{Math.round(d.accuracy * 100)}%</td>
                    <td>{d.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="vc-card vc-chart-card wide">
          <div className="vc-chart-title">
            <div>
              <h3>By module</h3>
              <p>Independent accuracy per exercise — the deficit map</p>
            </div>
          </div>
          <table className="vc-table">
            <thead>
              <tr><th>Module</th><th>Scored</th><th>Destination</th><th>Independent</th><th>Map loss</th></tr>
            </thead>
            <tbody>
              {exercises.all().map((e) => {
                const s = byExercise.get(e.id);
                return (
                  <tr key={e.id}>
                    <td>{e.title}</td>
                    <td>{s?.scored ?? 0}</td>
                    <td>{s ? `${Math.round(s.destinationAccuracy * 100)}%` : "—"}</td>
                    <td>{s ? `${Math.round(s.independentAccuracy * 100)}%` : "—"}</td>
                    <td>{s ? `${Math.round(s.mapLossRate * 100)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="vc-card vc-chart-card wide">
          <div className="vc-chart-title">
            <div>
              <h3>Recent trials</h3>
              <p>Every result opens to its evidence: acoustic label + your confirmation</p>
            </div>
          </div>
          {recent.length === 0 ? (
            <div className="vc-empty">No trials yet — start in the Lab.</div>
          ) : (
            <table className="vc-table">
              <thead>
                <tr><th>When</th><th>Module</th><th>Requested</th><th>Selected</th><th>Result</th><th>Hints</th><th>Intent</th></tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td>{new Date(t.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{t.definition.exerciseId}</td>
                    <td>{noteName(t.definition.targetMidi)}</td>
                    <td>{t.selectedNote ?? "—"}</td>
                    <td>{t.finalErrorKind}</td>
                    <td>{t.hintLevel || "—"}</td>
                    <td>{t.intent ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
