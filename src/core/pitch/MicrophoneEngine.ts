import { DEFAULT_LOW_CUT, applyLowCut, type LowCutSetting } from "./micFilter";
import { PitchPipeline, type PitchFrame } from "./PitchPipeline";

export type MicStatus = "idle" | "requesting" | "live" | "error";

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
 * listeners on a fixed polling cadence. All per-tick signal logic lives in
 * the injected PitchPipeline; this class is only the audio plumbing.
 */
export class MicrophoneEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private listeners = new Set<MicListener>();
  private _status: MicStatus = "idle";
  private lowCut: LowCutSetting = DEFAULT_LOW_CUT;
  private filter: BiquadFilterNode | null = null;

  constructor(
    private readonly pipeline: PitchPipeline = new PitchPipeline(),
    private readonly pollMs = 70,
  ) {}

  get status(): MicStatus {
    return this._status;
  }

  get lowCutSetting(): LowCutSetting {
    return this.lowCut;
  }

  /** Retunes live capture immediately and applies to every later start. */
  setLowCut(setting: LowCutSetting): void {
    this.lowCut = setting;
    if (this.filter) applyLowCut(this.filter, setting);
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
      // Rumble below the vocal range pollutes both the RMS gate and low-lag
      // correlation peaks, so a low-cut sits before detection.
      const filter = this.context.createBiquadFilter();
      applyLowCut(filter, this.lowCut);
      this.filter = filter;
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      source.connect(filter);
      filter.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      this.pipeline.reset();
      this.setStatus("live");

      const loop = () => {
        if (!this.context) return;
        analyser.getFloatTimeDomainData(buffer);
        const frame = this.pipeline.process(buffer, this.context.sampleRate, Date.now());
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
    this.filter = null;
    this.pipeline.reset();
    if (this._status !== "error") this.setStatus("idle");
  }

  private setStatus(status: MicStatus, error?: string): void {
    this._status = status;
    for (const l of this.listeners) l.onStatus?.(status, error);
  }
}
