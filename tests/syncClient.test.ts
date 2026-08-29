import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncClient, type KeyValueStore } from "../src/core/sync/SyncClient";
import { MemoryTrialRepository } from "../src/core/storage/TrialRepository";
import type { RangeMeasurement, TrialRecord } from "../src/core/types";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

const trial = (id: string): TrialRecord =>
  ({ id, createdAt: "2026-08-20T10:00:00.000Z" }) as TrialRecord;
const rng = (id: string): RangeMeasurement => ({
  id,
  createdAt: "2026-08-20T10:00:00.000Z",
  lowMidi: 45,
  highMidi: 69,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("SyncClient", () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let client: SyncClient;
  let repo: MemoryTrialRepository;

  beforeEach(() => {
    fetchFn = vi.fn();
    client = new SyncClient("http://sync.test", { fetchFn: fetchFn as unknown as typeof fetch, storage: memoryStore() });
    repo = new MemoryTrialRepository();
  });

  async function signIn() {
    fetchFn.mockResolvedValueOnce(jsonResponse(200, { sent: true, dev_code: "123456" }));
    await client.requestCode("alto@example.com");
    fetchFn.mockResolvedValueOnce(jsonResponse(200, { token: "tok-1", email: "alto@example.com" }));
    await client.verify("alto@example.com", "123456");
  }

  it("starts signed out", () => {
    expect(client.signedInEmail).toBeNull();
  });

  it("requestCode posts the email and surfaces a dev code when echoed", async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse(200, { sent: true, dev_code: "654321" }));
    const result = await client.requestCode("alto@example.com");
    expect(result.devCode).toBe("654321");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://sync.test/auth/request");
    expect(JSON.parse(init.body)).toEqual({ email: "alto@example.com" });
  });

  it("verify stores the session", async () => {
    await signIn();
    expect(client.signedInEmail).toBe("alto@example.com");
  });

  it("signOut clears the session", async () => {
    await signIn();
    client.signOut();
    expect(client.signedInEmail).toBeNull();
  });

  it("sync refuses when signed out", async () => {
    await expect(client.sync(repo)).rejects.toThrow(/sign in/i);
  });

  it("sync pushes local records with the bearer token and imports server-only records", async () => {
    await signIn();
    await repo.save(trial("local-1"));
    fetchFn.mockResolvedValueOnce(
      jsonResponse(200, { trials: [{ id: "local-1" }, trial("server-1")], ranges: [rng("server-r1")] }),
    );

    const result = await client.sync(repo);

    const [url, init] = fetchFn.mock.calls[2];
    expect(url).toBe("http://sync.test/sync");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(init.body).trials.map((t: TrialRecord) => t.id)).toEqual(["local-1"]);
    expect(result).toEqual({ pushed: 1, pulled: 2 });
    expect((await repo.all()).map((t) => t.id)).toEqual(["local-1", "server-1"]);
    expect((await repo.ranges()).map((r) => r.id)).toEqual(["server-r1"]);
  });

  it("pushes local sessions and imports server-only sessions", async () => {
    await signIn();
    await repo.saveSession({ id: "sx", createdAt: "2026-09-01T10:00:00.000Z", planId: "vfe", stepsCompleted: 4 });
    fetchFn.mockResolvedValueOnce(
      jsonResponse(200, {
        trials: [],
        ranges: [],
        sessions: [
          { id: "sx", createdAt: "2026-09-01T10:00:00.000Z", planId: "vfe", stepsCompleted: 4 },
          { id: "sy", createdAt: "2026-09-02T10:00:00.000Z", planId: "vfe", stepsCompleted: 4 },
        ],
      }),
    );
    const result = await client.sync(repo);
    const [, init] = fetchFn.mock.calls[2];
    expect(JSON.parse(init.body).sessions.map((s: { id: string }) => s.id)).toEqual(["sx"]);
    expect(result).toEqual({ pushed: 1, pulled: 1 });
    expect((await repo.sessions()).map((s) => s.id)).toEqual(["sx", "sy"]);
  });

  it("second sync does not duplicate already-pulled records", async () => {
    await signIn();
    const payload = { trials: [trial("server-1")], ranges: [] };
    fetchFn.mockResolvedValueOnce(jsonResponse(200, payload));
    await client.sync(repo);
    fetchFn.mockResolvedValueOnce(jsonResponse(200, payload));
    const second = await client.sync(repo);
    expect(second.pulled).toBe(0);
    expect(await repo.all()).toHaveLength(1);
  });

  it("a 401 clears the session and reports it", async () => {
    await signIn();
    fetchFn.mockResolvedValueOnce(jsonResponse(401, { detail: "expired" }));
    await expect(client.sync(repo)).rejects.toThrow(/expired/i);
    expect(client.signedInEmail).toBeNull();
  });
});

describe("repository upsert semantics (sync pulls must not duplicate)", () => {
  it("memory repo replaces a record saved twice with the same id", async () => {
    const repo = new MemoryTrialRepository();
    await repo.save(trial("t1"));
    await repo.save(trial("t1"));
    await repo.saveRange(rng("r1"));
    await repo.saveRange(rng("r1"));
    expect(await repo.all()).toHaveLength(1);
    expect(await repo.ranges()).toHaveLength(1);
  });
});
