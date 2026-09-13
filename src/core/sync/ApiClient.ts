import type { ExerciseSession, PhraseRecord, RangeMeasurement, SyncRecordKind, Tombstone, TrialRecord } from "../types";

/** Same origin as the page, so the session cookie rides along and CORS never applies. */
const API_BASE = "/api";
/** Rate limits are per-minute windows, so a minute is always long enough when the server names no delay. */
const DEFAULT_RETRY_AFTER_S = 60;
/** The server's limits on a client error report; longer text is cut rather than refused. */
const MAX_REPORT_MESSAGE = 500;
const MAX_REPORT_STACK = 4000;

export interface AccountUser {
  id: string;
  email: string;
  name: string | null;
}

/** One record on the wire, tagged with its kind. */
export type SyncRecord =
  | { kind: "trial"; record: TrialRecord }
  | { kind: "range"; record: RangeMeasurement }
  | { kind: "session"; record: ExerciseSession }
  | { kind: "phrase"; record: PhraseRecord };

export interface SyncRequest {
  /** The last server seq this device has applied; 0 before its first sync. */
  cursor: number;
  records: SyncRecord[];
  tombstones: Tombstone[];
}

export interface SyncResponse {
  /** The account the session belongs to, which this device's ledger must be for. */
  userId: string;
  /** Pushed records the account did not hold yet. */
  accepted: number;
  /** Pushed items the server refused; a refused deletion has kind "tombstone". */
  rejected: Array<{ kind: SyncRecordKind | "tombstone"; id: string | null; reason: string }>;
  /** Changes above the request cursor, minus the records that request pushed. */
  records: SyncRecord[];
  tombstones: Tombstone[];
  /** The highest seq this page covers. */
  cursor: number;
  /** More changes wait above `cursor`. */
  hasMore: boolean;
}

export interface ErrorReport {
  message: string;
  stack?: string;
  source?: string;
  /** Path only: a query string can carry things that must not be logged. */
  url?: string;
  release?: string;
}

/** The server answered with a failure; `message` is its `detail` when it gave one. */
export class ApiError extends Error {
  name = "ApiError";

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The request needs a session this browser does not have, or no longer has. */
export class SignedOutError extends ApiError {
  name = "SignedOutError";

  constructor(message: string) {
    super(message, 401);
  }
}

/** The server asked for a pause: rate limited (429), or an instance with no room for the request right now (503 with Retry-After). */
export class RetryLaterError extends ApiError {
  name = "RetryLaterError";

  constructor(
    message: string,
    /** Seconds to wait before trying again. */
    readonly retryAfter: number,
    status = 429,
  ) {
    super(message, status);
  }
}

/**
 * The API could not be reached: no network, or something answered in its
 * place — a gateway 5xx, a 500 with no JSON body, a page that is not JSON.
 * Nothing is known about the session, so this must never read as signed out.
 */
export class OfflineError extends Error {
  name = "OfflineError";

  constructor(options?: ErrorOptions) {
    super("Can't reach the server.", options);
  }
}

/**
 * The app's one door to its server. The session is an HttpOnly cookie the
 * page never sees, and every failure surfaces as one of the typed errors
 * above, so callers can tell offline from signed out from asked to wait.
 */
export class ApiClient {
  private readonly fetchFn: typeof fetch;

  constructor(deps: { fetchFn?: typeof fetch } = {}) {
    this.fetchFn = deps.fetchFn ?? ((...args) => fetch(...args));
  }

  /** The signed-in user, or null; the server never answers this with a 401. */
  async me(): Promise<AccountUser | null> {
    const { user } = await this.request<{ user: AccountUser | null }>("GET", "/me", (r) => r.json());
    return user;
  }

  /** Where to send the browser to sign in: a full-page navigation, since the provider's page must be top level. */
  loginUrl(opts: { returnTo?: string; screenHint?: "sign-in" | "sign-up" } = {}): string {
    const params = new URLSearchParams();
    if (opts.returnTo) params.set("returnTo", opts.returnTo);
    if (opts.screenHint) params.set("screenHint", opts.screenHint);
    const query = params.toString();
    return `${API_BASE}/auth/login${query ? `?${query}` : ""}`;
  }

  /** Ends the session here; navigating to `logoutUrl`, when present, ends it at the identity provider too. */
  async logout(): Promise<{ logoutUrl: string | null }> {
    const { logoutUrl } = await this.request<{ logoutUrl: string | null }>("POST", "/auth/logout", (r) => r.json());
    return { logoutUrl };
  }

  /** One request of the sync protocol; `syncAccount` drives the loop. */
  syncOnce(body: SyncRequest): Promise<SyncResponse> {
    return this.request("POST", "/sync", (r) => r.json(), { body });
  }

  /** Everything the account holds, as backup JSON any device can import. */
  exportAccount(): Promise<string> {
    return this.request("GET", "/account/export", (r) => r.text());
  }

  /** Deletes the account and the server's copy of every record; this device's data is untouched. */
  async deleteAccount(): Promise<{ logoutUrl: string | null }> {
    const { logoutUrl } = await this.request<{ logoutUrl: string | null }>("DELETE", "/account", (r) => r.json());
    return { logoutUrl };
  }

  /** Best effort, and never throws: reporting an error must not cause another. keepalive outlives an unloading page. */
  async reportError(report: ErrorReport): Promise<void> {
    const body = {
      ...report,
      message: report.message.slice(0, MAX_REPORT_MESSAGE),
      stack: report.stack?.slice(0, MAX_REPORT_STACK),
    };
    await this.request("POST", "/telemetry/errors", async () => undefined, { body, keepalive: true }).catch(
      () => undefined,
    );
  }

  private async request<T>(
    method: string,
    path: string,
    read: (response: Response) => Promise<T>,
    opts: { body?: unknown; keepalive?: boolean } = {},
  ): Promise<T> {
    const unreachable = (cause: unknown): never => {
      throw new OfflineError({ cause });
    };
    const response = await this.fetchFn(`${API_BASE}${path}`, {
      method,
      credentials: "same-origin",
      keepalive: opts.keepalive,
      headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }).catch(unreachable);
    if (!response.ok) throw await failure(response);
    // A body that breaks off, or is not the API's JSON, means the API is not what answered.
    return read(response).catch(unreachable);
  }
}

/** The typed error for a response that is not a success. */
async function failure(response: Response): Promise<Error> {
  const { status } = response;
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const retryAfter = response.headers.get("retry-after");
  // A 503 naming a delay is an instance with no room right now, which asks for a pause just as a 429 does.
  const busy = status === 503 && retryAfter !== null;
  if (status === 502 || (status === 503 && !busy) || status === 504 || (status === 500 && body === null)) {
    return new OfflineError();
  }
  const message = typeof body?.detail === "string" ? body.detail : `Request failed (${status}).`;
  if (status === 401) return new SignedOutError(message);
  if (status === 429 || busy) return new RetryLaterError(message, retryAfterSeconds(retryAfter), status);
  return new ApiError(message, status);
}

function retryAfterSeconds(header: string | null): number {
  const seconds = Number(header);
  return header && Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_S;
}
