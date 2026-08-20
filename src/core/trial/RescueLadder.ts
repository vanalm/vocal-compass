/**
 * The graded rescue system (PRD §8). "I'm lost" opens a ladder rather than
 * revealing the answer; the lowest level that restores the target is data.
 */
export interface RescueLevel {
  level: number;
  title: string;
  gives: string;
  preserves: string;
}

export const RESCUE_LEVELS: RescueLevel[] = [
  { level: 1, title: "Direction only", gives: "Higher, lower, or same", preserves: "Distance and destination" },
  { level: 2, title: "Route landmarks", gives: "Tonic + scale stepping stones", preserves: "Final landing from your internal map" },
  { level: 3, title: "Replay the relation", gives: "Start → destination pair", preserves: "Vocal execution and short retention" },
  { level: 4, title: "Sound the target", gives: "The destination itself", preserves: "Direct pitch landing only" },
];

export const RECOVERY_SCRIPT =
  "Stop. Hear home. Hear your current note. Choose direction. Hear the destination once internally. Sing it on “oo.” Restore the word afterward.";

export class RescueLadder {
  private highestUsed = 0;
  private lostAt: number | null = null;

  get hintLevel(): number {
    return this.highestUsed;
  }

  get isLost(): boolean {
    return this.lostAt != null;
  }

  markLost(now: number): void {
    if (this.lostAt == null) this.lostAt = now;
  }

  use(level: number): void {
    this.highestUsed = Math.max(this.highestUsed, level);
  }

  /** ms from the lost event to a scored commitment; null if never lost. */
  recoveryTime(commitAt: number): number | null {
    return this.lostAt == null ? null : Math.max(0, commitAt - this.lostAt);
  }

  reset(): void {
    this.highestUsed = 0;
    this.lostAt = null;
  }
}
