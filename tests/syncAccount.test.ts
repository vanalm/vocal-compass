import { describe, expect, it } from "vitest";
import {
  ApiClient,
  OfflineError,
  SignedOutError,
  type SyncRecord,
  type SyncRequest,
  type SyncResponse,
} from "../src/core/sync/ApiClient";
import { SyncLedger } from "../src/core/sync/SyncLedger";
import { syncAccount } from "../src/core/sync/syncAccount";
import { MemoryTrialRepository } from "../src/core/storage/TrialRepository";
import type {
  ExerciseSession,
  PhraseRecord,
  RangeMeasurement,
  SyncRecordKind,
  Tombstone,
  TrialRecord,
} from "../src/core/types";

const trial = (id: string, extra: Partial<TrialRecord> = {}): TrialRecord =>
  ({ id, createdAt: "2026-09-01T10:00:00.000Z", ...extra }) as TrialRecord;
const range = (id: string): RangeMeasurement => ({ id, createdAt: "2026-09-01T10:00:00.000Z", lowMidi: 45, highMidi: 69 });
const session = (id: string): ExerciseSession => ({
  id,
  createdAt: "2026-09-01T10:00:00.000Z",
  planId: "vfe",
  stepsCompleted: 4,
});
const phrase = (id: string): PhraseRecord => ({ id, createdAt: "2026-09-01T10:00:00.000Z" }) as PhraseRecord;
const ids = (records: Array<{ id: string }>) => records.map((r) => r.id).sort();

interface Row {
  seq: number;
  item: SyncRecord | null;
  stone: Tombstone | null;
}

/**
 * The server's sync protocol in memory: one seq per account, pages of
 * changes above the cursor, no echo of records pushed in the same request,
 * deletions that leave a stub, and refusal of malformed records.
 */
class FakeSyncServer {
  readonly requests: Array<{ userId: string; body: SyncRequest }> = [];
  private readonly accounts = new Map<string, { seq: number; rows: Map<string, Row> }>();

  constructor(private readonly pageSize = 500) {}

  /** A client signed in to `userId`; requests for which `fail(n)` is true never reach the server. */
  client(userId: string, fail: (call: number) => boolean = () => false): ApiClient {
    let calls = 0;
    return new ApiClient({
      fetchFn: async (_url, init) => {
        if (fail(calls++)) throw new TypeError("Failed to fetch");
        const body = JSON.parse(String(init?.body)) as SyncRequest;
        return new Response(JSON.stringify(this.sync(userId, body)), { status: 200 });
      },
    });
  }

  /** Ids of the live records of one kind the account holds, sorted. */
  live(userId: string, kind: SyncRecordKind): string[] {
    const rows = [...(this.accounts.get(userId)?.rows.values() ?? [])];
    return rows.flatMap((row) => (row.item?.kind === kind ? [row.item.record.id] : [])).sort();
  }

  private sync(userId: string, body: SyncRequest): SyncResponse {
    this.requests.push({ userId, body });
    const account = this.accounts.get(userId) ?? { seq: 0, rows: new Map<string, Row>() };
    this.accounts.set(userId, account);
    const write = (key: string, row: Omit<Row, "seq">) => account.rows.set(key, { ...row, seq: ++account.seq });

    for (const stone of body.tombstones) {
      const key = `${stone.kind}:${stone.recordId}`;
      if (!account.rows.get(key)?.stone) write(key, { item: null, stone });
    }
    let accepted = 0;
    const rejected: SyncResponse["rejected"] = [];
    for (const item of body.records) {
      const key = `${item.kind}:${item.record.id}`;
      if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(item.record.id) || Number.isNaN(Date.parse(item.record.createdAt))) {
        rejected.push({ kind: item.kind, id: item.record.id, reason: "invalid_id" });
      } else if (!account.rows.has(key)) {
        write(key, { item, stone: null });
        accepted += 1;
      }
    }

