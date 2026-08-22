import { hzToMidi } from "../music/theory";
import type { PitchSample } from "../types";
import { MpmDetector } from "./MpmDetector";
import type { PitchDetector } from "./PitchDetector";
import { PitchSmoother } from "./PitchSmoother";

export type MicStatus = "idle" | "requesting" | "live" | "error";

/**
 * One polling tick of pitch data. `raw` is the ungated detector estimate —
 * use it for voicing-onset timing (selection latency). `smoothed` has passed
 * the clarity gate and spike suppression — use it for traces and display.
 */
export interface PitchFrame {
  raw: PitchSample | null;
  smoothed: PitchSample | null;
}

export interface MicListener {
  onSample?(frame: PitchFrame): void;
  onStatus?(status: MicStatus, error?: string): void;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/**
 * Owns the getUserMedia/AudioContext lifecycle and pushes PitchFrames to
 * listeners on a fixed polling cadence. The detector and smoother are
 * injected, so this class never changes when the estimator does.
 */
export class MicrophoneEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private listeners = new Set<MicListener>();
  private _status: MicStatus = "idle";

  constructor(
    private readonly detector: PitchDetector = new MpmDetector(),
    private readonly smoother: PitchSmoother = new PitchSmoother(),
    private readonly pollMs = 70,
  ) {}

  get status(): MicStatus {
    return this._status;
  }

  subscribe(listener: MicListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this._status === "live" || this._status === "requesting") return;
    this.setStatus("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not expose microphone capture.");
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio is unavailable in this browser.");
      this.context = new Ctor();
      await this.context.resume();

      const source = this.context.createMediaStreamSource(this.stream);
      // Room/road rumble sits below the vocal range and pollutes both the
      // RMS gate and low-lag correlation peaks; cut it before detection.
      const highpass = this.context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 80;
      highpass.Q.value = 0.707;
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      source.connect(highpass);
      highpass.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      this.smoother.reset();
      this.setStatus("live");

      const loop = () => {
        if (!this.context) return;
        analyser.getFloatTimeDomainData(buffer);
        const estimate = this.detector.estimate(buffer, this.context.sampleRate);
        let raw: PitchSample | null = null;
        if (estimate && estimate.hz >= 60 && estimate.hz <= 1200) {
          raw = {
            at: Date.now(),
            hz: estimate.hz,
            midi: hzToMidi(estimate.hz),
            clarity: estimate.clarity,
            rms: estimate.rms,
          };
        }
        const frame: PitchFrame = { raw, smoothed: this.smoother.push(raw) };
        for (const l of this.listeners) l.onSample?.(frame);
        this.timer = window.setTimeout(loop, this.pollMs);
      };
      loop();
    } catch (reason) {
      this.stop();
      this.setStatus("error", reason instanceof Error ? reason.message : "Microphone access failed.");
    }
  }

  stop(): void {
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.smoother.reset();
    if (this._status !== "error") this.setStatus("idle");
  }

  private setStatus(status: MicStatus, error?: string): void {
    this._status = status;
    for (const l of this.listeners) l.onStatus?.(status, error);
  }
}
