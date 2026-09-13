import type { TrialRepository } from "../storage/TrialRepository";
import type { SyncRecordKind, Tombstone } from "../types";
import { SignedOutError, type ApiClient, type SyncRecord, type SyncRequest } from "./ApiClient";
import type { SyncLedger } from "./SyncLedger";

/** Items per request, well under the server's 500, so no single request carries a whole history. */
const BATCH_ITEMS = 200;
/** JSON characters per request, far under the server's body limit; one larger record still goes, alone. */
const BATCH_CHARS = 1_500_000;

export interface SyncResult {
  /** Records and deletions sent to the account, refused ones included. */
  pushed: number;
  /** Records and deletions from the account that changed this device. */
  pulled: number;
  /** Pushed items the server refused; they would fail every time, so they are not sent again. */
  rejected: number;
  /** Pulled items of a kind this version of the app doesn't know; a version that does fetches them again. */
  skipped: number;
}

/**
 * Every record kind this device syncs, and how to list its local records.
 * Keyed by kind, so the compiler refuses a kind that is missing here, and
 * its keys are the kinds a pulled item may have.
 */
const LOCAL: Record<SyncRecordKind, (repo: TrialRepository) => Promise<SyncRecord[]>> = {
  trial: async (repo) => (await repo.all()).map((record) => ({ kind: "trial" as const, record })),
  range: async (repo) => (await repo.ranges()).map((record) => ({ kind: "range" as const, record })),
  session: async (repo) => (await repo.sessions()).map((record) => ({ kind: "session" as const, record })),
  phrase: async (repo) => (await repo.phrases()).map((record) => ({ kind: "phrase" as const, record })),
};

const known = (kind: string): kind is SyncRecordKind => Object.hasOwn(LOCAL, kind);

/** A local record or deletion, under the kind and id the ledger knows it by. */
type Outgoing =
  | { kind: "tombstone"; id: string; stone: Tombstone }
  | { kind: SyncRecordKind; id: string; item: SyncRecord };

/**
 * Brings this device and one account up to date with each other: pushes
 * every local record and deletion the ledger has not seen sent, a batch per
 * request, and applies every change the server pages back.
 *
 * The ledger is saved after every page, and only once that page is applied,
 * so a sync that dies midway resumes from its last page instead of starting
 * over. Replaying a page is harmless: records are immutable and the server
 * ignores ids it already holds. Pulls change local data, so the caller
 * refreshes what it shows.
 *
 * Aborting `signal` stops it before its next ledger save, for when what the
 * ledger describes has changed underneath it.
 */
export async function syncAccount(
  repo: TrialRepository,
  api: Pick<ApiClient, "syncOnce">,
  ledger: SyncLedger,
  { signal }: { signal?: AbortSignal } = {},
): Promise<SyncResult> {
  const records = (await Promise.all(Object.values(LOCAL).map((list) => list(repo)))).flat();
  const stones = await repo.tombstones();
  const held = new Set(records.map(({ kind, record }) => `${kind}:${record.id}`));
  const dead = new Set(stones.map((s) => `${s.kind}:${s.recordId}`));
  // Deletions first, so they reach the account before anything could pull their targets back.
  const outgoing: Outgoing[] = [
    ...stones.map((stone) => ({ kind: "tombstone" as const, id: stone.id, stone })),
    ...records.map((item) => ({ kind: item.kind, id: item.record.id, item })),
  ];

  const result: SyncResult = { pushed: 0, pulled: 0, rejected: 0, skipped: 0 };
  let batch = takeBatch(outgoing, ledger);
  let hasMore = true; // until the server says otherwise: the first request is also the first pull
  while (batch.length > 0 || hasMore) {
    const request: SyncRequest = { cursor: ledger.cursor, records: [], tombstones: [] };
    for (const out of batch) {
      if (out.kind === "tombstone") request.tombstones.push(out.stone);
      else request.records.push(out.item);
    }
    const page = await api.syncOnce(request);
    // The session cookie is shared by every tab, so another one may have signed in as someone else since this ledger loaded.
    if (page.userId !== ledger.userId) {
      throw new SignedOutError("This browser is now signed in to a different account.");
    }
    const stonesIn = page.tombstones.filter((stone) => known(stone.kind));
    const recordsIn = page.records.filter((item) => known(item.kind));
    result.pulled += await applyPage(repo, stonesIn, recordsIn, held, dead);
    signal?.throwIfAborted();

    for (const out of batch) ledger.markSent(out.kind, [out.id]);
    ledger.markSent("tombstone", stonesIn.map((s) => s.id));
    for (const { kind, record } of recordsIn) ledger.markSent(kind, [record.id]);
    ledger.setCursor(page.cursor);
    await ledger.save();

    result.pushed += batch.length;
    result.rejected += page.rejected.length;
    result.skipped += page.tombstones.length - stonesIn.length + page.records.length - recordsIn.length;
    hasMore = page.hasMore;
    batch = takeBatch(outgoing, ledger);
  }
  return result;
}

/**
 * The next items that fit one request, taken off the front of `queue`.
 * Checked against the ledger as they are taken, since an earlier page may
 * have pulled the same record from another device.
 */
function takeBatch(queue: Outgoing[], ledger: SyncLedger): Outgoing[] {
  const batch: Outgoing[] = [];
  let chars = 0;
  while (queue.length > 0 && batch.length < BATCH_ITEMS) {
    const next = queue[0];
    if (!ledger.hasSent(next.kind, next.id)) {
      const size = JSON.stringify(next.kind === "tombstone" ? next.stone : next.item).length;
      if (batch.length > 0 && chars + size > BATCH_CHARS) break;
      batch.push(next);
      chars += size;
    }
    queue.shift();
  }
  return batch;
}

/** Applies one page — deletions first, then records this device neither holds nor deleted — and counts the changes. */
async function applyPage(
  repo: TrialRepository,
  stones: Tombstone[],
  records: SyncRecord[],
  held: Set<string>,
  dead: Set<string>,
): Promise<number> {
  let changed = 0;
  for (const stone of stones) {
    const key = `${stone.kind}:${stone.recordId}`;
    if (dead.has(key)) continue;
    await repo.applyTombstone(stone);
    dead.add(key);
    changed += 1;
  }
  for (const item of records) {
    const key = `${item.kind}:${item.record.id}`;
    if (held.has(key) || dead.has(key)) continue;
    await saveRecord(repo, item);
    held.add(key);
    changed += 1;
  }
  return changed;
}

function saveRecord(repo: TrialRepository, item: SyncRecord): Promise<void> {
  switch (item.kind) {
    case "trial":
      return repo.save(item.record);
    case "range":
      return repo.saveRange(item.record);
    case "session":
      return repo.saveSession(item.record);
    case "phrase":
      return repo.savePhrase(item.record);
  }
}