    const pushed = new Set(body.records.map((item) => `${item.kind}:${item.record.id}`));
    const changed = [...account.rows.entries()]
      .filter(([, row]) => row.seq > body.cursor)
      .sort(([, a], [, b]) => a.seq - b.seq);
    const page = changed.slice(0, this.pageSize);
    return {
      userId,
      accepted,
      rejected,
      records: page.flatMap(([key, row]) => (row.item && !pushed.has(key) ? [row.item] : [])),
      tombstones: page.flatMap(([, row]) => (row.stone ? [row.stone] : [])),
      cursor: page.at(-1)?.[1].seq ?? body.cursor,
      hasMore: changed.length > page.length,
    };
  }
}

/** One browser: its own repository, which keeps its ledgers too. */
function device() {
  return { repo: new MemoryTrialRepository() };
}

/** Syncs as a fresh page load would: the ledger is read back from the device's storage every time. */
async function sync(
  server: FakeSyncServer,
  { repo }: ReturnType<typeof device>,
  userId = "u1",
  fail?: (call: number) => boolean,
) {
  return syncAccount(repo, server.client(userId, fail), await SyncLedger.load(userId, repo));
}

/** A server for account u1 that answers every request with the same page. */
const answering = (extra: Partial<SyncResponse>) => ({
  syncOnce: async (): Promise<SyncResponse> => ({
    userId: "u1",
    accepted: 0,
    rejected: [],
    records: [],
    tombstones: [],
    cursor: 1,
    hasMore: false,
    ...extra,
  }),
});

