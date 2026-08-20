import { hzToMidi } from "../music/theory";
import type { PitchSample } from "../types";
import { AutocorrelationDetector } from "./AutocorrelationDetector";
import type { PitchDetector } from "./PitchDetector";

export type MicStatus = "idle" | "requesting" | "live" | "error";

export interface MicListener {
  onSample?(sample: PitchSample | null): void;
  onStatus?(status: MicStatus, error?: string): void;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/**
 * Owns the getUserMedia/AudioContext lifecycle and pushes PitchSamples to
 * listeners on a fixed polling cadence. The detector is injected, so this
 * class never changes when the estimator does.
 */
export class MicrophoneEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private listeners = new Set<MicListener>();
  private _status: MicStatus = "idle";

  constructor(
    private readonly detector: PitchDetector = new AutocorrelationDetector(),
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
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      this.setStatus("live");

      const loop = () => {
        if (!this.context) return;
        analyser.getFloatTimeDomainData(buffer);
        const estimate = this.detector.estimate(buffer, this.context.sampleRate);
        let sample: PitchSample | null = null;
        if (estimate && estimate.hz >= 60 && estimate.hz <= 1200) {
          sample = {
            at: Date.now(),
            hz: estimate.hz,
            midi: hzToMidi(estimate.hz),
            clarity: estimate.clarity,
            rms: estimate.rms,
          };
        }
        for (const l of this.listeners) l.onSample?.(sample);
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
    if (this._status !== "error") this.setStatus("idle");
  }

  private setStatus(status: MicStatus, error?: string): void {
    this._status = status;
    for (const l of this.listeners) l.onStatus?.(status, error);
  }
}
