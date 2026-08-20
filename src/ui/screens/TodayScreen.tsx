import { exercises, type TrialRecord } from "../../core";
import { useServices } from "../services";
import { KpiCards } from "../components/KpiCards";

export function TodayScreen({
  trials,
  onStart,
}: {
  trials: TrialRecord[];
  onStart: (exerciseId: string) => void;
}) {
  const { kpi, recommender } = useServices();
  const summary = kpi.summarize(trials);
  const recommendation = recommender.recommend(trials, exercises.all());

  return (
    <div className="vc-grid">
      <section className="vc-card vc-hero">
        <div className="vc-hero-content">
          <span className="vc-eyebrow"><span className="vc-dot" /> Today</span>
          <h2>Train the destination, not just the landing.</h2>
          <p>
            Vocal Compass separates <em>which note you selected</em> from{" "}
            <em>how well you landed on it</em>. Today’s pick: <strong>{recommendation.exercise.title}</strong>.{" "}
            {recommendation.reason}
          </p>
        </div>
        <div className="vc-actions">
          <button className="vc-button primary" onClick={() => onStart(recommendation.exercise.id)}>
            Start {recommendation.exercise.title}
          </button>
        </div>
      </section>

      <section className="vc-card vc-side">
        <div className="vc-section-title">
          <h3>Your numbers</h3>
          <p>{summary.total} trials saved</p>
        </div>
        <KpiCards summary={summary} />
      </section>

      <div className="vc-module-grid">
        {exercises.all().map((e) => (
          <section className="vc-card vc-module" key={e.id}>
            <div>
              <h4>{e.title}</h4>
              <p>{e.subtitle}</p>
            </div>
            <div>
              <small>Measures: {e.measures}</small>
              <div className="vc-actions">
                <button className="vc-button" onClick={() => onStart(e.id)}>Open in Lab</button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
