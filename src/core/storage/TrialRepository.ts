import type { ExerciseSession, RangeMeasurement, TrialRecord } from "../types";

/** Export payload shape; v2 added ranges, v3 exercise sessions. */
export interface ExportPayload {
  app: string;
  version: number;
  trials: TrialRecord[];
  ranges: RangeMeasurement[];
  sessions: ExerciseSession[];
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
  saveSession(session: ExerciseSession): Promise<void>;
  sessions(): Promise<ExerciseSession[]>;
  clear(): Promise<void>;
  exportJson(): Promise<string>;
  importJson(json: string): Promise<number>;
}

export function buildExportJson(
  trials: TrialRecord[],
  ranges: RangeMeasurement[],
  sessions: ExerciseSession[],
): string {
  const payload: ExportPayload = { app: "vocal-compass", version: 3, trials, ranges, sessions };
  return JSON.stringify(payload, null, 2);
}

export function parseImportJson(json: string): {
  trials: TrialRecord[];
  ranges: RangeMeasurement[];
  sessions: ExerciseSession[];
} {
  const parsed = JSON.parse(json) as Partial<ExportPayload>;
  return { trials: parsed.trials ?? [], ranges: parsed.ranges ?? [], sessions: parsed.sessions ?? [] };
}

export class MemoryTrialRepository implements TrialRepository {
  private records: TrialRecord[] = [];
  private measurements: RangeMeasurement[] = [];
  private exerciseSessions: ExerciseSession[] = [];

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

  async saveSession(session: ExerciseSession): Promise<void> {
    this.exerciseSessions = this.exerciseSessions.filter((s) => s.id !== session.id);
    this.exerciseSessions.push(session);
  }

  async sessions(): Promise<ExerciseSession[]> {
    return [...this.exerciseSessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async clear(): Promise<void> {
    this.records = [];
    this.measurements = [];
    this.exerciseSessions = [];
  }

  async exportJson(): Promise<string> {
    return buildExportJson(await this.all(), await this.ranges(), await this.sessions());
  }

  async importJson(json: string): Promise<number> {
    const { trials, ranges, sessions } = parseImportJson(json);
    for (const t of trials) await this.save(t);
    for (const r of ranges) await this.saveRange(r);
    for (const x of sessions) await this.saveSession(x);
    return trials.length + ranges.length + sessions.length;
  }
}
