import { midiToHz } from "../music/theory";

/**
 * Synthesizes tonal cues (single notes, routes, phrases, cadences) with
 * Web Audio. One shared AudioContext, resumed on first user gesture.
 */
export class CuePlayer {
  private context: AudioContext | null = null;

  private async ctx(): Promise<AudioContext> {
    if (!this.context) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio is unavailable.");
      this.context = new Ctor();
    }
    await this.context.resume();
    return this.context;
  }

  /** Play one note. Returns after the note finishes. */
  async playNote(midi: number, durationMs = 700, gain = 0.16): Promise<void> {
    const ctx = await this.ctx();
    const now = ctx.currentTime;
    const seconds = durationMs / 1000;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = midiToHz(midi);
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(gain, now + 0.02);
    amp.gain.setValueAtTime(gain, now + seconds - 0.08);
    amp.gain.linearRampToValueAtTime(0.0001, now + seconds);
    osc.connect(amp).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + seconds + 0.02);
    await this.wait(durationMs + 60);
  }

  /** Play an ordered sequence with a small gap between notes. */
  async playSequence(midis: number[], noteMs = 600, gapMs = 120): Promise<void> {
    for (const midi of midis) {
      await this.playNote(midi, noteMs);
      await this.wait(gapMs);
    }
  }

  /** A tonic chord to establish "home" (root, third, fifth). */
  async playCadence(tonicMidi: number): Promise<void> {
    const ctx = await this.ctx();
    const now = ctx.currentTime;
    for (const offset of [0, 4, 7]) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = midiToHz(tonicMidi + offset);
      amp.gain.setValueAtTime(0, now);
      amp.gain.linearRampToValueAtTime(0.09, now + 0.03);
      amp.gain.linearRampToValueAtTime(0.0001, now + 1.15);
      osc.connect(amp).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.2);
    }
    await this.wait(1250);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
