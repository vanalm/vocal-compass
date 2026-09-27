import { useEffect, useRef, useState } from "react";
import {
  MicrophoneEngine,
  evaluateMicCheck,
  noteName,
  type MicCheckSample,
  type MicCheckVerdict,
  type MicInput,
  type MicStatus,
  type PitchSample,
} from "../../core";
import { saveMicCheck, saveMicDevice } from "../micCheckStore";
import { useServices } from "../services";
import { MicMeter } from "./TrialStage";
import { Modal } from "./Modal";

/** Browser pseudo-inputs that follow the system choice; "System default" already stands for them. */
const ALIASES = new Set(["", "default", "communications"]);

/**
 * Checks that the app hears a steady sung note before practice: choose the
 * input, watch the level, sing. The dialog owns capture while it is open.
 */
export function MicCheckDialog({ onClose }: { onClose: () => void }) {
  const { microphone } = useServices();
  const startButton = useRef<HTMLButtonElement>(null);
  const heard = useRef<MicCheckSample[]>([]);
  const [status, setStatus] = useState<MicStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [inputs, setInputs] = useState<MicInput[]>([]);
  const [deviceId, setDeviceId] = useState(microphone.inputDevice);
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(0);
  const [sample, setSample] = useState<PitchSample | null>(null);
  const [verdict, setVerdict] = useState<MicCheckVerdict>({ kind: "listening" });

  useEffect(() => {
    const unsubscribe = microphone.subscribe({
      onSample: (frame) => {
        heard.current.push({ at: Date.now(), level: frame.level, midi: frame.smoothed?.midi ?? null });
        setLevel(frame.level);
        setThreshold(frame.noise.threshold);
        setSample(frame.smoothed);
        setVerdict(evaluateMicCheck(heard.current));
      },
      onStatus: (next, message) => {
        setStatus(next);
        setError(message ?? null);
        if (next !== "live") return;
        setLabel(microphone.inputLabel);
        // Input names are readable only once permission is granted.
        void MicrophoneEngine.listInputs().then(setInputs);
      },
    });
    return () => {
      unsubscribe();
      microphone.stop();
    };
  }, [microphone]);

  useEffect(() => {
    if (verdict.kind === "ok") {
      saveMicCheck({ deviceId: microphone.inputDevice, label: microphone.inputLabel, at: new Date().toISOString() });
    }
  }, [verdict, microphone]);

  const listen = async () => {
    heard.current = [];
    setVerdict({ kind: "listening" });
    setSample(null);
    setLevel(0);
    microphone.stop();
    await microphone.start();
  };

  const choose = (id: string) => {
    const next = id || null;
    setDeviceId(next);
    saveMicDevice(next);
    microphone.setInputDevice(next);
    void listen();
  };

  const systemDefault = inputs.find((input) => input.id === "default")?.label.replace(/^Default - /, "");
  const choices = inputs.filter((input) => !ALIASES.has(input.id));

  return (
    <Modal
      className="vc-miccheck"
      labelledBy="vc-miccheck-title"
      describedBy="vc-miccheck-what"
      initialFocus={startButton}
      onClose={onClose}
    >
      <h2 id="vc-miccheck-title">Microphone check</h2>
      <p id="vc-miccheck-what" className="vc-miccheck-lede">
        Every exercise listens to your voice, so check that the app hears you before you practice. It takes a few
        seconds. Headphones keep the app's own tones out of the mic.
      </p>

      {status === "idle" && (
        <div className="vc-actions">
          <button ref={startButton} type="button" className="vc-button primary" onClick={() => void listen()}>
            Start the check
          </button>
          <button type="button" className="vc-button ghost" onClick={onClose}>
            Not now
          </button>
        </div>
      )}

      {status === "requesting" && (
        <p className="vc-miccheck-ask" role="status">
          Allow the microphone when your browser asks.
        </p>
      )}

      {status === "error" && (
        <>
          <p className="vc-account-notice" role="alert">
            {error}
          </p>
          <div className="vc-actions">
            <button type="button" className="vc-button primary" onClick={() => void listen()}>
              Try again
            </button>
            <button type="button" className="vc-button ghost" onClick={onClose}>
              Not now
            </button>
          </div>
        </>
      )}

      {status === "live" && (
        <>
          {choices.length > 0 && (
            <label className="vc-miccheck-input">
              <span>Input</span>
              <select className="vc-input" value={deviceId ?? ""} onChange={(event) => choose(event.target.value)}>
                <option value="">System default{systemDefault ? ` (${systemDefault})` : ""}</option>
                {choices.map((input) => (
                  <option key={input.id} value={input.id}>
                    {input.label || "Unnamed input"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="vc-miccheck-ask">Sing or hum any comfortable note for a second.</p>
          <MicMeter level={level} threshold={threshold} sample={sample} />
          <Verdict verdict={verdict} label={label} canChoose={choices.length > 0} />
          <div className="vc-actions">
            <button
              type="button"
              className={`vc-button ${verdict.kind === "ok" ? "primary" : "ghost"}`}
              onClick={onClose}
            >
              {verdict.kind === "ok" ? "Done" : "Not now"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Verdict({ verdict, label, canChoose }: { verdict: MicCheckVerdict; label: string | null; canChoose: boolean }) {
  switch (verdict.kind) {
    case "ok":
      return (
        <p className="vc-miccheck-ok" role="status">
          Heard you: {noteName(verdict.midi)}. The microphone works.
        </p>
      );
    case "silent":
      return (
        <p className="vc-account-notice" role="alert">
          No sound is coming from {label ?? "this input"}. {canChoose && "Choose another input above, "}
          {canChoose ? "check" : "Check"} that the mic isn't muted, and on a Mac check System Settings → Sound →
          Input.
        </p>
      );
    case "no-note":
      return (
        <p className="vc-account-notice" role="status">
          It hears sound but no steady note yet. Sing a little louder, or move closer to the mic.
        </p>
      );
    default:
      return null;
  }
}
