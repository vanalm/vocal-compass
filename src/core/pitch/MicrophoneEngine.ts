import { DEFAULT_LOW_CUT, applyLowCut, type LowCutSetting } from "./micFilter";
import { describeMicError } from "./micInput";
import { PitchPipeline, type PitchFrame } from "./PitchPipeline";

export type MicStatus = "idle" | "requesting" | "live" | "error";

export interface MicListener {
  onSample?(frame: PitchFrame): void;
  onStatus?(status: MicStatus, error?: string): void;
}

/** An audio input the browser offers; labels stay empty until microphone permission is granted. */
export interface MicInput {
  id: string;
  label: string;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/** Raw voice: the browser's call-audio processing would flatten the very pitch being measured. */
const CAPTURE: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

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
  private deviceId: string | null = null;
  private _inputLabel: string | null = null;

  constructor(
    private readonly pipeline: PitchPipeline = new PitchPipeline(),
    private readonly pollMs = 70,
  ) {}

  /** Audio inputs the browser can name. */
  static async listInputs(): Promise<MicInput[]> {
    const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    return devices.filter((d) => d.kind === "audioinput").map((d) => ({ id: d.deviceId, label: d.label }));
  }

  get status(): MicStatus {
    return this._status;
  }

  get lowCutSetting(): LowCutSetting {
    return this.lowCut;
  }

  /** The chosen input; null means the system default. */
  get inputDevice(): string | null {
    return this.deviceId;
  }

  /** The name of the input capture is running on, while live. */
  get inputLabel(): string | null {
    return this._inputLabel;
  }

  /** Retunes live capture immediately and applies to every later start. */
  setLowCut(setting: LowCutSetting): void {
    this.lowCut = setting;
    if (this.filter) applyLowCut(this.filter, setting);
  }

  /** Takes effect at the next start. */
  setInputDevice(deviceId: string | null): void {
    this.deviceId = deviceId;
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
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio is unavailable in this browser.");
      // Created and resumed before the permission prompt, while the click that
      // started capture still counts as a user gesture: Safari otherwise can
      // leave the context suspended, and every frame reads as silence.
      const context = new Ctor();
      this.context = context;
      void context.resume();
      const stream = await this.openStream();
      if (this.context !== context) {
        // Stopped while the permission prompt was open.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      await context.resume();
      this._inputLabel = stream.getAudioTracks()[0]?.label || null;

      const source = context.createMediaStreamSource(stream);
      // Rumble below the vocal range pollutes both the RMS gate and low-lag
      // correlation peaks, so a low-cut sits before detection.
      const filter = context.createBiquadFilter();
      applyLowCut(filter, this.lowCut);
      this.filter = filter;
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      source.connect(filter);
      filter.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      this.pipeline.reset();
      this.setStatus("live");

      const loop = () => {
        if (this.context !== context) return;
        analyser.getFloatTimeDomainData(buffer);
        const frame = this.pipeline.process(buffer, context.sampleRate, Date.now());
        for (const l of this.listeners) l.onSample?.(frame);
        this.timer = window.setTimeout(loop, this.pollMs);
      };
      loop();
    } catch (reason) {
      this.stop();
      this.setStatus("error", describeMicError(reason));
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
    this._inputLabel = null;
    this.pipeline.reset();
    if (this._status !== "error") this.setStatus("idle");
  }

  /** The chosen input, or the system default when it has been unplugged. */
  private async openStream(): Promise<MediaStream> {
    if (!this.deviceId) return navigator.mediaDevices.getUserMedia({ audio: CAPTURE });
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...CAPTURE, deviceId: { exact: this.deviceId } } });
    } catch (error) {
      const name = typeof error === "object" && error !== null && "name" in error ? error.name : "";
      if (name !== "OverconstrainedError" && name !== "NotFoundError") throw error;
      return navigator.mediaDevices.getUserMedia({ audio: CAPTURE });
    }
  }

  private setStatus(status: MicStatus, error?: string): void {
    this._status = status;
    for (const l of this.listeners) l.onStatus?.(status, error);
  }
}
