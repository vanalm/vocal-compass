import { describe, expect, it } from "vitest";
import { practiceDays } from "../src/core/kpi/practiceTime";

/** Local-time ISO stamp so date bucketing matches in any test timezone. */
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).toISOString();

const dateKey = (y: number, mo: number, d: number) =>
  `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

describe("practiceDays", () => {
  it("returns empty for no records", () => {
    expect(practiceDays([])).toEqual([]);
  });

  it("credits a lone record with one minute", () => {
    const days = practiceDays([at(2026, 8, 20, 10, 0)]);
    expect(days).toEqual([{ date: dateKey(2026, 8, 20), minutes: 1, items: 1 }]);
  });

  it("measures a cluster from first to last record plus the lead-in", () => {
    const days = practiceDays([
      at(2026, 8, 20, 10, 0),
      at(2026, 8, 20, 10, 7),
      at(2026, 8, 20, 10, 14),
    ]);
    expect(days).toEqual([{ date: dateKey(2026, 8, 20), minutes: 15, items: 3 }]);
  });

  it("sums separate clusters on the same day", () => {
    const days = practiceDays([
      at(2026, 8, 20, 10, 0),
      at(2026, 8, 20, 10, 4), // 5-minute morning cluster
      at(2026, 8, 20, 18, 0),
      at(2026, 8, 20, 18, 9), // 10-minute evening cluster
    ]);
    expect(days).toEqual([{ date: dateKey(2026, 8, 20), minutes: 15, items: 4 }]);
  });

  it("splits records more than the gap apart into separate clusters", () => {
    const days = practiceDays([at(2026, 8, 20, 10, 0), at(2026, 8, 20, 10, 45)]);
    expect(days[0].minutes).toBe(2); // two lone clusters, 1 min each
  });

  it("keeps different days separate and sorted, regardless of input order", () => {
    const days = practiceDays([
      at(2026, 8, 22, 9, 0),
      at(2026, 8, 20, 10, 0),
      at(2026, 8, 20, 10, 4),
    ]);
    expect(days.map((d) => d.date)).toEqual([dateKey(2026, 8, 20), dateKey(2026, 8, 22)]);
    expect(days[0].minutes).toBe(5);
    expect(days[1].minutes).toBe(1);
  });
});