describe("syncAccount", () => {
  it("pushes every local record and deletion, deletions first, in batches of 200", async () => {
    const server = new FakeSyncServer();
    const phone = device();
    for (let i = 0; i < 450; i++) await phone.repo.save(trial(`t${i}`));
    await phone.repo.saveRange(range("r1"));
    await phone.repo.saveSession(session("s1"));
    await phone.repo.savePhrase(phrase("p1"));
    await phone.repo.deleteTrial("t0");

    expect(await sync(server, phone)).toEqual({ pushed: 453, pulled: 0, rejected: 0, skipped: 0 });

    const bodies = server.requests.map((r) => r.body);
    expect(bodies.map((b) => b.records.length + b.tombstones.length)).toEqual([200, 200, 53]);
    expect(bodies.map((b) => b.cursor)).toEqual([0, 200, 400]);
    expect(bodies[0].tombstones.map((s) => s.recordId)).toEqual(["t0"]);
    expect(server.live("u1", "trial")).toHaveLength(449);
    expect([server.live("u1", "range"), server.live("u1", "session"), server.live("u1", "phrase")]).toEqual([
      ["r1"],
      ["s1"],
      ["p1"],
    ]);
  });

  it("pushes and pulls nothing once the account has everything", async () => {
    const server = new FakeSyncServer();
    const phone = device();
    await phone.repo.save(trial("t1"));
    await phone.repo.saveRange(range("r1"));
    await sync(server, phone);

    expect(await sync(server, phone)).toEqual({ pushed: 0, pulled: 0, rejected: 0, skipped: 0 });
    expect(server.requests.slice(1).map((r) => r.body)).toEqual([{ cursor: 2, records: [], tombstones: [] }]);
  });

  it("sends a record too big to share a request on its own", async () => {
    const trace = Array.from({ length: 60_000 }, (_, t) => ({ t, midi: 60.25, clarity: 0.9 }));
    const server = new FakeSyncServer();
    const phone = device();
    await phone.repo.save(trial("a", { createdAt: "2026-09-01T10:00:00.000Z" }));
    await phone.repo.save(trial("big", { createdAt: "2026-09-01T10:01:00.000Z", trace }));
    await phone.repo.save(trial("c", { createdAt: "2026-09-01T10:02:00.000Z" }));
    expect(JSON.stringify(trace).length).toBeGreaterThan(1_500_000);

    await sync(server, phone);

    expect(server.requests.map((r) => r.body.records.map((x) => x.record.id))).toEqual([["a"], ["big"], ["c"]]);
  });

  it("brings two devices to the same data, including a deletion made on one", async () => {
    const server = new FakeSyncServer();
    const laptop = device();
    const phone = device();
    await laptop.repo.save(trial("t1"));
    await laptop.repo.save(trial("t2"));
    await laptop.repo.saveRange(range("r1"));
    await phone.repo.save(trial("t3"));

    expect(await sync(server, laptop)).toEqual({ pushed: 3, pulled: 0, rejected: 0, skipped: 0 });
    expect(await sync(server, phone)).toEqual({ pushed: 1, pulled: 3, rejected: 0, skipped: 0 });
    expect(await sync(server, laptop)).toEqual({ pushed: 0, pulled: 1, rejected: 0, skipped: 0 });

    await laptop.repo.deleteTrial("t1");
    expect(await sync(server, laptop)).toEqual({ pushed: 1, pulled: 0, rejected: 0, skipped: 0 });
    expect(await sync(server, phone)).toEqual({ pushed: 0, pulled: 1, rejected: 0, skipped: 0 });

    for (const { repo } of [laptop, phone]) {
      expect(ids(await repo.all())).toEqual(["t2", "t3"]);
      expect(ids(await repo.ranges())).toEqual(["r1"]);
      expect((await repo.tombstones()).map((s) => s.recordId)).toEqual(["t1"]);
    }
    expect(server.live("u1", "trial")).toEqual(["t2", "t3"]);
  });

  it("keeps pulling while the server has more pages", async () => {
    const server = new FakeSyncServer(2);
    const laptop = device();
    const phone = device();
    for (const id of ["a", "b", "c", "d", "e"]) await laptop.repo.save(trial(id));
    await sync(server, laptop);
    const before = server.requests.length;

    expect(await sync(server, phone)).toEqual({ pushed: 0, pulled: 5, rejected: 0, skipped: 0 });
    expect(server.requests.slice(before).map((r) => r.body.cursor)).toEqual([0, 2, 4]);
    expect(ids(await phone.repo.all())).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("resumes from its last saved page after failing midway", async () => {
    const server = new FakeSyncServer();
    const phone = device();
    for (let i = 0; i < 450; i++) await phone.repo.save(trial(`t${i}`));

    await expect(sync(server, phone, "u1", (call) => call === 1)).rejects.toBeInstanceOf(OfflineError);
    expect(server.requests).toHaveLength(1);
    expect((await SyncLedger.load("u1", phone.repo)).cursor).toBe(200);

    expect(await sync(server, phone)).toEqual({ pushed: 250, pulled: 0, rejected: 0, skipped: 0 });
    const first = new Set(server.requests[0].body.records.map((x) => x.record.id));
    const resumed = server.requests.slice(1).flatMap((r) => r.body.records.map((x) => x.record.id));
    expect(resumed).toHaveLength(250);
    expect(resumed.filter((id) => first.has(id))).toEqual([]);
    expect(server.live("u1", "trial")).toHaveLength(450);
  });

  it("counts refused records and does not send them again", async () => {
    const server = new FakeSyncServer();
    const phone = device();
    await phone.repo.save(trial("good"));
    await phone.repo.save(trial("not a valid id"));

    expect(await sync(server, phone)).toEqual({ pushed: 2, pulled: 0, rejected: 1, skipped: 0 });
    expect(await sync(server, phone)).toEqual({ pushed: 0, pulled: 0, rejected: 0, skipped: 0 });
    expect(server.requests[1].body.records).toEqual([]);
    expect(server.live("u1", "trial")).toEqual(["good"]);
  });

  it("brings this device's practice into every account it signs in to", async () => {
    const server = new FakeSyncServer();
    const shared = device();
    await shared.repo.save(trial("t1"));

    expect(await sync(server, shared, "alex")).toEqual({ pushed: 1, pulled: 0, rejected: 0, skipped: 0 });
    expect(await sync(server, shared, "sam")).toEqual({ pushed: 1, pulled: 0, rejected: 0, skipped: 0 });
    expect(server.live("sam", "trial")).toEqual(["t1"]);
  });

  it("does not save a pulled record this device has deleted", async () => {
    const repo = new MemoryTrialRepository();
    await repo.save(trial("t1"));
    await repo.deleteTrial("t1");
    const api = answering({ records: [{ kind: "trial", record: trial("t1") }] });

    expect(await syncAccount(repo, api, await SyncLedger.load("u1", repo))).toEqual({
      pushed: 1,
      pulled: 0,
      rejected: 0,
      skipped: 0,
    });
    expect(await repo.all()).toEqual([]);
  });

  it("brings the account's copy back, deletions included, after this device's data is cleared", async () => {
    const server = new FakeSyncServer();
    const phone = device();
    for (const id of ["t1", "t2", "t3"]) await phone.repo.save(trial(id));
    await phone.repo.deleteTrial("t3");
    await sync(server, phone);

    await phone.repo.clear();
    expect(await sync(server, phone)).toEqual({ pushed: 0, pulled: 3, rejected: 0, skipped: 0 });
    expect(ids(await phone.repo.all())).toEqual(["t1", "t2"]);
    expect((await phone.repo.tombstones()).map((s) => s.recordId)).toEqual(["t3"]);
  });

  it("skips pulled records and deletions of a kind it doesn't know, counting them, and still advances", async () => {
    const repo = new MemoryTrialRepository();
    await repo.saveSession(session("s1"));
    const api = answering({
      records: [
        { kind: "chord", record: { id: "c1", createdAt: "2026-09-01T10:00:00.000Z" } } as unknown as SyncRecord,
        { kind: "trial", record: trial("t1") },
      ],
      tombstones: [{ id: "x", createdAt: "2026-09-02T00:00:00.000Z", kind: "chord", recordId: "s1" } as unknown as Tombstone],
      cursor: 3,
    });

    expect(await syncAccount(repo, api, await SyncLedger.load("u1", repo))).toEqual({
      pushed: 1,
      pulled: 1,
      rejected: 0,
      skipped: 2,
    });
    expect([ids(await repo.all()), ids(await repo.sessions()), await repo.tombstones()]).toEqual([["t1"], ["s1"], []]);
    expect((await SyncLedger.load("u1", repo)).cursor).toBe(3);
  });

  it("stops, touching nothing on this device, when the session belongs to a different account than the ledger", async () => {
    const server = new FakeSyncServer();
    const laptop = device();
    await laptop.repo.save(trial("t1"));
    await sync(server, laptop, "alex");
    const phone = device();
    for (const id of ["s1", "s2", "s3"]) await phone.repo.save(trial(id));
    await sync(server, phone, "sam");

    // Another tab signed this browser in as sam: this tab's requests carry sam's cookie but it still holds alex's ledger.
    const alex = await SyncLedger.load("alex", laptop.repo);
    await expect(syncAccount(laptop.repo, server.client("sam"), alex)).rejects.toBeInstanceOf(SignedOutError);
    expect(ids(await laptop.repo.all())).toEqual(["t1"]);
    expect((await SyncLedger.load("alex", laptop.repo)).cursor).toBe(1);
  });

  it("refuses, touching nothing, a page that names no account", async () => {
    const repo = new MemoryTrialRepository();
    const api = answering({ userId: undefined, records: [{ kind: "trial", record: trial("t1") }], cursor: 4 });

    await expect(syncAccount(repo, api, await SyncLedger.load("u1", repo))).rejects.toBeInstanceOf(SignedOutError);
    expect(await repo.all()).toEqual([]);
    expect(await repo.loadLedger("u1")).toBeUndefined();
  });

  it("saves no ledger once its signal is aborted", async () => {
    const repo = new MemoryTrialRepository();
    const controller = new AbortController();
    const { syncOnce } = answering({ cursor: 5 });
    const api = {
      syncOnce: () => {
        controller.abort();
        return syncOnce();
      },
    };

    await expect(
      syncAccount(repo, api, await SyncLedger.load("u1", repo), { signal: controller.signal }),
    ).rejects.toThrow();
    expect(await repo.loadLedger("u1")).toBeUndefined();
  });
});

describe("repository upsert semantics (sync pulls must not duplicate)", () => {
  it("memory repo replaces a record saved twice with the same id", async () => {
    const repo = new MemoryTrialRepository();
    await repo.save(trial("t1"));
    await repo.save(trial("t1"));
    await repo.saveRange(range("r1"));
    await repo.saveRange(range("r1"));
    expect(await repo.all()).toHaveLength(1);
    expect(await repo.ranges()).toHaveLength(1);
  });
});
