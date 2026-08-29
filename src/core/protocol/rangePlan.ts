/**
 * Range training grounded in the strongest available evidence — which is
 * narrower than pedagogy implies. The literature synthesis (2026-08-28,
 * docs/range-training-evidence.md) supports exactly one exercise program for
 * measured vocal-capacity expansion: Stemple's Vocal Function Exercises.
 *   - Stemple 1994 (J Voice 8:271): 4 weeks, RCT vs placebo+control,
 *     frequency range improved in untrained women.
 *   - Guzman 2020 (JSLHR 63:1044): 10 weeks, RCT n=40 opera students,
 *     voice-range-profile area expanded vs hygiene-only.
 *   - Bane 2019 (IJSLP 21:37): dose probe — twice daily, 6 weeks, no
 *     observed toxicity; low dose was insufficient.
 *   - Bane 2019b (IJSLP 21:175): the semi-occluded posture is load-bearing;
 *     open-vowel VFE lost the effect.
 * SOVT gestures (trills, straw) have good evidence for EFFICIENCY and
 * reduced vocal-fold collision (Titze 2006; Guzman 2015: trills give the
 * lowest contact quotient) but no direct evidence for range expansion —
 * they are the safe vehicle here, not the engine.
 */

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

/** Printz 2018: healthy adults re-tested +1.4 st with no training at all. */
export const MEASUREMENT_DRIFT_ST = 1.4;
/**
 * No published minimal-detectable-change exists; ~3 st is the inference from
 * retest drift vs the ~4 st seen after surgically removing a vocal-fold
 * lesion (Salmen 2017). Below this, report noise, not progress.
 */
export const MEANINGFUL_RANGE_CHANGE_ST = 3;

export function vocalFunctionExercises(): RangePlan {
  const steps: RangeStep[] = [
    {
      id: "warmup",
      title: "Warm-up tone",
      what: "Sustain a soft lip trill on one comfortable mid-range note for as long as it stays easy.",
      why: "A held tone on the lowest-collision gesture wakes the system up without loading it.",
      evidence: "Stemple 1994; trills give the lowest vocal-fold contact of any gesture (Guzman 2015).",
      sovt: true,
      maxSeconds: 30,
    },
    {
      id: "stretch",
      title: "Stretch glide up",
      what: "Glide on a lip trill from your lowest comfortable note to your highest, without pushing at the top.",
      why: "The slow upward glide is the program's stretch, reaching the top of the range under minimal collision.",
      evidence: "VFE glides expanded measured range in Stemple 1994 and VRP area in Guzman 2020.",
      sovt: true,
      maxSeconds: 20,
    },
    {
      id: "contract",
      title: "Contract glide down",
      what: "Glide on a lip trill from your highest comfortable note down to your lowest.",
      why: "The downward glide works the opposite adjustment and keeps the two ends of the range connected.",
      evidence: "Second half of the VFE glide pair (Stemple 1994; Guzman 2020).",
      sovt: true,
      maxSeconds: 20,
    },
    {
      id: "power",
      title: "Sustained notes",
      what: "Sustain a soft trill on each note of a five-note scale in your comfortable middle, as long as each stays easy.",
      why: "Long soft holds build the efficiency that VFE's measured gains actually came from.",
      evidence: "MPT and airflow gains: Stemple 1994, Sabol 1995; semi-occlusion is load-bearing (Bane 2019b).",
      sovt: true,
      maxSeconds: 60,
    },
  ];
  return {
    id: "vfe",
    title: "Vocal Function Exercises",
    steps,
    repsPerExercise: 2,
    timesPerDay: 2, // Bane 2019: twice daily; once was insufficient
    weeksToEffect: 4, // Stemple 1994 saw gains at 4 weeks; Guzman ran 10
  };
}

export interface RangeVerdict {
  deltaSemitones: number;
  direction: "up" | "down" | "flat";
  /** Only true when the change clears the meaningful-change threshold. */
  meaningful: boolean;
  label: string;
}

/**
 * Judges a range change against measurement reality instead of celebrating
 * every uptick: sub-threshold gains are reported as within noise (retest
 * alone inflates range ~1.4 st), and a meaningful LOSS is surfaced as the
 * health signal it is — "loss of high notes" is on NIDCD's warning list.
 */
export function rangeChangeVerdict(firstSt: number, latestSt: number): RangeVerdict {
  const delta = Math.round((latestSt - firstSt) * 10) / 10;
  const meaningful = Math.abs(delta) >= MEANINGFUL_RANGE_CHANGE_ST;
  const direction = delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  let label: string;
  if (direction === "flat") {
    label = "No change.";
  } else if (!meaningful) {
    label = `Within measurement noise (repeat tests drift ~${MEASUREMENT_DRIFT_ST} st on their own) — not yet a real ${direction === "up" ? "gain" : "loss"}.`;
  } else if (direction === "up") {
    label = `A real gain: ${delta} st clears the ~${MEANINGFUL_RANGE_CHANGE_ST} st meaningful-change threshold.`;
  } else {
    label = `A real loss of ${Math.abs(delta)} st — losing range is a health signal; worth a check with a clinician, not harder practice.`;
  }
  return { deltaSemitones: delta, direction, meaningful, label };
}
