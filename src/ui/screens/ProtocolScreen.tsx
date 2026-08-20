import { RECOVERY_SCRIPT, RESCUE_LEVELS } from "../../core";

const WEEKS = [
  { period: "Baselines", focus: "Monitoring, echo, silent retention, route selection, load, register, recovery → your personal bottleneck report." },
  { period: "Weeks 1–2", focus: "Tonal north, steps and thirds, explicit use of “I’m lost” before searching. Goal: higher availability, lower map-loss rate." },
  { period: "Weeks 3–4", focus: "Fourths/fifths, multiple keys, 3–5 s delays, feedback faded after commitment. Goal: faster independent selection." },
  { period: "Weeks 5–6", focus: "Missing notes, phrase landmarks, neutral-syllable → lyrics transfer. Goal: the target survives inside real phrases." },
  { period: "Weeks 7–8", focus: "Register zones and accompaniment — separate load effects from register effects." },
  { period: "Weeks 9–10", focus: "Countdowns, interruptions, no-restart takes. Goal: recovery becomes fast and procedural." },
  { period: "Weeks 11–12", focus: "Two personally meaningful song passages, blind retests on different days." },
];

export function ProtocolScreen() {
  return (
    <div className="vc-protocol">
      <div className="vc-protocol-main">
        <section className="vc-card vc-prose">
          <h2>How this training works</h2>
          <p>
            Most pitch tools ask one question: how far was the sung pitch from the expected frequency?
            Vocal Compass asks two independent ones: <strong>which musical destination did you select</strong>,
            and <strong>how well did your voice land on that selected destination?</strong> A clean landing on
            the wrong note is a selection error, not a vocal-control error — and they are trained differently.
          </p>
          <h3>The loop</h3>
          <p>Hear → imagine → commit → sing → inspect → classify → retry.</p>
          <p>
            Live pitch is usually hidden until you commit. A continuously visible tuner line can train the
            exact habit being eliminated: using the voice to hunt for a destination that should first exist
            internally.
          </p>
          <h3>When you’re lost</h3>
          <p>{RECOVERY_SCRIPT}</p>
          <ul>
            {RESCUE_LEVELS.map((l) => (
              <li key={l.level}>
                <strong>Level {l.level} — {l.title}:</strong> {l.gives}. Preserves {l.preserves.toLowerCase()}.
              </li>
            ))}
          </ul>
          <p>
            Requesting the smallest useful hint is successful metacognition, not a failed trial — but the
            level used is recorded, and progress means needing less of it.
          </p>
          <h3>Cadence</h3>
          <p>
            Four 15-minute sessions per week. Voice safety outranks streaks: pain ends the session,
            hoarseness shifts you to listening work, and effort above 3/5 pauses that register zone.
          </p>
        </section>

        <section className="vc-card vc-prose">
          <h2>Twelve-week sequence</h2>
          <div className="vc-roadmap">
            {WEEKS.map((w) => (
              <div className="vc-roadmap-item" key={w.period}>
                <strong>{w.period}</strong>
                <p>{w.focus}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="vc-card vc-panel vc-sticky">
        <span className="vc-label">Session recipe (15 min)</span>
        <div className="vc-help-list">
          <div className="vc-help"><strong>1. Voice check + easy calibration</strong><p>1.5 min — Direct echo in live mode.</p></div>
          <div className="vc-help"><strong>2. Weakest selection cell</strong><p>4 min — whatever Today recommends.</p></div>
          <div className="vc-help"><strong>3. Audiation work</strong><p>4 min — Silent map or Missing note.</p></div>
          <div className="vc-help"><strong>4. Transfer</strong><p>3 min — the same route in a new key.</p></div>
          <div className="vc-help"><strong>5. Recovery practice</strong><p>1.5 min — one deliberate “I’m lost”, rescued by ladder.</p></div>
          <div className="vc-help"><strong>6. Save + debrief</strong><p>1 min — check Progress for what changed.</p></div>
        </div>
      </aside>
    </div>
  );
}
