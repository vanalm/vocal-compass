import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, OfflineError, RetryLaterError, SignedOutError } from "../src/core/sync/ApiClient";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A client whose every request gets `reply`: a response, or a thrown network error. */
function answering(reply: Response | Error) {
  const fetchFn = vi.fn<typeof fetch>(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { fetchFn, api: new ApiClient({ fetchFn }) };
}

const emptySync = (api: ApiClient) => api.syncOnce({ cursor: 0, records: [], tombstones: [] });

describe("ApiClient", () => {
  it("asks /api/me for the signed-in user, sending same-origin credentials", async () => {
    const { api, fetchFn } = answering(json(200, { user: { id: "u1", email: "a@b.c", name: null }, authMode: "dev" }));
    expect(await api.me()).toEqual({ id: "u1", email: "a@b.c", name: null });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin" });
  });

  it("reads a signed-out /api/me as null", async () => {
    const { api } = answering(json(200, { user: null, authMode: "workos" }));
    expect(await api.me()).toBeNull();
  });

  it("builds the sign-in URL without a request", () => {
    const { api, fetchFn } = answering(new Error("unused"));
    expect(api.loginUrl()).toBe("/api/auth/login");
    expect(api.loginUrl({ returnTo: "/progress?tab=1", screenHint: "sign-up" })).toBe(
      "/api/auth/login?returnTo=%2Fprogress%3Ftab%3D1&screenHint=sign-up",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("posts a sync request as JSON and returns the page", async () => {
    const page = { userId: "u1", accepted: 0, rejected: [], records: [], tombstones: [], cursor: 3, hasMore: false };
    const { api, fetchFn } = answering(json(200, page));
    const body = { cursor: 1, records: [], tombstones: [] };
    expect(await api.syncOnce(body)).toEqual(page);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/sync");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it("signs out with POST /api/auth/logout and hands back the provider's logout URL", async () => {
    const { api, fetchFn } = answering(json(200, { logoutUrl: "https://auth.example/logout" }));
    expect(await api.logout()).toEqual({ logoutUrl: "https://auth.example/logout" });
    expect(fetchFn.mock.calls[0][0]).toBe("/api/auth/logout");
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("downloads the account export as text, verbatim", async () => {
    const exported = '{"app":"vocal-compass","version":5,"trials":[]}';
    const { api, fetchFn } = answering(new Response(exported, { status: 200 }));
    expect(await api.exportAccount()).toBe(exported);
    expect(fetchFn.mock.calls[0][0]).toBe("/api/account/export");
  });

  it("deletes the account with DELETE /api/account", async () => {
    const { api, fetchFn } = answering(json(200, { deleted: true, logoutUrl: null }));
    expect(await api.deleteAccount()).toEqual({ logoutUrl: null });
    expect(fetchFn.mock.calls[0][0]).toBe("/api/account");
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });

  describe("failures", () => {
    it("maps 401 to SignedOutError with the server's detail", async () => {
      const { api } = answering(json(401, { detail: "Sign in to sync." }));
      const error = await emptySync(api).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SignedOutError);
      expect(error).toMatchObject({ status: 401, message: "Sign in to sync." });
    });

    it("maps 429 to RetryLaterError carrying Retry-After in seconds", async () => {
      const { api } = answering(json(429, { detail: "Slow down." }, { "retry-after": "17" }));
      const error = await emptySync(api).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RetryLaterError);
      expect(error).toMatchObject({ status: 429, retryAfter: 17 });
    });

    it("waits a minute when a 429 names no delay", async () => {
      const { api } = answering(json(429, { detail: "Slow down." }));
      await expect(emptySync(api)).rejects.toMatchObject({ retryAfter: 60 });
    });

    it("maps a request that never got a response to OfflineError", async () => {
      const { api } = answering(new TypeError("Failed to fetch"));
      await expect(emptySync(api)).rejects.toBeInstanceOf(OfflineError);
      await expect(api.me()).rejects.toBeInstanceOf(OfflineError);
    });

    it("maps a 503 with Retry-After, an instance with every sync slot taken, to RetryLaterError as a 429", async () => {
      const busy = "The server is busy. Try again shortly.";
      const { api } = answering(json(503, { detail: busy }, { "retry-after": "2" }));
      const error = await emptySync(api).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RetryLaterError);
      expect(error).toMatchObject({ status: 503, retryAfter: 2, message: busy });
    });

    it.each([502, 503, 504])("maps a gateway %i with no Retry-After to OfflineError", async (status) => {
      const { api } = answering(new Response("", { status }));
      await expect(emptySync(api)).rejects.toBeInstanceOf(OfflineError);
    });

    it("maps a 500 with no JSON body, as a dead dev proxy sends, to OfflineError", async () => {
      const { api } = answering(new Response("", { status: 500 }));
      await expect(api.me()).rejects.toBeInstanceOf(OfflineError);
    });

    it("maps a success that is not JSON, a page rather than the API, to OfflineError", async () => {
      const { api } = answering(new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
      await expect(api.me()).rejects.toBeInstanceOf(OfflineError);
    });

    it("maps the server's own 500 to ApiError with its detail", async () => {
      const { api } = answering(json(500, { detail: "Something went wrong.", requestId: "r1" }));
      const error = await emptySync(api).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).not.toBeInstanceOf(SignedOutError);
      expect(error).toMatchObject({ status: 500, message: "Something went wrong." });
    });

    it("names the status when the detail is not text", async () => {
      const { api } = answering(json(422, { detail: [{ msg: "field required" }] }));
      await expect(emptySync(api)).rejects.toMatchObject({ status: 422, message: "Request failed (422)." });
    });
  });

  describe("reportError", () => {
    it("posts with keepalive and cuts text to the server's limits", async () => {
      const { api, fetchFn } = answering(new Response(null, { status: 204 }));
      await api.reportError({
        message: "m".repeat(600),
        stack: "s".repeat(5000),
        source: "window.error",
        url: "/lab",
        release: "abc123",
      });
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe("/api/telemetry/errors");
      expect(init).toMatchObject({ method: "POST", keepalive: true });
      const body = JSON.parse(String(init?.body));
      expect(body.message).toHaveLength(500);
      expect(body.stack).toHaveLength(4000);
      expect(body).toMatchObject({ source: "window.error", url: "/lab", release: "abc123" });
    });

    it.each([
      ["offline", new TypeError("Failed to fetch")],
      ["rate limited", json(429, { detail: "Slow down." })],
    ])("never throws when %s", async (_, reply) => {
      const { api } = answering(reply);
      await expect(api.reportError({ message: "boom" })).resolves.toBeUndefined();
    });
  });
});
