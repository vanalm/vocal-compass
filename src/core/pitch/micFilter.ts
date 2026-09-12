import { hzToMidi } from "../music/theory";
import type { LowCutSetting, RangeStepResult } from "../types";
import { RANGE_WALK_DEFAULTS } from "./RangeWalk";

export type { LowCutSetting } from "../types";

/**
 * The microphone's low-cut (high-pass) filter. It removes rumble — traffic,
 * engines, air handling — before pitch detection, at the cost of weakening
 * the lowest sung notes once the cutoff reaches into a deep voice's range.
 * The right trade-off depends on the room, so it is a setting, and the range
 * walk says when its results point at the filter rather than the voice.
 */

export interface LowCutOption {
  id: LowCutSetting;
  label: string;
  hz: number | null;
  /** One sentence: when to use it. */
  when: string;
}

export const LOW_CUT_OPTIONS: readonly LowCutOption[] = [
  { id: "off", label: "Off", hz: null, when: "Nothing is cut — for quiet rooms and the deepest voices." },
  { id: "60", label: "Standard", hz: 60, when: "Cuts rumble below the singing range — right for most rooms." },
  { id: "80", label: "Noisy", hz: 80, when: "For cars, fans and traffic — can clip a bass voice's lowest notes." },
  { id: "100", label: "Very noisy", hz: 100, when: "For loud rumble — cuts deep notes below about G2." },
];

export const DEFAULT_LOW_CUT: LowCutSetting = "60";
/** Every measurement taken before this setting existed ran through a fixed 80 Hz filter. */
export const LEGACY_LOW_CUT: LowCutSetting = "80";

const ORDER = LOW_CUT_OPTIONS.map((o) => o.id);

export function lowCutOption(setting: LowCutSetting): LowCutOption {
  return LOW_CUT_OPTIONS.find((o) => o.id === setting) ?? LOW_CUT_OPTIONS[1];
}

export function lowCutLabel(setting: LowCutSetting): string {
  const option = lowCutOption(setting);
  return option.hz === null ? option.label : `${option.label} (${option.hz} Hz)`;
}

export interface LowCutNodeConfig {
  type: "highpass" | "allpass";
  frequency: number;
  Q: number;
}

/** Butterworth: flat above the cutoff, no resonant bump. */
const BUTTERWORTH_Q = Math.SQRT1_2;

export function lowCutNodeConfig(setting: LowCutSetting): LowCutNodeConfig {
  const { hz } = lowCutOption(setting);
  // An allpass leaves every frequency's level untouched, so "off" keeps one
  // fixed audio graph and the setting can change while capture is live.
  return hz === null
    ? { type: "allpass", frequency: 1000, Q: BUTTERWORTH_Q }
    : { type: "highpass", frequency: hz, Q: BUTTERWORTH_Q };
}

export function applyLowCut(node: BiquadFilterNode, setting: LowCutSetting): void {
  const config = lowCutNodeConfig(setting);
  node.type = config.type;
  node.frequency.value = config.frequency;
  node.Q.value = config.Q;
}

export interface FilterAdvice {
  kind: "lower" | "raise";
  suggest: LowCutSetting;
  message: string;
}

/**
 * A 2nd-order high-pass still takes about a decibel off a fundamental a
 * fourth above its cutoff, and far more below it: a range floor inside that
 * zone is where the filter can plausibly be what stopped the walk.
 */
const FILTER_REACH_SEMITONES = 5;
/** A miss inside the walk's pitch tolerance was the right note failing to hold. */
const DROPOUT_CENTS = RANGE_WALK_DEFAULTS.toleranceSemitones * 100;
/** Share of the singer's-turn frames flagged too noisy before suggesting a higher cut. */
export const NOISY_SHARE_FOR_ADVICE = 0.3;

function isDropout(step: RangeStepResult): boolean {
  if (step.hit || step.octaveOff !== null) return false;
  return step.sungMidi === null || step.centsOff === null || Math.abs(step.centsOff) <= DROPOUT_CENTS;
}

/**
 * The floor was probably set by the filter, not the voice, when it sits
 * within the filter's reach AND every attempt below it was a dropout —
 * silence or the right pitch failing to hold — rather than a different note.
 */
export function lowNoteFilterAdvice(steps: RangeStepResult[], setting: LowCutSetting): FilterAdvice | null {
  const { hz } = lowCutOption(setting);
  if (hz === null) return null;
  const cutoffMidi = hzToMidi(hz);
  // At or below the walk's lowest measurable note the filter removes nothing
  // the detector could hear, so a lower setting cannot reveal more range.
  if (cutoffMidi <= RANGE_WALK_DEFAULTS.minTargetMidi) return null;
  const hits = steps.filter((s) => s.hit);
  if (hits.length === 0) return null;
  const floor = Math.min(...hits.map((s) => s.targetMidi));
  if (floor - cutoffMidi > FILTER_REACH_SEMITONES) return null;
  const below = steps.filter((s) => !s.hit && s.direction === "down" && s.targetMidi < floor);
  if (below.length === 0 || !below.every(isDropout)) return null;
  const suggest = ORDER[ORDER.indexOf(setting) - 1];
  return {
    kind: "lower",
    suggest,
    message: `Your lowest notes kept dropping out right where the microphone's ${hz} Hz low-cut filter starts cutting, so your voice may reach lower than this measured. Try ${lowCutLabel(suggest)} and measure again.`,
  };
}

/** The next setting that cuts more rumble, or null when already at the strongest. */
export function strongerLowCut(setting: LowCutSetting): LowCutSetting | null {
  return setting === "off" || setting === "60" ? "80" : setting === "80" ? "100" : null;
}

export function noiseFilterAdvice(noisyShare: number, setting: LowCutSetting): FilterAdvice | null {
  if (noisyShare < NOISY_SHARE_FOR_ADVICE) return null;
  const suggest = strongerLowCut(setting);
  if (suggest === null) return null;
  return {
    kind: "raise",
    suggest,
    message: `It was noisy during your turns. If the noise is a low rumble — a car, a fan, air conditioning — try ${lowCutLabel(suggest)}. A low-cut filter won't help with voices or hiss.`,
  };
}
