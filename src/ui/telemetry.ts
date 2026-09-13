import type { ApiClient } from "../core";

/** Reports per page load: enough to see what broke, never a flood from an error that repeats every frame. */
const MAX_REPORTS = 5;

/** Whether to report an error with this message: each distinct message once, and no more than `limit` in all. */
export function reportThrottle(limit = MAX_REPORTS): (message: string) => boolean {
  const reported = new Set<string>();
  return (message) => {
    if (reported.size >= limit || reported.has(message)) return false;
    reported.add(message);
    return true;
  };
}

/**
 * Sends uncaught errors and unhandled rejections to the server's log, so a
 * failure in someone's browser is seen without them having to describe it.
 * Only the path goes with it: a query string can carry what must not be logged.
 */
export function installErrorReporting(api: Pick<ApiClient, "reportError">, { release }: { release: string }): void {
  const shouldReport = reportThrottle();
  const report = (source: string, error: unknown, fallback: string) => {
    const message = error instanceof Error ? String(error) : fallback;
    if (!shouldReport(message)) return;
    const stack = error instanceof Error ? error.stack : undefined;
    void api.reportError({ message, stack, source, url: window.location.pathname, release });
  };
  window.addEventListener("error", (event) => report("error", event.error, event.message));
  window.addEventListener("unhandledrejection", (event) =>
    report("unhandledrejection", event.reason, String(event.reason)),
  );
}
