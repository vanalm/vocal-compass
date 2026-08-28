import type { RangeMeasurement, TrialRecord } from "../types";

/** Export payload shape; version 2 added range measurements. */
export interface ExportPayload {
  app: string;
  version: number;
  trials: TrialRecord[];
  ranges: RangeMeasurement[];
}

/**
 * Persistence seam. IndexedDbTrialRepository is the browser default;
 * MemoryTrialRepository backs tests and environments without IndexedDB.
 * A sync backend implements the same interface.
 */
export interface TrialRepository {
  save(record: TrialRecord): Promise<void>;
  all(): Promise<TrialRecord[]>;
  saveRange(measurement: RangeMeasurement): Promise<void>;
  ranges(): Promise<RangeMeasurement[]>;
  clear(): Promise<void>;
  exportJson(): Promise<string>;
  importJson(json: string): Promise<number>;
}

export function buildExportJson(trials: TrialRecord[], ranges: RangeMeasurement[]): string {
  const payload: ExportPayload = { app: "vocal-compass", version: 2, trials, ranges };
  return JSON.stringify(payload, null, 2);
}

export function parseImportJson(json: string): { trials: TrialRecord[]; ranges: RangeMeasurement[] } {
  const parsed = JSON.parse(json) as Partial<ExportPayload>;
  return { trials: parsed.trials ?? [], ranges: parsed.ranges ?? [] };
}

export class MemoryTrialRepository implements TrialRepository {
  private records: TrialRecord[] = [];
  private measurements: RangeMeasurement[] = [];

  async save(record: TrialRecord): Promise<void> {
    this.records = this.records.filter((r) => r.id !== record.id);
    this.records.push(record);
  }

  async all(): Promise<TrialRecord[]> {
    return [...this.records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveRange(measurement: RangeMeasurement): Promise<void> {
    this.measurements = this.measurements.filter((m) => m.id !== measurement.id);
    this.measurements.push(measurement);
  }

  async ranges(): Promise<RangeMeasurement[]> {
    return [...this.measurements].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async clear(): Promise<void> {
    this.records = [];
    this.measurements = [];
  }

  async exportJson(): Promise<string> {
    return buildExportJson(await this.all(), await this.ranges());
  }

  async importJson(json: string): Promise<number> {
    const { trials, ranges } = parseImportJson(json);
    for (const t of trials) await this.save(t);
    for (const r of ranges) await this.saveRange(r);
    return trials.length + ranges.length;
  }
}
