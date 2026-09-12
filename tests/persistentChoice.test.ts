import { describe, expect, it } from "vitest";
import { loadChoice, saveChoice, type ChoiceStorage } from "../src/ui/hooks/persistentChoice";

function memory(): ChoiceStorage & { dump: () => Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

const throwing: ChoiceStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const OPTIONS = ["off", "60", "80"] as const;

describe("persisted choices", () => {
  it("falls back when nothing is stored", () => {
    expect(loadChoice("k", OPTIONS, "60", memory())).toBe("60");
  });

  it("returns a stored value that is still a valid option", () => {
    const store = memory();
    saveChoice("k", "80", store);
    expect(loadChoice("k", OPTIONS, "60", store)).toBe("80");
  });

  it("ignores a stored value that is no longer an option", () => {
    const store = memory();
    store.setItem("k", "120");
    expect(loadChoice("k", OPTIONS, "60", store)).toBe("60");
  });

  it("survives storage that refuses access", () => {
    expect(loadChoice("k", OPTIONS, "60", throwing)).toBe("60");
    expect(() => saveChoice("k", "80", throwing)).not.toThrow();
  });

  it("works with no storage at all", () => {
    expect(loadChoice("k", OPTIONS, "60", null)).toBe("60");
  });
});
