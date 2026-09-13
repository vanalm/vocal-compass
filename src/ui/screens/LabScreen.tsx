import { useState } from "react";
import {
  RESCUE_LEVELS,
  RECOVERY_SCRIPT,
  exercises,
  noteName,
  type Difficulty,
  type FeedbackMode,
  type IntentLabel,
  type RegisterLabel,
  type TrialRecord,
} from "../../core";
import { useTrialRunner, type RunnerSettings } from "../hooks/useTrialRunner";
import { PitchReadout } from "../components/PitchReadout";
import { CueIndicator, FlowModeToggle, MicMeter, useSpacebarAdvance } from "../components/TrialStage";
import { TraceChart } from "../components/TraceChart";
import { ExerciseInfoModal, InfoButton } from "../components/ExerciseInfo";
import { NoiseWarning } from "../components/NoiseWarning";

const DELAYS = [0, 2000, 5000, 8000];
const INTENTS: Array<{ id: IntentLabel; label: string }> = [
  { id: "selected-note", label: "I chose the note I landed on" },
  { id: "landing-miss", label: "I knew the destination; my voice missed it" },
  { id: "searching", label: "I was searching between possibilities" },
  { id: "no-target", label: "I had no destination available" },
];
const REGISTERS: RegisterLabel[] = ["unknown", "chest", "transition", "head"];

