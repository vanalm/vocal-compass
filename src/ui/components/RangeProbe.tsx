import { useState } from "react";
import {
  coachTip,
  compareRange,
  lowCutLabel,
  lowNoteFilterAdvice,
  noiseFilterAdvice,
  noteName,
  resultLine,
  summarizeRangeWalk,
  type RangeMeasurement,
  type RangeWalkSnapshot,
} from "../../core";
import { useMicLowCut } from "../hooks/micLowCut";
import { useRangeWalk } from "../hooks/useRangeWalk";
import { RangeLadder } from "./RangeLadder";
import { CueIndicator, FlowModeToggle, MicMeter, useSpacebarAdvance } from "./TrialStage";

/** A comfortable middle for most adult voices (A3) when there is no history. */
const DEFAULT_START_MIDI = 57;

const STAGE: Record<RangeWalkSnapshot["direction"], string> = {
  anchor: "Step 1 of 3 · Starting note",
  down: "Step 2 of 3 · Finding your lowest",
  up: "Step 3 of 3 · Finding your highest",
  done: "Done",
};

/**
 * Range measurement as a turn-taking walk: listen, pause, sing, see how it
 * went, next note. Starts near the middle of the last measurement.
 */
export function RangeProbe({
  ranges,
  onSave,
}: {
  ranges: RangeMeasurement[];
  onSave: (m: RangeMeasurement) => Promise<void>;
}) {
  const latest = ranges[ranges.length - 1];
  const startMidi = latest ? Math.round((latest.lowMidi + latest.highMidi) / 2) : DEFAULT_START_MIDI;
  const walk = useRangeWalk(startMidi);
  const [lowCut, setLowCut] = useMicLowCut();
  const [notice, setNotice] = useState<string | null>(null);
  const s = walk.snap;

  const save = async () => {
    if (!s || s.lowMidi === null || s.highMidi === null) return;
    const { lowMidi, highMidi } = s;
    await onSave({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      lowMidi,
      highMidi,
      method: "guided-turns",
      micLowCut: walk.walkLowCut,
      steps: s.steps,
      trace: [...walk.trace.current],
    });
    setNotice(`Saved: ${noteName(lowMidi)} – ${noteName(highMidi)} (${highMidi - lowMidi} semitones).`);
    walk.reset();
  };

  const primary: (() => void) | null = !s
    ? null
    : s.phase === "result"
      ? s.lastResult?.hit
        ? walk.next
        : walk.retry
      : s.phase === "turn"
        ? walk.next
        : s.phase === "done"
          ? () => void save()
          : null;
  useSpacebarAdvance(primary);

  if (!s) {
    return (
      <div className="vc-range-probe" data-phase="idle">
        <h4 className="vc-walk-title">Find your range</h4>
        <ol className="vc-walk-howto">
          <li>Listen to a note.</li>
          <li>After a short pause, sing it back and hold it for half a second.</li>
          <li>
            Each success steps one note lower, until you press “That’s my lowest”. Then we go up the
            same way.
          </li>
        </ol>
        <p className="vc-small">
          Soft is fine. Stop at anything that feels strained. About 2–3 minutes. Headphones optional —
          the note and your turn never overlap.
        </p>
        <p className="vc-small">Microphone filter: {lowCutLabel(lowCut)} — change it in Settings.</p>
        <div className="vc-actions">
          <button className="vc-button primary" onClick={() => void walk.start()}>
            Start
          </button>
          <FlowModeToggle mode={walk.flowMode} onChange={walk.setFlowMode} />
          <span className="vc-small">
            {walk.flowMode === "auto"
              ? "Moves to the next note by itself after each success."
              : "After each note you press Next — or the spacebar."}
          </span>
        </div>
        {walk.micError && <p className="vc-small vc-error">{walk.micError}</p>}
        {notice && <p className="vc-small">{notice}</p>}
      </div>
    );
  }

  if (s.phase === "done") {
    const summary = summarizeRangeWalk(s.steps);
    if (!summary) {
      return (
        <div className="vc-range-probe" data-phase="done">
          <h4 className="vc-walk-title">No notes matched</h4>
          <p className="vc-small">
            Nothing was held long enough to count. Try again somewhere quieter, holding each note for
            half a second.
          </p>
          <div className="vc-actions">
            <button className="vc-button primary" onClick={walk.reset}>
              Back
            </button>
          </div>
        </div>
      );
    }
    const comparison = compareRange(latest, {
      lowMidi: summary.lowMidi,
      highMidi: summary.highMidi,
      method: "guided-turns",
      micLowCut: walk.walkLowCut,
    });
    const advice =
      lowNoteFilterAdvice(s.steps, walk.walkLowCut) ?? noiseFilterAdvice(walk.noisyShare(), walk.walkLowCut);
    return (
      <div className="vc-range-probe" data-phase="done">
        <h4 className="vc-walk-title">
          Your range today: {noteName(summary.lowMidi)} – {noteName(summary.highMidi)}
        </h4>
        <p className="vc-small">
          {summary.spanSemitones} semitones · {s.steps.length} notes tried
        </p>
        <RangeLadder anchorMidi={s.anchorMidi} targetMidi={null} steps={s.steps} />
        {summary.insights.length > 0 && (
          <ul className="vc-walk-insights">
            {summary.insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {comparison && (
          <p className="vc-small">
            Compared with last time: {comparison.verdict.label}
            {comparison.caveat ? ` ${comparison.caveat}` : ""}
          </p>
        )}
        {advice && (
          <div className="vc-walk-advice" role="note">
            <p>{advice.message}</p>
            {lowCut === advice.suggest ? (
              <p className="vc-small">
                Filter set to {lowCutLabel(advice.suggest)}. Save or discard this result, then measure again.
              </p>
            ) : (
              <div className="vc-actions">
                <button className="vc-button" onClick={() => setLowCut(advice.suggest)}>
                  Switch to {lowCutLabel(advice.suggest)}
                </button>
                <span className="vc-small">You can change this any time in Settings.</span>
              </div>
            )}
          </div>
        )}
        <div className="vc-actions">
          <button className="vc-button primary" onClick={() => void save()}>
            Save measurement
          </button>
          <button className="vc-button" onClick={walk.reset}>
            Discard
          </button>
        </div>
      </div>
    );
  }

  const r = s.lastResult;
  const target = noteName(s.targetMidi);
  const endLabel = s.direction === "down" ? "That’s my lowest" : s.direction === "up" ? "That’s my highest" : null;
  const bannerTone =
    s.phase === "sing" ? "sing" : s.phase === "result" ? (r?.hit ? "good" : "bad") : s.phase === "turn" ? "good" : "";

  return (
    <div className="vc-range-probe" data-phase={s.phase} data-target-midi={s.targetMidi}>
      <div className="vc-walk-header">
        <span className="vc-walk-stage">{STAGE[s.direction]}</span>
        <FlowModeToggle mode={walk.flowMode} onChange={walk.setFlowMode} />
      </div>

      <RangeLadder
        anchorMidi={s.anchorMidi}
        targetMidi={s.phase === "turn" ? null : s.targetMidi}
        steps={s.steps}
      />
      <p className="vc-small">
        So far:{" "}
        {s.lowMidi !== null && s.highMidi !== null
          ? `${noteName(s.lowMidi)} – ${noteName(s.highMidi)}`
          : "nothing matched yet"}
      </p>

      <div className={`vc-walk-banner ${bannerTone}`}>
        {s.phase === "listen" && (
          <>
            <span className="vc-walk-label">Listen</span>
            <strong className="vc-walk-note">{target}</strong>
            <CueIndicator playing={walk.tonePlaying} label="Playing the note…" />
          </>
        )}
        {s.phase === "ready" && (
          <>
            <span className="vc-walk-label">Get ready</span>
            <strong className="vc-walk-note">{target}</strong>
            <div className="vc-walk-bar">
              <i style={{ width: `${(1 - s.readyProgress) * 100}%` }} />
            </div>
          </>
        )}
        {s.phase === "sing" && (
          <>
            <span className="vc-walk-label">Your turn — sing it</span>
            <strong className="vc-walk-note">{target}</strong>
            <div className="vc-walk-hold" aria-label="Hold progress">
              <i style={{ width: `${s.holdProgress * 100}%` }} />
            </div>
            <span className="vc-small">
              {s.holdProgress > 0 ? "Hold it…" : "Find the note and hold it steady"}
            </span>
            <MicMeter level={walk.level} threshold={walk.threshold} sample={walk.sample} />
            <div className="vc-walk-timer" aria-label="Time left">
              <i style={{ width: `${(1 - s.singProgress) * 100}%` }} />
            </div>
          </>
        )}
        {s.phase === "result" && r && (
          <>
            <span className={`vc-walk-label ${r.hit ? "good" : "bad"}`}>{r.hit ? "✓ Matched" : "✗ Not yet"}</span>
            <strong className="vc-walk-result">{resultLine(r)}</strong>
            {r.hit && walk.flowMode === "auto" && <span className="vc-small">Next note in a moment…</span>}
          </>
        )}
        {s.phase === "turn" && (
          <>
            <span className="vc-walk-label good">Lowest found</span>
            <strong className="vc-walk-note">{s.lowMidi !== null ? noteName(s.lowMidi) : "—"}</strong>
            <span className="vc-small">
              {s.endedAtLimit ? "That’s as low as this microphone hears reliably. " : ""}
              Now the same thing going up, starting just above your first note.
            </span>
          </>
        )}
      </div>

      <p className="vc-walk-tip">
        <span>Tip</span>
        {coachTip(s)}
      </p>

      <div className="vc-actions">
        {(s.phase === "ready" || s.phase === "sing") && (
          <button className="vc-button" disabled={walk.tonePlaying} onClick={walk.hearAgain}>
            Hear it again
          </button>
        )}
        {s.phase === "result" && r?.hit && (
          <button className="vc-button primary" onClick={walk.next}>
            Next note
          </button>
        )}
        {s.phase === "result" && r && !r.hit && (
          <button className="vc-button primary" onClick={walk.retry}>
            Try again
          </button>
        )}
        {s.phase === "turn" && (
          <button className="vc-button primary" onClick={walk.next}>
            Continue
          </button>
        )}
        {endLabel && s.phase !== "turn" && (
          <button className="vc-button" onClick={walk.endDirection}>
            {endLabel}
          </button>
        )}
        <button className="vc-button" onClick={walk.reset}>
          Stop
        </button>
      </div>
      {walk.micError && <p className="vc-small vc-error">{walk.micError}</p>}
    </div>
  );
}
