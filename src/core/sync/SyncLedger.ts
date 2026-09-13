import type { TrialRepository } from "../storage/TrialRepository";
import type { SyncRecordKind } from "../types";

export type LedgerKind = SyncRecordKind | "tombstone";

type SentIds = Record<LedgerKind, Set<string>>;

interface LedgerState {
  cursor: number;
  sent: SentIds;
}

/** Where ledgers are kept: the repository's database, beside the records they describe. */
type LedgerStore = Pick<TrialRepository, "loadLedger" | "saveLedger">;

const VERSION = 1;

function noneSent(): SentIds {
  return { trial: new Set(), range: new Set(), session: new Set(), phrase: new Set(), tombstone: new Set() };
}

/**
 * What this device has already exchanged with one account: the server
 * cursor it has applied, and the id of every record and deletion it has
 * pushed or pulled.
 *
 * A set of sent ids rather than a createdAt watermark, because createdAt says
 * when a record was made, not when this device got it: an imported backup,
 * and every pull, insert records dated long before the last sync, and a
 * watermark would never push them on. Ids are unique per kind and records
 * are immutable, so the set is exact.
 *
 * Keyed by user id, so signing in to a different account starts a fresh
 * ledger and this device's practice joins that account too. It lives in the
 * repository's database rather than localStorage: an id per record soon
 * outgrows a 5 MB quota, and clearing the records must clear it too.
 */
export class SyncLedger {
  private constructor(
    private readonly store: LedgerStore,
    /** The account this ledger describes. */
    readonly userId: string,
    private readonly state: LedgerState,
  ) {}

  /** The ledger saved for `userId`; absent or corrupt means a fresh one, which only costs a full resync. */
  static async load(userId: string, store: LedgerStore): Promise<SyncLedger> {
    return new SyncLedger(store, userId, read(await store.loadLedger(userId)) ?? { cursor: 0, sent: noneSent() });
  }

  /** Drops the ledger saved for `userId`, for an account that no longer exists. */
  static forget(userId: string, store: Pick<TrialRepository, "forgetLedger">): Promise<void> {
    return store.forgetLedger(userId);
  }

  /** The last server seq this device has applied. */
  get cursor(): number {
    return this.state.cursor;
  }

  hasSent(kind: LedgerKind, id: string): boolean {
    return this.state.sent[kind].has(id);
  }

  markSent(kind: LedgerKind, ids: Iterable<string>): void {
    for (const id of ids) this.state.sent[kind].add(id);
  }

  setCursor(cursor: number): void {
    this.state.cursor = cursor;
  }

  /** Persists the ledger. A failure (storage full, say) is the caller's to see: syncing on unsaved would redo it all next time. */
  async save(): Promise<void> {
    const sent = Object.fromEntries(Object.entries(this.state.sent).map(([kind, ids]) => [kind, [...ids]]));
    await this.store.saveLedger(this.userId, { version: VERSION, cursor: this.state.cursor, sent });
  }
}

function read(value: unknown): LedgerState | null {
  const saved = value as { version?: unknown; cursor?: unknown; sent?: Record<string, unknown> } | null | undefined;
  if (
    saved?.version !== VERSION ||
    typeof saved.cursor !== "number" ||
    !Number.isSafeInteger(saved.cursor) ||
    saved.cursor < 0
  ) {
    return null;
  }
  let cursor = saved.cursor;
  const sent = noneSent();
  for (const kind of Object.keys(sent) as LedgerKind[]) {
    const ids = saved.sent?.[kind];
    if (ids === undefined) {
      // Saved by a version of the app that didn't know this kind, so it skipped that kind's records as it pulled:
      // pull again from the start to fetch them. Nothing of the kind was sent, and nothing else is sent twice.
      cursor = 0;
      continue;
    }
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
    for (const id of ids) sent[kind].add(id);
  }
  return { cursor, sent };
}