export function LabScreen({
  save,
  initialExerciseId,
}: {
  save: (record: TrialRecord) => Promise<void>;
  initialExerciseId?: string;
}) {
  const [settings, setSettings] = useState<RunnerSettings>(() => {
    const exercise = exercises.get(initialExerciseId ?? "route");
    return {
      exerciseId: exercise.id,
      difficulty: "steps" as Difficulty,
      delayMs: 0,
      feedbackMode: exercise.defaultFeedback,
    };
  });
  const [confidence, setConfidence] = useState(3);
  const [intent, setIntent] = useState<IntentLabel | null>(null);
  const [effort, setEffort] = useState(2);
  const [register, setRegister] = useState<RegisterLabel>("unknown");
  const [showRescue, setShowRescue] = useState(false);
  const [info, setInfo] = useState<{ interrupted: boolean } | null>(null);

  const runner = useTrialRunner(save);
  const exercise = exercises.get(settings.exerciseId);
  const trial = runner.session?.definition ?? null;
  const showLive = settings.feedbackMode === "live" && runner.phase === "sing";

  const begin = () => {
    setIntent(null);
    setShowRescue(false);
    void runner.start(settings, confidence);
  };

  const openInfo = () => {
    // A trial can't run under the guide: opening it mid-trial discards that trial.
    const interrupted = runner.phase === "listen" || runner.phase === "imagine" || runner.phase === "sing";
    if (interrupted) {
      runner.discard();
      setShowRescue(false);
    }
    setInfo({ interrupted });
  };

  const saveTrial = () => {
    void runner.complete({ intent, effort, register });
    setIntent(null);
    setShowRescue(false);
  };

  const primaryAction = info
    ? null
    : runner.phase === "idle"
      ? begin
      : runner.phase === "imagine" && runner.remainingDelayMs <= 0 && !runner.cuePlaying
        ? runner.commit
        : runner.phase === "sing"
            ? runner.finish
            : runner.phase === "review"
              ? saveTrial
              : null;
  useSpacebarAdvance(primaryAction);

  return (
    <div className="vc-lab-layout">
      <section className="vc-card vc-panel">
        <div className="vc-field">
          <label>Exercise</label>
          <div className="vc-exercise-list">
            {exercises.all().map((e) => (
              <button
                key={e.id}
                className={`vc-exercise-choice ${e.id === settings.exerciseId ? "active" : ""}`}
                disabled={runner.phase !== "idle"}
                onClick={() =>
                  setSettings((s) => ({ ...s, exerciseId: e.id, feedbackMode: e.defaultFeedback }))
                }
              >
                <strong>{e.title}</strong>
                <span>{e.subtitle}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="vc-field">
          <label>Difficulty</label>
          <select
            value={settings.difficulty}
            disabled={runner.phase !== "idle"}
            onChange={(e) => setSettings((s) => ({ ...s, difficulty: e.target.value as Difficulty }))}
          >
            <option value="steps">Steps</option>
            <option value="thirds">Thirds</option>
            <option value="leaps">Leaps</option>
            <option value="mixed">Mixed</option>
          </select>
        </div>
        <div className="vc-field">
          <label>Silent delay</label>
          <select
            value={settings.delayMs}
            disabled={runner.phase !== "idle"}
            onChange={(e) => setSettings((s) => ({ ...s, delayMs: Number(e.target.value) }))}
          >
            {DELAYS.map((d) => (
              <option key={d} value={d}>{d === 0 ? "None" : `${d / 1000} s`}</option>
            ))}
          </select>
        </div>
        <div className="vc-field">
          <label>Feedback</label>
          <div className="vc-segmented">
            {(["blind", "commit", "live"] as FeedbackMode[]).map((mode) => (
              <button
                key={mode}
                className={settings.feedbackMode === mode ? "active" : ""}
                disabled={runner.phase !== "idle"}
                onClick={() => setSettings((s) => ({ ...s, feedbackMode: mode }))}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="vc-small">Default for this module: {exercise.defaultFeedback}. Live pitch is hidden in blind/commit so the destination forms internally first.</p>
        </div>
        <div className="vc-field">
          <label>Confidence before singing: {confidence}/5</label>
          <div className="vc-range">
            <input type="range" min={1} max={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
          </div>
        </div>
      </section>

      <section className="vc-card vc-stage">
        <div className="vc-stage-head">
          <span className="vc-phase">{runner.phase === "idle" ? "ready" : runner.phase}</span>
          <span className="vc-lab-guide">
            {exercise.title}
            <InfoButton label={`How ${exercise.title} works`} onClick={openInfo} />
          </span>
          <FlowModeToggle mode={runner.flowMode} onChange={runner.setFlowMode} />
          <span className={`vc-mic ${runner.micStatus === "live" ? "live" : ""}`}>
            ● mic {runner.micStatus}
          </span>
        </div>
        {runner.micError && <p className="vc-small" style={{ color: "#ffbdc5" }}>{runner.micError}</p>}

        {runner.phase === "idle" && (
          <div className="vc-prompt vc-stage-prompt">
            <h3>{exercise.title}</h3>
            <p>{exercise.subtitle}</p>
            <p className="vc-small" style={{ marginTop: 10 }}>
              {exercise.guide.task} Use headphones so cues don’t leak into the microphone.
            </p>
            <div className="vc-actions vc-center-actions">
              <button className="vc-button primary" onClick={begin}>Start trial</button>
            </div>
          </div>
        )}

        {runner.phase === "listen" && (
          <div className="vc-prompt vc-stage-prompt listen">
            <h3>Listen</h3>
            <p>Key of {trial?.keyName}.</p>
            <CueIndicator playing={runner.cuePlaying} label={runner.cueLabel ?? undefined} />
          </div>
        )}

        {runner.phase === "imagine" && trial && (
          <div className="vc-prompt vc-stage-prompt imagine">
            <h3>Imagine</h3>
            <p>{runner.prompt}</p>
            <CueIndicator playing={runner.cuePlaying} label={runner.cueLabel ?? undefined} />
            {runner.remainingDelayMs > 0 ? (
              <p className="vc-small" style={{ marginTop: 12 }}>
                Hold it silently… {(runner.remainingDelayMs / 1000).toFixed(1)} s
              </p>
            ) : (
              <div className="vc-actions vc-center-actions">
                <button className="vc-button primary" disabled={runner.cuePlaying} onClick={runner.commit}>
                  I hear it — sing
                </button>
                <button className="vc-button" disabled={runner.cuePlaying} onClick={() => void runner.replayCue()}>
                  Play it again
                </button>
                <button className="vc-button warn" onClick={() => { runner.markLost(); setShowRescue(true); }}>
                  I’m lost
                </button>
              </div>
            )}
          </div>
        )}

        {runner.phase === "sing" && trial && (
          <div className="vc-prompt vc-stage-prompt sing">
            <h3>Sing</h3>
            <p>Commit to one note. Capture stops automatically.</p>
            <MicMeter level={runner.inputLevel} threshold={runner.noiseThreshold} sample={runner.liveSample} />
            <NoiseWarning noisy={runner.tooNoisy} />
            {showLive && <PitchReadout sample={runner.liveSample} targetMidi={trial.targetMidi} />}
            <div className="vc-actions vc-center-actions">
              <button className="vc-button" onClick={runner.finish}>Done</button>
              <button className="vc-button warn" onClick={() => { runner.markLost(); setShowRescue(true); }}>
                I’m lost
              </button>
            </div>
          </div>
        )}

        {showRescue && runner.phase !== "review" && trial && (
          <div className="vc-rescue">
            <h4>Rescue ladder — take the smallest useful hint</h4>
            <p>{RECOVERY_SCRIPT}</p>
            <div className="vc-rescue-buttons">
              {RESCUE_LEVELS.map((level) => (
                <button
                  key={level.level}
                  className="vc-button"
                  onClick={() => {
                    if (level.level === 1 && trial) {
                      runner.rescue(1);
                      alert(
                        trial.targetMidi > trial.startMidi
                          ? "The destination is HIGHER than your current note."
                          : trial.targetMidi < trial.startMidi
                            ? "The destination is LOWER than your current note."
                            : "The destination is the SAME note.",
                      );
                    } else {
                      void runner.rescue(level.level);
                    }
                  }}
                >
                  {level.level}. {level.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {runner.phase === "review" && runner.analysis && runner.session && (
          <div className="vc-review">
            <div className="vc-verdict">
              <div>
                <span>Selected</span>
                <strong>{runner.analysis.selectedNote ?? "unscored"}</strong>
              </div>
              <div>
                <span>Requested</span>
                <strong>{runner.analysis.targetNote}</strong>
              </div>
              <div>
                <span>Residual on selected</span>
                <strong>
                  {runner.analysis.residualToSelectedCents == null
                    ? "—"
                    : `${runner.analysis.residualToSelectedCents.toFixed(0)}¢`}
                </strong>
              </div>
            </div>
            <p className="vc-explanation">{runner.analysis.explanation}</p>
            <TraceChart record={{ trace: runner.session.trace, definition: runner.session.definition }} />

            {runner.session.needsIntentConfirmation() && (
              <div className="vc-intent">
                <span className="vc-label">What actually happened?</span>
                <div className="vc-intent-grid">
                  {INTENTS.map((i) => (
                    <button key={i.id} className={intent === i.id ? "active" : ""} onClick={() => setIntent(i.id)}>
                      {i.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="vc-divider" />
            <div className="vc-field">
              <label>Register feel</label>
              <div className="vc-segmented" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
                {REGISTERS.map((r) => (
                  <button key={r} className={register === r ? "active" : ""} onClick={() => setRegister(r)}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="vc-field">
              <label>Effort: {effort}/5</label>
              <div className="vc-range">
                <input type="range" min={1} max={5} value={effort} onChange={(e) => setEffort(Number(e.target.value))} />
              </div>
            </div>
            <div className="vc-actions">
              <button className="vc-button primary" onClick={saveTrial}>Save trial</button>
              <button className="vc-button ghost" onClick={runner.discard}>Discard</button>
            </div>
          </div>
        )}
      </section>

      <section className="vc-card vc-panel">
        <span className="vc-label">This trial</span>
        {trial ? (
          <div className="vc-help-list">
            <div className="vc-help">
              <strong>Key</strong>
              <p>{trial.keyName}</p>
            </div>
            <div className="vc-help">
              <strong>Start note</strong>
              <p>{noteName(trial.startMidi)} (degree {trial.startDegree + 1})</p>
            </div>
            <div className={`vc-help ${runner.phase === "review" ? "" : "active"}`}>
              <strong>Destination</strong>
              <p>{runner.phase === "review" ? `${noteName(trial.targetMidi)} (degree ${trial.targetDegree + 1})` : "Hidden until review"}</p>
            </div>
            <div className="vc-help">
              <strong>Hints used</strong>
              <p>Level {runner.hintLevel}{runner.lost ? " · lost event logged" : ""}</p>
            </div>
          </div>
        ) : (
          <p className="vc-small">Start a trial to see its context here. The destination stays hidden until review.</p>
        )}
      </section>

      {info && (
        <ExerciseInfoModal
          exercise={exercise}
          delayMs={settings.delayMs}
          notice={info.interrupted ? "That trial was stopped and discarded. Start a new one when you're ready." : undefined}
          onClose={() => setInfo(null)}
        />
      )}
    </div>
  );
}
