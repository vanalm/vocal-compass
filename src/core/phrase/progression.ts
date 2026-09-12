import type { GuideStrength, PhraseRecord, SingerRole } from "../types";

export interface PhraseProgress {
  /** The guide strength to assign next: full → anchor → none as passes accrue. */
  guide: GuideStrength;
  /** Best guide-free first-take accuracy, the cold score; null before any. */
  bestVerified: number | null;
  attempts: number;
}

const PASS_ACCURACY = 0.8;
const LADDER: GuideStrength[] = ["full", "anchor", "none"];

/**
 * The guide-fade ladder, derived from saved records rather than stored as
 * state: pass a strength (>= 80% sequence accuracy) and the next assignment
 * fades one step. Practice retries can improve practice numbers; the
 * verified score only ever comes from guide-free first takes.
 */
export function phraseProgress(
  records: PhraseRecord[],
  phraseId: string,
  role: SingerRole,
): PhraseProgress {
  const mine = records.filter((r) => r.phraseId === phraseId && r.role === role);
  const passed = new Set(
    mine.filter((r) => r.sequenceAccuracy >= PASS_ACCURACY).map((r) => r.guide),
  );
  const guide = LADDER.find((g) => !passed.has(g)) ?? "none";
  const verified = mine.filter((r) => r.verified).map((r) => r.sequenceAccuracy);
  return {
    guide,
    bestVerified: verified.length ? Math.max(...verified) : null,
    attempts: mine.length,
  };
}
