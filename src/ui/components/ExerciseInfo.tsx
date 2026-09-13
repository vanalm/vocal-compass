import { useEffect, useRef, useState } from "react";
import { noteName, type Exercise } from "../../core";
import { useServices } from "../services";
import { Modal } from "./Modal";

/** The ⓘ that opens an exercise's guide. */
export function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="vc-info" onClick={onClick} aria-label={label} title={label}>
      i
    </button>
  );
}

/**
 * The on-page version of a guide: the steps plus what it trains, why, and
 * the brain in brief. The full science and a playable example live in the modal.
 */
export function GuideBrief({
  exercise,
  withTitle = false,
  onInfo,
}: {
  exercise: Exercise;
  withTitle?: boolean;
  onInfo: () => void;
}) {
  const { guide } = exercise;
  return (
    <div className="vc-brief">
      {withTitle && (
        <>
          <div className="vc-brief-head">
            <h3>{exercise.title}</h3>
            <InfoButton label={`How ${exercise.title} works`} onClick={onInfo} />
          </div>
          <p className="vc-brief-task">{guide.task}</p>
        </>
      )}
      <ol className="vc-guide-steps">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <dl className="vc-brief-facts">
        <div>
          <dt>Trains</dt>
          <dd>{guide.trains}</dd>
        </div>
        <div>
          <dt>Why</dt>
          <dd>{guide.why}</dd>
        </div>
        <div>
          <dt>In the brain</dt>
          <dd>
            {guide.brain}{" "}
            <button type="button" className="vc-link" onClick={onInfo}>
              The research, and an example →
            </button>
          </dd>
        </div>
      </dl>
    </div>
  );
}

interface ExampleEvent {
  kind: "chord" | "note" | "silence" | "sing";
  midis: number[];
  label: string;
}

