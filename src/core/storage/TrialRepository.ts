import type { ExerciseSession, PhraseRecord, RangeMeasurement, Tombstone, TrialRecord } from "../types";

/** Export payload; v2 ranges, v3 sessions, v4 tombstones, v5 phrases. */
export interface ExportPayload {
  app: string;
  version: number;
  trials: TrialRecord[];
  ranges: RangeMeasurement[];
  sessions: ExerciseSession[];
  phrases: PhraseRecord[];
  tombstones: Tombstone[];
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
  savePhrase(record: PhraseRecord): Promise<void>;
  phrases(): Promise<PhraseRecord[]>;
  /** Remove a trial and record a tombstone so sync cannot resurrect it. */
  deleteTrial(id: string): Promise<void>;
  /** Enforce a (possibly remote) tombstone: store it and drop its target. */
  applyTombstone(stone: Tombstone): Promise<void>;
  tombstones(): Promise<Tombstone[]>;
  /**
   * What this device has exchanged with one account (see SyncLedger), kept
   * beside the records it describes: no storage quota small enough to
   * outgrow, and `clear` takes it with them.
   */
  loadLedger(userId: string): Promise<unknown>;
  saveLedger(userId: string, ledger: unknown): Promise<void>;
  forgetLedger(userId: string): Promise<void>;
  /** Removes every record, tombstone and sync ledger. */
  clear(): Promise<void>;
  exportJson(): Promise<string>;
  importJson(json: string): Promise<number>;
}

export function buildExportJson(
  trials: TrialRecord[],
  ranges: RangeMeasurement[],
  sessions: ExerciseSession[],
  phrases: PhraseRecord[],
  tombstones: Tombstone[],
): string {
  const payload: ExportPayload = {
    app: "vocal-compass",
    version: 5,
    trials,
    ranges,
    sessions,
    phrases,
    tombstones,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseImportJson(json: string): {
  trials: TrialRecord[];
  ranges: RangeMeasurement[];
  sessions: ExerciseSession[];
  phrases: PhraseRecord[];
  tombstones: Tombstone[];
} {
  const parsed = JSON.parse(json) as Partial<ExportPayload>;
  return {
    trials: parsed.trials ?? [],
    ranges: parsed.ranges ?? [],
    sessions: parsed.sessions ?? [],
    phrases: parsed.phrases ?? [],
    tombstones: parsed.tombstones ?? [],
  };
}

/** Shared import policy: dead records stay dead, even from old backups. */
export async function importInto(repo: TrialRepository, json: string): Promise<number> {
  const { trials, ranges, sessions, phrases, tombstones } = parseImportJson(json);
  for (const stone of tombstones) await repo.applyTombstone(stone);
  const dead = new Set((await repo.tombstones()).map((s) => `${s.kind}:${s.recordId}`));
  let imported = tombstones.length;
  for (const ph of phrases) {
    if (dead.has(`phrase:${ph.id}`)) continue;
    await repo.savePhrase(ph);
    imported += 1;
  }
  for (const t of trials) {
    if (dead.has(`trial:${t.id}`)) continue;
    await repo.save(t);
    imported += 1;
  }
  for (const r of ranges) {
    if (dead.has(`range:${r.id}`)) continue;
    await repo.saveRange(r);
    imported += 1;
  }
  for (const x of sessions) {
    if (dead.has(`session:${x.id}`)) continue;
    await repo.saveSession(x);
    imported += 1;
  }
  return imported;
}

export class MemoryTrialRepository implements TrialRepository {
  private records: TrialRecord[] = [];
  private measurements: RangeMeasurement[] = [];
  private exerciseSessions: ExerciseSession[] = [];
  private phraseRecords: PhraseRecord[] = [];
  private stones: Tombstone[] = [];
  private ledgers = new Map<string, unknown>();

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

  async savePhrase(record: PhraseRecord): Promise<void> {
    this.phraseRecords = this.phraseRecords.filter((r) => r.id !== record.id);
    this.phraseRecords.push(record);
  }

  async phrases(): Promise<PhraseRecord[]> {
    return [...this.phraseRecords].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteTrial(id: string): Promise<void> {
    await this.applyTombstone({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      kind: "trial",
      recordId: id,
    });
  }

  async applyTombstone(stone: Tombstone): Promise<void> {
    if (!this.stones.some((s) => s.kind === stone.kind && s.recordId === stone.recordId)) {
      this.stones.push(stone);
    }
    if (stone.kind === "trial") this.records = this.records.filter((r) => r.id !== stone.recordId);
    if (stone.kind === "range")
      this.measurements = this.measurements.filter((m) => m.id !== stone.recordId);
    if (stone.kind === "session")
      this.exerciseSessions = this.exerciseSessions.filter((s) => s.id !== stone.recordId);
    if (stone.kind === "phrase")
      this.phraseRecords = this.phraseRecords.filter((r) => r.id !== stone.recordId);
  }

  async tombstones(): Promise<Tombstone[]> {
    return [...this.stones].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Copied in and out, as IndexedDB does, so a caller's later changes never reach what was saved.
  async loadLedger(userId: string): Promise<unknown> {
    return structuredClone(this.ledgers.get(userId));
  }

  async saveLedger(userId: string, ledger: unknown): Promise<void> {
    this.ledgers.set(userId, structuredClone(ledger));
  }

  async forgetLedger(userId: string): Promise<void> {
    this.ledgers.delete(userId);
  }

  async clear(): Promise<void> {
    this.records = [];
    this.measurements = [];
    this.exerciseSessions = [];
    this.phraseRecords = [];
    this.stones = [];
    this.ledgers.clear();
  }

  async exportJson(): Promise<string> {
    return buildExportJson(
      await this.all(),
      await this.ranges(),
      await this.sessions(),
      await this.phrases(),
      await this.tombstones(),
    );
  }

  async importJson(json: string): Promise<number> {
    return importInto(this, json);
  }
}
