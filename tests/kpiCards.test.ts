import { describe, expect, it } from "vitest";
import { KpiCalculator } from "../src/core/kpi/KpiCalculator";
import type { TrialRecord } from "../src/core/types";
import { kpiCards } from "../src/ui/components/KpiCards";

const values = (trials: TrialRecord[]) =>
  Object.fromEntries(kpiCards(new KpiCalculator().summarize(trials)).map((c) => [c.label, [c.value, c.hint]]));

describe("kpiCards", () => {
  it("shows no rate before any trial is scored, rather than a failing 0%", () => {
    const unscored = [{ id: "t1", scored: false, hintLevel: 0 }] as unknown as TrialRecord[];
    const cards = values(unscored);
    for (const label of [
      "Independent destination accuracy",
      "Destination accuracy",
      "Availability rate",
      "Map-loss rate",
      "Hint rate",
    ]) {
      expect(cards[label]).toEqual(["—", "no scored trials yet"]);
    }
  });

  it("shows rates once a trial is scored", () => {
    const scored = [
      { id: "t1", scored: true, destinationMatch: true, finalErrorKind: "success", hintLevel: 0, lostEvent: false },
    ] as unknown as TrialRecord[];
    const cards = values(scored);
    expect(cards["Destination accuracy"]).toEqual(["100%", "1 scored trials"]);
    expect(cards["Hint rate"]).toEqual(["0%", "trials needing rescue"]);
  });
});
