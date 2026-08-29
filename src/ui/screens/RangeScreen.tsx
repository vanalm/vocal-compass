import { useState } from "react";
import {
  rangeChangeVerdict,
  vocalFunctionExercises,
  type ExerciseSession,
  type RangeMeasurement,
} from "../../core";
import { RangeProbe } from "../components/RangeProbe";
import { RangeChart } from "../components/ProgressCharts";

/**
 * The range area: measure honestly, train with the one program that has
 * trial evidence for expanding measured vocal capacity (Stemple's Vocal
 * Function Exercises), and judge change against measurement noise instead
 * of celebrating drift. Evidence: docs/range-training-evidence.md.
 */
export function RangeScreen({
  ranges,
  onSaveRange,
  onSaveSession,
}: {
  ranges: RangeMeasurement[];
  onSaveRange: (m: RangeMeasurement) => Promise<void>;
  onSaveSession: (s: ExerciseSession) => Promise<void>;
}) {
  const plan = vocalFunctionExercises();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);

  const span = (m: RangeMeasurement) => m.highMidi - m.lowMidi;
  const verdict =
    ranges.length >= 2 ? rangeChangeVerdict(span(ranges[0]), span(ranges[ranges.length - 1])) : null;

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSaved(false);
  };

  const saveSession = async () => {
    await onSaveSession({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      planId: plan.id,
      stepsCompleted: done.size,
    });
    setDone(new Set());
    setSaved(true);
  };

  return (
    <div className="vc-grid">
      <section className="vc-card" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>Measure</h3>
        </div>
        <p className="vc-small">
          Weekly is enough — repeat measurements drift upward ~1.4 st on their own, so a real change
          must clear ~3 st.
        </p>
        <RangeChart ranges={ranges} />
        {verdict && (
          <p className={`vc-small vc-verdict-${verdict.meaningful ? (verdict.direction === "down" ? "bad" : "good") : "flat"}`}>
            {verdict.label}
          </p>
        )}
        <RangeProbe onSave={onSaveRange} />
      </section>

      <section className="vc-card" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>{plan.title}</h3>
          <span className="vc-small">
            {plan.timesPerDay}×/day · gains show at ~{plan.weeksToEffect} weeks
          </span>
        </div>
        <p className="vc-small">
          The one exercise program with randomized-trial evidence for expanding measured vocal
          capacity — everything rides a lip trill, the gentlest gesture on the folds. Stop anything
          that hurts; soft beats loud.
        </p>
        <div className="vc-vfe-steps">
          {plan.steps.map((step, i) => (
            <div key={step.id} className={`vc-vfe-step ${done.has(step.id) ? "done" : ""}`}>
              <div className="vc-vfe-head">
                <strong>
                  {i + 1}. {step.title}
                </strong>
                <span className="vc-small">≤ {step.maxSeconds}s × {plan.repsPerExercise}</span>
              </div>
              <p className="vc-test-what">{step.what}</p>
              <p className="vc-test-why">{step.why}</p>
              <p className="vc-evidence">{step.evidence}</p>
              <button className="vc-button" onClick={() => toggle(step.id)}>
                {done.has(step.id) ? "Undo" : "Done"}
              </button>
            </div>
          ))}
        </div>
        <div className="vc-actions">
          <button className="vc-button primary" disabled={done.size === 0} onClick={() => void saveSession()}>
            Save session ({done.size}/{plan.steps.length} steps)
          </button>
          {saved && <span className="vc-small">Saved — counted toward today.</span>}
        </div>
        <p className="vc-small" style={{ marginTop: 10 }}>
          Safety, honestly: software cannot hear strain, and self-judged effort is unreliable too —
          the caps and the trill are the guardrails. Two hard days in a row is the risk pattern
          (soreness lags 1–3 days). A real loss of range is a reason to see a clinician, not to
          practice harder.
        </p>
      </section>
    </div>
  );
}
