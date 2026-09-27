import { SOLFEGE, type TrialDefinition } from "../../core";

type MapTrial = Pick<TrialDefinition, "keyName" | "tonicMidi" | "startMidi" | "targetMidi" | "scale">;

/**
 * The key as a ladder of its scale steps, highest on top, spanning home, where
 * you are and the target. It is the map Tonal north asks you to navigate:
 * the target is found by its place on it, not by its distance from the last
 * note heard. In review it also marks the note you sang.
 */
export function KeyMap({ trial, sungMidi = null }: { trial: MapTrial; sungMidi?: number | null }) {
  const marked = [trial.tonicMidi, trial.startMidi, trial.targetMidi, ...(sungMidi === null ? [] : [sungMidi])];
  const lowest = Math.min(...marked);
  const highest = Math.max(...marked);
  const degreeOf = (midi: number) => trial.scale.indexOf((((midi - trial.tonicMidi) % 12) + 12) % 12);

  const rungs: Array<{ midi: number; degree: number }> = [];
  for (let midi = highest; midi >= lowest; midi -= 1) {
    const degree = degreeOf(midi);
    // An out-of-key note sung gets its own rung, between the steps it fell between.
    if (degree >= 0 || midi === sungMidi) rungs.push({ midi, degree });
  }

  const describe = (midi: number) => {
    const degree = degreeOf(midi);
    return degree >= 0 ? `${SOLFEGE[degree]} (${degree + 1})` : "a note outside the key";
  };
  const summary =
    `Key map of ${trial.keyName}: you're on ${describe(trial.startMidi)}; sing ${describe(trial.targetMidi)}` +
    (trial.targetMidi > trial.startMidi ? ", above you." : ", below you.") +
    (sungMidi === null ? "" : ` You sang ${describe(sungMidi)}.`);

  return (
    <figure className="vc-keymap" role="img" aria-label={summary}>
      <figcaption>Key of {trial.keyName}</figcaption>
      <ol>
        {rungs.map(({ midi, degree }) => {
          const marks = [
            degree === 0 && "Home",
            midi === trial.startMidi && "You're here",
            midi === trial.targetMidi && "Sing this",
            midi === sungMidi && "You sang",
          ].filter((mark): mark is string => Boolean(mark));
          const classes = [
            degree === 0 && "home",
            midi === trial.startMidi && "here",
            midi === trial.targetMidi && "target",
            midi === sungMidi && "sung",
            degree < 0 && "outside",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={midi} className={classes}>
              <span className="vc-keymap-step">{degree >= 0 ? `${degree + 1} ${SOLFEGE[degree]}` : "·"}</span>
              <span className="vc-keymap-marks">
                {marks.map((mark) => (
                  <em key={mark}>{mark}</em>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
