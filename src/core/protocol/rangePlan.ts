/** Optional exploration, not a reproduction of VFE or a validated range treatment.
 * Named export retained for compatibility with existing callers and saved sessions.
 */
import { LEGACY_LOW_CUT } from "../pitch/micFilter";
import type { RangeMeasurement } from "../types";

export interface RangeStep {
  id: string;
  title: string;
  /** One sentence: what to do. */
  what: string;
  /** One sentence: why it is in the program. */
  why: string;
  /** The citation carrying this step — shown, not asserted. */
  evidence: string;
  /** Every step rides a semi-occluded gesture; see module docstring. */
  sovt: boolean;
  /** Hard cap; software cannot hear strain, so structure bounds the load. */
  maxSeconds: number;
}

export interface RangePlan {
  id: string;
  title: string;
  steps: RangeStep[];
  repsPerExercise: number;
  timesPerDay: number;
  weeksToEffect: number;
}

/** Mean laboratory retest shift, NOT an individual error threshold. */
export const MEASUREMENT_DRIFT_ST = 1.4;
/** @deprecated No validated minimum detectable change exists for this instrument. */
export const MEANINGFUL_RANGE_CHANGE_ST: number | null = null;

export function vocalFunctionExercises(): RangePlan {
  return {
    id: "gentle-exploration-v2", title: "Optional easy-voice exploration", repsPerExercise: 1,
    timesPerDay: 0, weeksToEffect: 0,
    steps: [
      {id:"warmup", title:"One easy tone", what:"Try a short, soft lip trill on an easy middle note, only if you already find this gesture comfortable.", why:"An optional low-demand check-in, not a test of maximum duration.", evidence:"An app design choice; not the original VFE protocol or a proven range-expansion exercise.", sovt:true,maxSeconds:5},
      {id:"stretch",title:"Small glide up",what:"Make a small, easy upward glide, staying well inside your comfortable range. Do not aim for your highest note.",why:"Explore a change in pitch without chasing an extreme.",evidence:"Range-matching research does not establish higher-belt or physical-range gains from this routine.",sovt:true,maxSeconds:5},
      {id:"contract",title:"Small glide down",what:"Return gently toward the easy starting note. Stop if the gesture becomes tight or uncomfortable.",why:"Keep exploration brief and reversible.",evidence:"Comfort guidance is not an acoustic safety certification.",sovt:true,maxSeconds:5},
      {id:"power",title:"Rest and reflect",what:"Stop phonation. Notice whether your speaking voice feels unchanged and easy. Skip further work if it does not.",why:"Completion is less important than comfort.",evidence:"NIDCD advises against singing when hoarse or tired. Read the linked safety guidance in the Guide.",sovt:false,maxSeconds:20},
    ],
  };
}

export interface RangeVerdict {
  deltaSemitones: number;
  direction: "up" | "down" | "flat";
  /** Only true when the change clears the meaningful-change threshold. */
  meaningful: boolean;
  label: string;
}

/** A descriptive change only; never certify a real gain or loss from a fixed threshold. */
export function rangeChangeVerdict(firstSt: number, latestSt: number): RangeVerdict {
  const delta = Math.round((latestSt-firstSt)*10)/10;
  const direction = delta===0?"flat":delta>0?"up":"down";
  const label = delta===0 ? "Same observed span. This does not establish identical vocal capacity."
    : `Observed ${direction==="up"?"increase":"decrease"}: ${Math.abs(delta)} semitones. Repeat on another day with the same method and microphone; no individual meaningful-change threshold is validated for this app.`;
  return {deltaSemitones:delta,direction,meaningful:false,label};
}

export interface RangeComparison {
  verdict: RangeVerdict;
  /** Set when the two measurements were taken with different methods. */
  caveat: string | null;
}

type Comparable = Pick<RangeMeasurement, "lowMidi" | "highMidi" | "method" | "micLowCut">;

/** Change in span between two measurements, flagged when the method or microphone filter differ. */
export function compareRange(previous: Comparable | undefined, current: Comparable): RangeComparison | null {
  if (!previous) return null;
  const verdict = rangeChangeVerdict(previous.highMidi - previous.lowMidi, current.highMidi - current.lowMidi);
  const differences: string[] = [];
  if (!previous.method || !current.method) differences.push("unknown measurement method");
  else if (previous.method !== current.method) differences.push("method");
  if ((previous.micLowCut ?? LEGACY_LOW_CUT) !== (current.micLowCut ?? LEGACY_LOW_CUT)) {
    differences.push("microphone filter");
  }
  const caveat =
    differences.length > 0
      ? `The earlier measurement used a different ${differences.join(" and ")}, so compare with caution.`
      : null;
  return { verdict, caveat };
}
