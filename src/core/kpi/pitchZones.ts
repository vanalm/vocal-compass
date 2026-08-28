import { noteName } from "../music/theory";
import type { TrialRecord } from "../types";

export interface PitchZone {
  /** Zone start, a multiple of the bin size. */
  lowMidi: number;
  /** e.g. "C4 – D4". */
  label: string;
  scored: number;
  /** Destination accuracy in this zone; null when nothing scored here. */
  accuracy: number | null;
}

const BIN = 3;

/**
 * Destination accuracy bucketed by target pitch: the register heat map's
 * data. Zones span the full occupied range contiguously (gaps render as
 * empty zones, not missing rows) so weak registers are visible as holes.
 */
export function pitchZones(trials: TrialRecord[]): PitchZone[] {
  const scored = trials.filter((t) => t.scored);
  if (scored.length === 0) return [];

  const zoneOf = (midi: number) => Math.floor(midi / BIN) * BIN;
  const counts = new Map<number, { scored: number; hits: number }>();
  for (const t of scored) {
    const zone = zoneOf(t.definition.targetMidi);
    const entry = counts.get(zone) ?? { scored: 0, hits: 0 };
    entry.scored += 1;
    if (t.destinationMatch) entry.hits += 1;
    counts.set(zone, entry);
  }

  const zones = [...counts.keys()];
  const lo = Math.min(...zones);
  const hi = Math.max(...zones);
  const result: PitchZone[] = [];
  for (let z = lo; z <= hi; z += BIN) {
    const entry = counts.get(z);
    result.push({
      lowMidi: z,
      label: `${noteName(z)} – ${noteName(z + BIN - 1)}`,
      scored: entry?.scored ?? 0,
      accuracy: entry ? entry.hits / entry.scored : null,
    });
  }
  return result;
}