/** One real trial of the exercise, laid out as the sequence a singer meets. */
function buildExample(exercise: Exercise, delayMs: number) {
  const trial = exercise.createTrial({ difficulty: "steps", delayMs });
  const plan = exercise.cuePlan(trial);
  const events: ExampleEvent[] = [];
  if (plan.playCadence) {
    events.push({ kind: "chord", midis: [trial.tonicMidi, trial.tonicMidi + 4, trial.tonicMidi + 7], label: "Home chord" });
  }
  plan.contextMidis.forEach((midi, i) => events.push({ kind: "note", midis: [midi], label: plan.cueLabels[i] }));
  if (trial.delayMs > 0) {
    events.push({ kind: "silence", midis: [], label: `${(trial.delayMs / 1000).toFixed(0)} s silence` });
  }
  if (plan.playStartAtGo && plan.goLabel) {
    events.push({ kind: "note", midis: [trial.startMidi], label: plan.goLabel });
  }
  events.push({ kind: "sing", midis: [trial.targetMidi], label: "You sing" });
  return { trial, plan, events };
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
/** How long the example leaves for "your turn" before sounding the answer. */
const YOUR_TURN_MS = 1800;

/**
 * Explains an exercise and demonstrates it: the steps, a playable example
 * that sounds exactly what a trial sounds and then the answer, what it
 * trains and why, and the neuroscience with sources.
 */
export function ExerciseInfoModal({
  exercise,
  delayMs = 0,
  notice,
  onClose,
}: {
  exercise: Exercise;
  delayMs?: number;
  /** Shown at the top, e.g. when opening this stopped a trial. */
  notice?: string;
  onClose: () => void;
}) {
  const { cues } = useServices();
  const { guide } = exercise;
  const exampleDelay = exercise.id === "silent" ? Math.max(delayMs, 2000) : delayMs;
  const [example, setExample] = useState(() => buildExample(exercise, exampleDelay));
  const [active, setActive] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const token = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);

  const stopExample = () => {
    token.current += 1;
    cues.stop();
    setPlaying(false);
    setActive(null);
  };

  // Stop our audio before the parent acts on close: it may start a trial at once.
  const close = () => {
    if (playing) stopExample();
    onClose();
  };

  useEffect(
    () => () => {
      token.current += 1;
    },
    [],
  );

  const play = async () => {
    stopExample();
    token.current += 1;
    const mine = token.current;
    const live = () => token.current === mine;
    setPlaying(true);
    setRevealed(false);
    for (let i = 0; i < example.events.length; i += 1) {
      if (!live()) return;
      const event = example.events[i];
      setActive(i);
      if (event.kind === "chord") await cues.playCadence(event.midis[0]);
      else if (event.kind === "note") await cues.playSequence(event.midis);
      else if (event.kind === "silence") await sleep(example.trial.delayMs);
      else {
        await sleep(YOUR_TURN_MS);
        if (!live()) return;
        setRevealed(true);
        await cues.playNote(event.midis[0], 900);
      }
    }
    if (live()) {
      setPlaying(false);
      setActive(null);
    }
  };

  const another = () => {
    stopExample();
    setRevealed(false);
    setExample(buildExample(exercise, exampleDelay));
  };

  const pitched = example.events.flatMap((e) => e.midis);
  const low = Math.min(...pitched) - 2;
  const high = Math.max(...pitched) + 2;
  const height = (midi: number) => ((midi - low) / (high - low)) * 100;
  const current = active == null ? null : example.events[active];
  const target = example.trial.targetMidi;

  const status = revealed
    ? `Answer: ${noteName(target)}. That's the note a correct trial lands on.`
    : current?.kind === "sing"
      ? "Your turn: hear the answer in your head, or sing it…"
      : current
        ? `♪ ${current.label}`
        : "Plays exactly what a trial plays, pauses for your turn, then sounds the answer.";

  return (
    <Modal labelledBy="vc-guide-title" initialFocus={closeButton} onClose={close}>
      <header className="vc-modal-head">
        <div>
          <span className="vc-eyebrow">How it works · {guide.skill}</span>
          <h2 id="vc-guide-title">{exercise.title}</h2>
          <p className="vc-modal-task">{guide.task}</p>
        </div>
        <button ref={closeButton} type="button" className="vc-modal-close" onClick={close} aria-label="Close">
          ✕
        </button>
      </header>

      {notice && <p className="vc-modal-note">{notice}</p>}

      <section>
        <h3>What you do</h3>
        <ol className="vc-guide-steps">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="vc-demo">
        <div className="vc-demo-head">
          <h3>Hear an example</h3>
          <div className="vc-actions">
            <button type="button" className="vc-button primary" onClick={() => (playing ? stopExample() : void play())}>
              {playing ? "■ Stop" : "▶ Play example"}
            </button>
            <button type="button" className="vc-button ghost" onClick={another}>
              New example
            </button>
          </div>
        </div>
        <div className="vc-demo-lane" aria-label={`Example: ${example.events.map((e) => e.label).join(", ")}`}>
          {example.events.map((event, i) => {
            const hidden = event.kind === "sing" && !revealed;
            return (
              <div
                key={i}
                className={`vc-demo-col ${event.kind} ${active === i ? "on" : ""} ${active != null && i < active ? "past" : ""}`}
              >
                <div className="vc-demo-plot">
                  {event.kind === "silence" ? (
                    <span className="vc-demo-rest" />
                  ) : (
                    event.midis.map((midi) => (
                      <span
                        key={midi}
                        className={`vc-demo-dot ${hidden ? "hidden" : ""}`}
                        style={{ bottom: `${height(midi)}%` }}
                      >
                        {hidden ? "?" : ""}
                      </span>
                    ))
                  )}
                </div>
                <span className="vc-demo-label">{event.label}</span>
                <span className="vc-demo-note">
                  {event.kind === "silence"
                    ? ""
                    : hidden
                      ? "?"
                      : event.kind === "chord"
                        ? example.trial.keyName
                        : noteName(event.midis[0])}
                </span>
              </div>
            );
          })}
        </div>
        <p className="vc-small" role="status">
          {status}
        </p>
      </section>

      <section>
        <h3>What it trains</h3>
        <p>{guide.trains}</p>
        <h3>Why it matters</h3>
        <p>{guide.why}</p>
      </section>

      <section>
        <h3>The neuroscience</h3>
        <p className="vc-guide-brain">{guide.brain}</p>
        <ul className="vc-science">
          {guide.science.map((note) => (
            <li key={note.source}>
              <p>{note.point}</p>
              <cite>{note.source}</cite>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Tips</h3>
        <ul className="vc-guide-tips">
          {guide.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Reading your result</h3>
        <dl className="vc-result-key">
          <div>
            <dt>You sang</dt>
            <dd>
              The note your voice committed to in its first ~0.9 s: your brain's choice, before feedback
              corrections take over.
            </dd>
          </div>
          <div>
            <dt>Answer</dt>
            <dd>The note the trial asked for.</dd>
          </div>
          <div>
            <dt>Off-center</dt>
            <dd>How far your voice sat from the note you chose, in cents (100 cents = one semitone).</dd>
          </div>
          <div>
            <dt>So</dt>
            <dd>
              Wrong note, clean landing: a choice problem (hearing and planning). Right note, far off-center: a
              landing problem (vocal control). They're scored separately because they're trained differently.
            </dd>
          </div>
        </dl>
      </section>
    </Modal>
  );
}
