import { useRef, useState } from "react";
import {
  compareRange,
  vocalFunctionExercises,
  type ExerciseSession,
  type RangeMeasurement,
} from "../../core";
import { RangeProbe } from "../components/RangeProbe";
import { EvidenceCards } from "../components/EvidenceCards";
import { RangeChart } from "../components/ProgressCharts";

/** Observed range and optional exploration, not a technique diagnosis. */
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string|null>(null);
  const pendingId = useRef<string|null>(null);
  const saveLock = useRef(false);

  const comparison = ranges.length >= 2 ? compareRange(ranges[0], ranges[ranges.length - 1]) : null;

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
    if (saveLock.current || done.size === 0) return;
    saveLock.current = true; setSaving(true); setSaveError(null);
    pendingId.current ??= crypto.randomUUID();
    try {
      await onSaveSession({id:pendingId.current,createdAt:new Date().toISOString(),planId:plan.id,stepsCompleted:done.size});
      pendingId.current=null; setDone(new Set()); setSaved(true);
    } catch {setSaveError("This session is not saved yet. Retry saving before leaving.");}
    finally {saveLock.current=false;setSaving(false);}
  };

  return (
    <div className="vc-grid">
      <section className="vc-card vc-card-pad" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>Measure</h3>
        </div>
        <p className="vc-small">
          Measure only while your voice feels normal, using the same microphone and method. These are detected notes, not a certified usable or belted range. Repeatability matters more than one extreme.
        </p>
        <RangeChart ranges={ranges} />
        {comparison && (
          <p
            className={`vc-small vc-verdict-${
              comparison.verdict.meaningful
                ? comparison.verdict.direction === "down"
                  ? "bad"
                  : "good"
                : "flat"
            }`}
          >
            Since your first measurement: {comparison.verdict.label}
            {comparison.caveat ? ` ${comparison.caveat}` : ""}
          </p>
        )}
        <RangeProbe ranges={ranges} onSave={onSaveRange} />
      </section>

      <section className="vc-card vc-card-pad" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>{plan.title}</h3>
          <span className="vc-small">
            No prescribed dose or promised gain
          </span>
        </div>
        <p className="vc-small">
          This brief optional routine is not the original Vocal Function Exercises protocol. It is not validated for range expansion. Skip it if you do not already find the gesture easy; work with a qualified teacher for range technique.
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
          <button className="vc-button primary" disabled={done.size === 0 || saving} onClick={() => void saveSession()}>
            Save session ({done.size}/{plan.steps.length} steps)
          </button>
          {saveError && <p role="alert">{saveError}</p>}
          {saved && <span className="vc-small">Saved — counted toward today.</span>}
        </div>
        <p className="vc-small" style={{ marginTop: 10 }}>
          Stop for pain, strain, hoarseness or fatigue. Time caps and trills do not certify safety. Persistent or concerning changes, including losing familiar high notes, call for a qualified clinician’s advice—not harder practice.
        </p>
        <EvidenceCards ids={["vfe", "dose", "repeatability", "voice-care"]}/>
      </section>
    </div>
  );
}
