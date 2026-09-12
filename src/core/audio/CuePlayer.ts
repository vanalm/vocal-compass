import { midiToHz } from "../music/theory";
import type { GuideStrength } from "../types";
import type { RealizedPhrase } from "../phrase/realize";

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

  /** Schedule one note at an absolute context time — rhythm-accurate. */
  private scheduleNote(
    ctx: AudioContext,
    midi: number,
    whenS: number,
    durS: number,
    gain: number,
    type: OscillatorType = "triangle",
  ): void {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = midiToHz(midi);
    amp.gain.setValueAtTime(0, whenS);
    amp.gain.linearRampToValueAtTime(gain, whenS + 0.02);
    amp.gain.setValueAtTime(gain, Math.max(whenS + 0.03, whenS + durS - 0.08));
    amp.gain.linearRampToValueAtTime(0.0001, whenS + durS);
    osc.connect(amp).connect(ctx.destination);
    osc.start(whenS);
    osc.stop(whenS + durS + 0.02);
  }

  /** Four woodblock-ish ticks so the singer knows exactly when beat one lands. */
  async playCountIn(bpm: number, beats = 4): Promise<void> {
    const ctx = await this.ctx();
    const beatS = 60 / bpm;
    const start = ctx.currentTime + 0.05;
    for (let i = 0; i < beats; i += 1) {
      this.scheduleNote(ctx, i === 0 ? 88 : 84, start + i * beatS, 0.09, 0.12, "square");
    }
    await this.wait(Math.round(beats * beatS * 1000) + 80);
  }

  /**
   * Play a realized phrase with the given guide strength: full = every note,
   * anchor = first and last only, none = melody muted. Chord pads (when the
   * phrase has a Nashville timeline) always sound — for chord-tone roles the
   * pads ARE the exercise. Resolves when playback ends.
   */
  async playRealizedPhrase(realized: RealizedPhrase, guide: GuideStrength): Promise<void> {
    const ctx = await this.ctx();
    const start = ctx.currentTime + 0.06;
    const guided =
      guide === "full"
        ? realized.notes
        : guide === "anchor" && realized.notes.length > 0
          ? [realized.notes[0], realized.notes[realized.notes.length - 1]]
          : [];
    for (const note of guided) {
      this.scheduleNote(ctx, note.midi, start + note.startMs / 1000, note.durationMs / 1000, 0.16);
    }
    for (const chord of realized.chords) {
      for (const midi of chord.midis) {
        this.scheduleNote(ctx, midi, start + chord.startMs / 1000, chord.durationMs / 1000, 0.05, "sine");
      }
    }
    await this.wait(realized.totalMs + 120);
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
