import { describe, expect, it } from "vitest";
import { readAuthNotice, relativeTime, resultSummary, syncStatus } from "../src/ui/accountStatus";

const MIN = 60_000;
const NOW = Date.parse("2026-09-12T12:00:00.000Z");

describe("relativeTime", () => {
  it.each([
    [0, "just now"],
    [MIN - 1, "just now"],
    [-30_000, "just now"], // a clock running slightly ahead
    [MIN, "1 min ago"],
    [59 * MIN, "59 min ago"],
    [60 * MIN, "1 hr ago"],
    [24 * 60 * MIN - 1, "23 hr ago"],
    [24 * 60 * MIN, "1 day ago"],
    [3 * 24 * 60 * MIN, "3 days ago"],
  ])("%i ms ago reads %s", (ago, text) => {
    expect(relativeTime(NOW - ago, NOW)).toBe(text);
  });
});

describe("syncStatus", () => {
  const status = (phase: Parameters<typeof syncStatus>[0]["phase"], lastSyncedAt: string | null = null) =>
    syncStatus({ phase, lastSyncedAt }, NOW);

  it("has nothing to say while signed out or still checking", () => {
    expect(status("signed-out")).toBeNull();
    expect(status("loading")).toBeNull();
  });

  it("says how long ago the last sync finished", () => {
    expect(status("idle", new Date(NOW - 3 * MIN).toISOString())).toEqual({
      tone: "ok",
      label: "Synced",
      detail: "3 min ago",
    });
  });

  it("names every other state, keeping the offline reassurance where there is room for it", () => {
    expect(status("syncing")).toEqual({ tone: "busy", label: "Syncing…", detail: null });
    expect(status("offline")).toEqual({ tone: "off", label: "Offline", detail: "— saved on this device" });
    expect(status("error")).toEqual({ tone: "warn", label: "Sync paused", detail: null });
    expect(status("idle")).toEqual({ tone: "off", label: "Not synced yet", detail: null });
  });
});

describe("resultSummary", () => {
  it("counts only what happened", () => {
    expect(resultSummary({ pushed: 4, pulled: 12, rejected: 0, skipped: 0 })).toBe("4 sent, 12 received");
    expect(resultSummary({ pushed: 3, pulled: 0, rejected: 1, skipped: 0 })).toBe("3 sent, 1 not accepted");
    expect(resultSummary({ pushed: 0, pulled: 2, rejected: 0, skipped: 3 })).toBe(
      "2 received, 3 more after reloading the page",
    );
    expect(resultSummary({ pushed: 0, pulled: 0, rejected: 0, skipped: 0 })).toBe("up to date");
  });
});

describe("readAuthNotice", () => {
  it("reads the sign-in outcome and hands back the query without it", () => {
    expect(readAuthNotice("?auth=denied")).toEqual({ notice: "denied", returning: true, search: "" });
    expect(readAuthNotice("?x=1&auth=failed&y=2")).toEqual({ notice: "failed", returning: true, search: "?x=1&y=2" });
  });

  it("knows a successful sign-in came back, with nothing to say about it", () => {
    expect(readAuthNotice("?auth=signed-in")).toEqual({ notice: null, returning: true, search: "" });
  });

  it("strips an outcome it doesn't know without showing anything", () => {
    expect(readAuthNotice("?auth=<script>")).toEqual({ notice: null, returning: true, search: "" });
  });

  it("leaves a query without one untouched", () => {
    expect(readAuthNotice("")).toEqual({ notice: null, returning: false, search: "" });
    expect(readAuthNotice("?x=1")).toEqual({ notice: null, returning: false, search: "?x=1" });
  });
});
