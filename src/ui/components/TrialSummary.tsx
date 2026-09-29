import { noteName, segmentTrace, summarizeTrial, type Steadiness, type TrialRecord, type TrialSession } from "../../core";

type SummaryRecord = Pick<TrialRecord, "trace" | "definition" | "selectionLatencyMs" | "goAt" | "levels">;

/** A trial still in review, before it is saved, in the shape the dashboard reads. */
export function fromSession(session: TrialSession): SummaryRecord {
  return {
    trace: session.trace,
    definition: session.definition,
    selectionLatencyMs: session.selectionLatencyMs,
    goAt: session.goSignalAt,
    levels: session.levelTrace,
  };
}

const STEADINESS: Record<Steadiness, string> = { steady: "steady", wavering: "wavering", unsteady: "unsteady" };

const signed = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0");

function semitonesFromTarget(midi: number, targetMidi: number): string {
  const d = midi - targetMidi;
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} semitone${Math.abs(d) === 1 ? "" : "s"} from target`;
}

/**
 * The per-trial dashboard: steadiness of pitch and volume, timing, the notes
 * sung with how far each sat off its center, and the trace with its volume
 * underneath. Every number comes from core's summarizeTrial.
 */
export function TrialSummary({ record }: { record: SummaryRecord }) {
  const summary = summarizeTrial(record);
  const { targetMidi } = record.definition;

  return (
    <section className="vc-summary" aria-label="How this attempt sounded">
      <div className="vc-summary-tiles">
        <Tile
          label="Pitch steadiness"
          value={summary.pitch ? `±${summary.pitch.spreadCents}¢` : "—"}
          note={summary.pitch ? STEADINESS[summary.pitch.steadiness] : "too short to judge"}
          tone={summary.pitch?.steadiness}
        />
        <Tile
          label="Volume steadiness"
          value={summary.volume ? `±${summary.volume.spreadDb} dB` : "—"}
          note={summary.volume ? STEADINESS[summary.volume.steadiness] : "too short to judge"}
          tone={summary.volume?.steadiness}
        />
        <Tile
          label="First sound"
          value={summary.timeToVoiceMs == null ? "—" : `${(summary.timeToVoiceMs / 1000).toFixed(1)} s`}
          note="after the cue"
        />
        <Tile
          label="Singing"
          value={summary.voicedShare == null ? "—" : `${Math.round(summary.voicedShare * 100)}%`}
          note="of the time"
        />
      </div>

      <TrialChart record={record} />

      {summary.notes.length > 0 ? (
        <ol className="vc-summary-notes" aria-label="Notes sung, in order">
          {summary.notes.map((note) => (
            <li key={`${note.midi}-${note.startMs}`} className={note.isTarget ? "target" : ""}>
              <strong>{note.name}</strong>
              <span>{signed(note.centsOff)}¢</span>
              <span>{(note.durationMs / 1000).toFixed(1)} s</span>
              <em>{note.isTarget ? "the target" : semitonesFromTarget(note.midi, targetMidi)}</em>
            </li>
          ))}
        </ol>
      ) : (
        <p className="vc-small">No note was held long enough to measure.</p>
      )}
    </section>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: Steadiness }) {
  return (
    <div className={`vc-summary-tile ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

/** Pitch over the sing window against the target, with the input level beneath on the same time axis. */
function TrialChart({ record }: { record: SummaryRecord }) {
  const { trace, definition, levels } = record;
  if (trace.length < 2 && !(levels && levels.length > 1)) return null;

  const times = [...trace.map((p) => p.t), ...(levels ?? []).map((l) => l.t)];
  const t0 = record.goAt ?? Math.min(...times);
  const duration = Math.max(1, Math.max(...times) - t0);
  const x = (t: number) => ((t - t0) / duration) * 100;

  const midis = trace.map((p) => p.midi);
  const lo = Math.min(...midis, definition.targetMidi, definition.startMidi) - 1;
  const hi = Math.max(...midis, definition.targetMidi, definition.startMidi) + 1;
  const PITCH_BOTTOM = 66;
  const y = (m: number) => PITCH_BOTTOM - ((m - lo) / (hi - lo)) * PITCH_BOTTOM;

  // Volume in decibels, floor −60 dB, drawn in the strip under the pitch.
  const loudness = (levels && levels.length > 1 ? levels : trace.map((p) => ({ t: p.t, rms: p.rms ?? 0 }))).map((l) => ({
    t: l.t,
    db: Math.max(-60, 20 * Math.log10(Math.max(l.rms, 1e-6))),
  }));
  const vy = (db: number) => 100 - ((db + 60) / 60) * 24;
  const volumePath =
    loudness.length > 1
      ? `M${x(loudness[0].t).toFixed(1)},100 ` +
        loudness.map((l) => `L${x(l.t).toFixed(1)},${vy(l.db).toFixed(1)}`).join(" ") +
        ` L${x(loudness[loudness.length - 1].t).toFixed(1)},100 Z`
      : null;

  return (
    <figure className="vc-trialchart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Pitch against the target, with volume beneath">
        <line x1="0" x2="100" y1={y(definition.targetMidi)} y2={y(definition.targetMidi)} className="target" />
        <line x1="0" x2="100" y1={y(definition.startMidi)} y2={y(definition.startMidi)} className="start" />
        {segmentTrace(trace).map((segment, i) =>
          segment.length === 1 ? (
            <circle key={i} cx={x(segment[0].t)} cy={y(segment[0].midi)} r="0.8" className="pitch-dot" />
          ) : (
            <path
              key={i}
              className="pitch"
              d={segment.map((p, j) => `${j === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.midi).toFixed(1)}`).join(" ")}
            />
          ),
        )}
        <line x1="0" x2="100" y1="74" y2="74" className="divider" />
        {volumePath && <path d={volumePath} className="volume" />}
      </svg>
      <figcaption>
        <span className="key target">target {noteName(definition.targetMidi)}</span>
        <span className="key start">start {noteName(definition.startMidi)}</span>
        <span className="key pitch">your pitch</span>
        <span className="key volume">volume</span>
      </figcaption>
    </figure>
  );
}
