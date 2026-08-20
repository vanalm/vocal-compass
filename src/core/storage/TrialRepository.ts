import type { TrialRecord } from "../types";

/**
 * Persistence seam. IndexedDbTrialRepository is the browser default;
 * MemoryTrialRepository backs tests and environments without IndexedDB.
 * A future sync backend implements the same interface.
 */
export interface TrialRepository {
  save(record: TrialRecord): Promise<void>;
  all(): Promise<TrialRecord[]>;
  clear(): Promise<void>;
  exportJson(): Promise<string>;
  importJson(json: string): Promise<number>;
}

export class MemoryTrialRepository implements TrialRepository {
  private records: TrialRecord[] = [];

  async save(record: TrialRecord): Promise<void> {
    this.records.push(record);
  }

  async all(): Promise<TrialRecord[]> {
    return [...this.records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async clear(): Promise<void> {
    this.records = [];
  }

  async exportJson(): Promise<string> {
    return JSON.stringify({ app: "vocal-compass", version: 1, trials: await this.all() }, null, 2);
  }

  async importJson(json: string): Promise<number> {
    const parsed = JSON.parse(json) as { trials?: TrialRecord[] };
    const trials = parsed.trials ?? [];
    for (const t of trials) await this.save(t);
    return trials.length;
  }
}
