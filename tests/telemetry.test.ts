import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorReport } from "../src/core/sync/ApiClient";
import { installErrorReporting, reportThrottle } from "../src/ui/telemetry";

describe("reportThrottle", () => {
  it("lets each distinct message through once", () => {
    const allow = reportThrottle();
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    expect(allow("b")).toBe(true);
  });

  it("stops after five reports in all", () => {
    const allow = reportThrottle();
    expect(["1", "2", "3", "4", "5", "6"].map((message) => allow(message))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});

describe("installErrorReporting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports uncaught errors and unhandled rejections with the path and release, once per message", () => {
    const page = Object.assign(new EventTarget(), { location: { pathname: "/lab", search: "?code=secret" } });
    vi.stubGlobal("window", page);
    const reportError = vi.fn(async (_report: ErrorReport) => undefined);
    installErrorReporting({ reportError }, { release: "abc123" });

    const boom = new TypeError("x is not a function");
    const uncaught = () =>
      page.dispatchEvent(Object.assign(new Event("error"), { error: boom, message: "Uncaught TypeError" }));
    uncaught();
    uncaught();
    page.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "nope" }));

    expect(reportError.mock.calls.map(([report]) => report)).toEqual([
      { message: "TypeError: x is not a function", stack: boom.stack, source: "error", url: "/lab", release: "abc123" },
      { message: "nope", source: "unhandledrejection", url: "/lab", release: "abc123" },
    ]);
  });
});
