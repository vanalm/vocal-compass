import { useState } from "react";
import {
  exercises,
  nextActions,
  noteName,
  pitchZones,
  practiceDays,
  type ExerciseSession,
  type Lane,
  type PhraseRecord,
  type RangeMeasurement,
  type TrialRecord,
} from "../../core";
import { useServices } from "../services";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { KpiCards } from "../components/KpiCards";
import { NextUpCard } from "../components/NextUpCard";
import { ImprovementCard } from "../components/ImprovementCard";
import { PracticeChart, RangeChart, RegisterHeatMap } from "../components/ProgressCharts";

/** Exercise titles by id; a trial synced from a newer version may name one this version lacks. */
const EXERCISE_TITLES = new Map(exercises.all().map((e) => [e.id, e.title]));

/** When a trial was saved: the time for today's, the date too for anything older. */
function savedAt(createdAt: string, now: Date): string {
  const then = new Date(createdAt);
  return then.toDateString() === now.toDateString()
    ? then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : then.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function ProgressScreen({
  trials,
  ranges,
  sessions,
  phraseRecords,
  signedIn,
  onGo,
  onDeleteTrial,
  onOpenAccount,
  onExport,
  onClear,
}: {
  trials: TrialRecord[];
  ranges: RangeMeasurement[];
  sessions: ExerciseSession[];
  phraseRecords: PhraseRecord[];
  /** Whether an account holds a copy of this device's data, which changes what clearing and deleting mean. */
  signedIn: boolean;
  onGo: (lane: Lane) => void;
  onDeleteTrial: (id: string) => Promise<void>;
  onOpenAccount: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const { kpi } = useServices();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [deletingTrial, setDeletingTrial] = useState<string | null>(null);
  const summary = kpi.summarize(trials);
  const byExercise = kpi.byExercise(trials);
  const delayCurve = kpi.byDelay(trials);
  const trend = kpi.trend(trials);
  const recent = [...trials].slice(-12).reverse();
  const now = new Date();
  const days = practiceDays([
    ...trials.map((t) => t.createdAt),
    ...ranges.map((r) => r.createdAt),
    ...phraseRecords.map((r) => r.createdAt),
  ]);

  const lanes = nextActions(now, trials, ranges, sessions);

  return (
    <div className="vc-grid">
      <section className="vc-card vc-side" style={{ gridColumn: "span 12" }}>
        <NextUpCard lanes={lanes} onGo={onGo} />
      </section>

      <section className="vc-card vc-side" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>Overall</h3>
          <div className="vc-actions" style={{ marginTop: 0 }}>
            <button className="vc-button" onClick={onExport}>Export JSON</button>
            <button className="vc-button danger" onClick={() => setConfirmingClear(true)}>
              Clear data
            </button>
          </div>
        </div>
        <KpiCards summary={summary} />
        <p className="vc-small vc-progress-account">
          Backup and sync across devices live in{" "}
          <button type="button" className="vc-link" onClick={onOpenAccount}>
            Settings → Account &amp; sync
          </button>
          .
        </p>
      </section>

      <section className="vc-card vc-side" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>Your progress</h3>
        </div>
        <ImprovementCard trials={trials} ranges={ranges} />
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
            <div className="vc-table-wrap">
              <table className="vc-table">
                <thead>
                  <tr><th>Delay</th><th>Accuracy</th><th>Trials</th></tr>
                </thead>
                <tbody>
                  {delayCurve.map((d) => (
                    <tr key={d.delayMs}>
                      <td>{d.delayMs / 1000} s</td>
                      <td>{pct(d.accuracy)}</td>
                      <td>{d.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="vc-card vc-chart-card wide">
          <div className="vc-chart-title">
            <div>
              <h3>Register heat map</h3>
              <p>Destination accuracy by target pitch — where the range work should aim</p>
            </div>
          </div>
          <RegisterHeatMap zones={pitchZones(trials)} />
        </section>

        <section className="vc-card vc-chart-card wide">
          <div className="vc-chart-title">
            <div>
              <h3>By module</h3>
              <p>Independent accuracy per exercise — the deficit map</p>
            </div>
          </div>
          <div className="vc-table-wrap">
            <table className="vc-table">
              <thead>
                <tr><th>Module</th><th>Scored</th><th>Destination</th><th>Independent</th><th>Map loss</th></tr>
              </thead>
              <tbody>
                {exercises.all().map((e) => {
                  const s = byExercise.get(e.id);
                  // A rate needs a scored trial; with none, 0% would misstate it.
                  const rated = s && s.scored > 0 ? s : null;
                  return (
                    <tr key={e.id}>
                      <td>{e.title}</td>
                      <td>{s?.scored ?? 0}</td>
                      <td>{rated ? pct(rated.destinationAccuracy) : "—"}</td>
                      <td>{rated ? pct(rated.independentAccuracy) : "—"}</td>
                      <td>{rated ? pct(rated.mapLossRate) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
            <div className="vc-table-wrap">
              <table className="vc-table">
                <thead>
                  <tr><th>When</th><th>Module</th><th>Requested</th><th>Selected</th><th>Result</th><th>Hints</th><th>Intent</th><th aria-label="Delete" /></tr>
                </thead>
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id}>
                      <td>{savedAt(t.createdAt, now)}</td>
                      <td>{EXERCISE_TITLES.get(t.definition.exerciseId) ?? t.definition.exerciseId}</td>
                      <td>{noteName(t.definition.targetMidi)}</td>
                      <td>{t.selectedNote ?? "—"}</td>
                      <td>{t.finalErrorKind}</td>
                      <td>{t.hintLevel || "—"}</td>
                      <td>{t.intent ?? "—"}</td>
                      <td>
                        <button
                          className="vc-row-delete"
                          aria-label="Delete this trial"
                          title="Delete this trial"
                          onClick={() => setDeletingTrial(t.id)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {confirmingClear && (
        <ConfirmDialog
          title="Clear data on this device?"
          confirmLabel="Clear data"
          onConfirm={onClear}
          onClose={() => setConfirmingClear(false)}
        >
          <p>Every trial, range measurement, session and phrase attempt saved in this browser is deleted.</p>
          {signedIn ? (
            <p>
              Your account keeps its copy, and it syncs back to this device. To delete that copy too, delete the
              account in Settings.
            </p>
          ) : (
            <>
              <p>Anything not synced to an account is gone for good. Export JSON first if you want a backup.</p>
              <p>
                <strong>This can't be undone.</strong>
              </p>
            </>
          )}
        </ConfirmDialog>
      )}
      {deletingTrial && (
        <ConfirmDialog
          title="Delete this trial?"
          confirmLabel="Delete trial"
          onConfirm={() => void onDeleteTrial(deletingTrial)}
          onClose={() => setDeletingTrial(null)}
        >
          <p>
            {signedIn
              ? "It's deleted from your account and your other devices too."
              : "It won't come back, through sync or from an imported backup."}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
