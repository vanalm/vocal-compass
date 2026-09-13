import type { AccountState, SyncResult } from "../core";

/** ok: synced · busy: syncing · off: not syncing, nothing wrong · warn: sync paused. */
export type SyncTone = "ok" | "busy" | "off" | "warn";

export interface SyncStatus {
  tone: SyncTone;
  /** The state itself, short enough for a phone's topbar. */
  label: string;
  /** What follows it where there is room, e.g. "3 min ago". */
  detail: string | null;
}

/** The outcomes the sign-in callback reports in `?auth=`. */
export type AuthNotice = "failed" | "denied";

/** "just now", "3 min ago", "2 hr ago", "4 days ago": coarse on purpose, for a status line. */
export function relativeTime(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now"; // also a clock running slightly ahead
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** How sync stands, in words; null when there is no account to speak of. */
export function syncStatus(state: Pick<AccountState, "phase" | "lastSyncedAt">, now: number): SyncStatus | null {
  switch (state.phase) {
    case "loading":
    case "signed-out":
      return null;
    case "syncing":
      return { tone: "busy", label: "Syncing…", detail: null };
    case "offline":
      return { tone: "off", label: "Offline", detail: "— saved on this device" };
    case "error":
      return { tone: "warn", label: "Sync paused", detail: null };
    case "idle":
      return state.lastSyncedAt
        ? { tone: "ok", label: "Synced", detail: relativeTime(Date.parse(state.lastSyncedAt), now) }
        : { tone: "off", label: "Not synced yet", detail: null };
  }
}

/** A sync's counts in a few words: "4 sent, 12 received". */
export function resultSummary({ pushed, pulled, rejected, skipped }: SyncResult): string {
  const parts = [
    pushed > 0 && `${pushed} sent`,
    pulled > 0 && `${pulled} received`,
    rejected > 0 && `${rejected} not accepted`,
    // Only a page left open across an update can meet a kind it doesn't know; reloading gets the version that does.
    skipped > 0 && `${skipped} more after reloading the page`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "up to date";
}

/** What a sign-in that began here asks the server to come back with, so a success returns where it started too. */
export const SIGNED_IN = "signed-in";

/**
 * The sign-in outcome in a query string: the message to show, if any, and
 * `returning` whenever the page is back from a sign-in at all. Also that
 * query string without it, so a reload repeats neither.
 */
export function readAuthNotice(search: string): { notice: AuthNotice | null; returning: boolean; search: string } {
  const params = new URLSearchParams(search);
  const value = params.get("auth");
  if (value === null) return { notice: null, returning: false, search };
  params.delete("auth");
  const rest = params.toString();
  const notice = value === "failed" || value === "denied" ? value : null;
  return { notice, returning: true, search: rest ? `?${rest}` : "" };
}
