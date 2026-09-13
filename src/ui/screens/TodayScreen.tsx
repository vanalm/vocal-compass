import {
  localDateKey,
  nextActions,
  practiceDays,
  type ExerciseSession,
  type Lane,
  type PhraseRecord,
  type RangeMeasurement,
  type TrialRecord,
} from "../../core";
import { useServices } from "../services";
import { KpiCards } from "../components/KpiCards";
import { NextUpCard } from "../components/NextUpCard";

/**
 * The landing page answers one question — "where do I pick up?" — with the
 * same planner the Progress screen uses. The pitch lives in one line; the
 * work lives in the button.
 */
export function TodayScreen({
  trials,
  ranges,
  sessions,
  phraseRecords,
  onGo,
}: {
  trials: TrialRecord[];
  ranges: RangeMeasurement[];
  sessions: ExerciseSession[];
  phraseRecords: PhraseRecord[];
  onGo: (lane: Lane) => void;
}) {
  const { kpi } = useServices();
  const summary = kpi.summarize(trials);
  const lanes = nextActions(new Date(), trials, ranges, sessions);

  const today = new Date();
  const days = practiceDays([
    ...trials.map((t) => t.createdAt),
    ...ranges.map((r) => r.createdAt),
    ...sessions.map((s) => s.createdAt),
    ...phraseRecords.map((r) => r.createdAt),
  ]);
  const minutesToday = days.find((d) => d.date === localDateKey(today.getTime()))?.minutes ?? 0;
  const weekDays = days.filter((d) => {
    const then = new Date(`${d.date}T12:00:00`);
    return (today.getTime() - then.getTime()) / 86_400_000 < 7;
  }).length;

  return (
    <div className="vc-grid">
      <section className="vc-card vc-hero">
        <div className="vc-hero-content">
          <span className="vc-eyebrow">
            <span className="vc-dot" /> Today
          </span>
          <h2>Measure. Train. Verify.</h2>
          <p className="vc-today-sub">
            Science-backed singing practice: every exercise is measured, feedback follows the
            evidence, and progress only counts against your own baseline.
          </p>
          <p className="vc-today-status">
            Active {weekDays} day{weekDays === 1 ? "" : "s"} this week
            {minutesToday > 0 ? ` · ${minutesToday} min today` : " · nothing yet today"}
            {summary.total > 0 ? ` · ${summary.total} trials saved` : ""}
          </p>
        </div>
      </section>

      <section className="vc-card vc-side" style={{ gridColumn: "span 12" }}>
        <NextUpCard lanes={lanes} onGo={onGo} />
      </section>

      <section className="vc-card vc-side" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>Your numbers</h3>
          <p>{summary.total} trials saved</p>
        </div>
        <KpiCards summary={summary} />
      </section>

      <section className="vc-card vc-howto" style={{ gridColumn: "span 12" }}>
        <div className="vc-howto-steps">
          <div>
            <strong>1 · Test</strong>
            <p>15 guided trials, blind — the baseline everything is measured against.</p>
          </div>
          <div>
            <strong>2 · Practice</strong>
            <p>Short daily work: pitch trials, phrases in Quest, range exercises.</p>
          </div>
          <div>
            <strong>3 · Progress</strong>
            <p>Charts compare you only to your own baseline — and say when a change is real.</p>
          </div>
        </div>
        <ul className="vc-principles">
          <li>Every attempt is measured. Numbers, not impressions.</li>
          <li>Feedback follows the evidence: guides help early, fade as you pass, and measurement is blind.</li>
          <li>Verified means cold — first take, no guide. Retries improve practice numbers only.</li>
          <li>A change must beat measurement noise before it is called a change.</li>
          <li>The mic hears pitch and timing, not strain. Comfort is the limit; ease beats loudness.</li>
        </ul>
      </section>
    </div>
  );
}
