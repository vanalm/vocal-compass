import { useMemo, useState } from "react";
import {
  phraseLibrary,
  phraseProgress,
  pickTessituraTonic,
  noteName,
  type GuideStrength,
  type Phrase,
  type PhraseRecord,
  type RangeMeasurement,
  type SingerRole,
} from "../../core";
import { usePhraseRunner } from "../hooks/usePhraseRunner";
import { CueIndicator, MicMeter, useSpacebarAdvance } from "../components/TrialStage";

const GUIDE_COPY: Record<GuideStrength, string> = {
  full: "guide plays every note",
  anchor: "guide plays first + last only",
  none: "no guide — this take is verified",
};

const DEFAULT_BPM = 90;

/**
 * Echo Quest: copy phrases as the guide fades. One reusable format powers
 * it all — melody cells at levels 1–2, Nashville progressions sung by chord
 * role at level 3. The key adapts to the singer's measured range; pass a
 * guide strength (>=80%) and the next attempt fades a step.
 */
export function QuestScreen({
  phrases,
  ranges,
  onSave,
}: {
  phrases: PhraseRecord[];
  ranges: RangeMeasurement[];
  onSave: (record: PhraseRecord) => Promise<void>;
}) {
  const library = useMemo(() => phraseLibrary(), []);
  const [role, setRole] = useState<SingerRole>("melody");
  const runner = usePhraseRunner(onSave);

  const begin = (phrase: Phrase, chosenRole: SingerRole) => {
    const progress = phraseProgress(phrases, phrase.id, chosenRole);
    const keyTonicMidi = pickTessituraTonic(phrase, chosenRole, ranges);
    void runner.start({ phrase, keyTonicMidi, bpm: DEFAULT_BPM, role: chosenRole, guide: progress.guide });
  };

  const primaryAction =
    runner.phase === "ready" && !runner.cuePlaying
      ? () => void runner.go()
      : runner.phase === "sing"
        ? runner.finish
        : runner.phase === "review"
          ? () => void runner.save()
          : null;
  useSpacebarAdvance(primaryAction);

  // ——— Picker ———
  if (runner.phase === "idle") {
    const levels = [...new Set(library.map((p) => p.level))].sort();
    return (
      <div className="vc-grid">
        <section className="vc-card" style={{ gridColumn: "span 12" }}>
          <div className="vc-section-title">
            <h3>Echo Quest</h3>
            <span className="vc-small">copy the phrase · guide fades as you pass · spacebar advances</span>
          </div>
          {levels.map((level) => (
            <div key={level} className="vc-quest-level">
              <p className="vc-small">
                {level === 1
                  ? "Level 1 — Find Home. Copy short cells around the tonic. Measures degree accuracy near home."
                  : level === 2
                    ? "Level 2 — Run Lab. Copy fast note runs. Measures agility: clean notes and even timing, not speed for its own sake."
                    : "Level 3 — Number Navigator. Sing a chord tone through a progression. Measures hearing chords as numbers."}
              </p>
              <div className="vc-quest-grid">
                {library
                  .filter((p) => p.level === level)
                  .map((p) => {
                    const isChordPhrase = p.chords.length > 0;
                    const activeRole = isChordPhrase ? (role === "melody" ? "root" : role) : "melody";
                    const progress = phraseProgress(phrases, p.id, activeRole);
                    return (
                      <button key={p.id} className="vc-quest-card" onClick={() => begin(p, activeRole)}>
                        <strong>{p.name}</strong>
                        <span className="vc-small">
                          {isChordPhrase
                            ? `sing each chord's ${activeRole}`
                            : p.notes.map((n) => n.degree).join("–")}
                        </span>
                        <span className={`vc-quest-guide vc-quest-guide-${progress.guide}`}>
                          {progress.guide === "none" && progress.bestVerified != null
                            ? `verified ${Math.round(progress.bestVerified * 100)}%`
                            : `next: ${progress.guide} guide`}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
          <div className="vc-field" style={{ marginTop: 12 }}>
            <label>Chord-phrase role</label>
            <div className="vc-segmented" style={{ maxWidth: 280 }}>
              {(["root", "third", "fifth"] as SingerRole[]).map((r) => (
                <button key={r} className={role === r || (role === "melody" && r === "root") ? "active" : ""} onClick={() => setRole(r)}>
                  {r}
                </button>
              ))}
            </div>
            <p className="vc-small">
              CHORD names the Nashville chord · SING K# is your note's degree in the key · ROLE CT# is its job in the chord.
            </p>
          </div>
        </section>
      </div>
    );
  }

  // ——— Running ———
  const spec = runner.spec!;
  const targets = runner.realized?.notes ?? [];
  return (
    <div className="vc-grid">
      <section className="vc-card vc-stage" style={{ gridColumn: "span 12" }}>
        <div className="vc-stage-head">
          <span className="vc-phase">{runner.phase}</span>
          <span className="vc-small">
            {spec.phrase.name} · key of {noteName(spec.keyTonicMidi)} · {GUIDE_COPY[spec.guide]}
          </span>
          <span className={`vc-mic ${runner.micStatus === "live" ? "live" : ""}`}>● mic {runner.micStatus}</span>
        </div>
        {runner.micError && <p className="vc-small" style={{ color: "#ffbdc5" }}>{runner.micError}</p>}

        <div className="vc-quest-targets">
          {targets.map((t, i) => {
            const result = runner.score?.noteResults[i];
            return (
              <div key={i} className={`vc-quest-note ${result ? (result.hit ? "hit" : "miss") : ""}`}>
                <strong>{spec.guide === "none" && runner.phase !== "review" ? "?" : noteName(t.midi)}</strong>
                <span>{t.degreeLabel}</span>
                {t.chordLabel && <span className="vc-quest-chord">{t.chordLabel} · {t.roleLabel}</span>}
                {result?.centsOff != null && result.hit && (
                  <span className="vc-small">{result.centsOff > 0 ? "+" : ""}{result.centsOff}¢</span>
                )}
              </div>
            );
          })}
        </div>

        {runner.phase === "listen" && (
          <div className="vc-prompt"><CueIndicator playing label="Listen — the guide is playing…" /></div>
        )}

        {runner.phase === "ready" && (
          <div className="vc-prompt">
            <div className="vc-actions vc-center-actions">
              <button className="vc-button primary" disabled={runner.cuePlaying} onClick={() => void runner.go()}>
                I have it — count me in
              </button>
              <button className="vc-button" disabled={runner.cuePlaying} onClick={() => void runner.replay()}>
                Play it again
              </button>
              <button className="vc-button" onClick={runner.discard}>Back</button>
            </div>
          </div>
        )}

        {runner.phase === "countin" && (
          <div className="vc-prompt"><CueIndicator playing label="Count-in — sing on one…" /></div>
        )}

        {runner.phase === "sing" && (
          <div className="vc-prompt">
            <MicMeter level={runner.inputLevel} threshold={runner.noiseThreshold} sample={runner.liveSample} />
            <div className="vc-actions vc-center-actions">
              <button className="vc-button" onClick={runner.finish}>Done</button>
            </div>
          </div>
        )}

        {runner.phase === "review" && runner.score && (
          <div className="vc-review">
            <div className="vc-verdict">
              <div><span>Notes</span><strong>{runner.score.hits}/{targets.length}</strong></div>
              <div><span>Timing</span><strong>{runner.score.meanAbsOnsetMs == null ? "—" : `±${runner.score.meanAbsOnsetMs}ms`}</strong></div>
              <div><span>Landing</span><strong>{runner.score.landingHit ? "✓" : "✗"}</strong></div>
            </div>
            <p className="vc-quest-keep">Keep: {runner.score.keep}</p>
            <p className="vc-quest-fix">Fix: {runner.score.fix}</p>
            {spec.guide === "none" && runner.attemptOfSpec === 1 && (
              <p className="vc-small">This was a verified take — first attempt, no guide.</p>
            )}
            <div className="vc-actions vc-center-actions">
              <button className="vc-button primary" onClick={() => void runner.save()}>Save and continue</button>
              <button className="vc-button" onClick={runner.retry}>Retry — don’t count this one</button>
              <button className="vc-button" onClick={runner.discard}>Back</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
