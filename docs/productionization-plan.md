# Productionization plan: Vocal Compass on Google Cloud

> **Status, 2026-09-12: built.** This plan was implemented in one pass; operate
> the result from `terraform/README.md` and `server/README.md`. Where the build
> departs from the plan below:
>
> - **One container, no SPA bucket.** FastAPI serves the built SPA and `/api`,
>   so a release can never pair an old SPA with a new API. Cloud CDN sits on
>   the Cloud Run backend and follows the app's own cache headers.
> - **Standalone project** (`vocal-compass`) with its own load balancer in
>   prod; staging serves on its `run.app` URL. No load balancer is shared with
>   another project.
> - **Sync** uses one per-user sequence cursor across every record kind, and
>   each device's ledger lives in IndexedDB, so there is no `device` table.
> - **Traces stay inside each record's JSONB payload**; a Postgres
>   `trace_frame` view gives frame-level SQL without a second table or upload.
> - **Observability** has no analytics tables: domain events are log lines a
>   log sink routes to BigQuery, plus log-based metrics, seven alerts, an
>   uptime check and a dashboard.
> - **Auth modes** are `workos` and `dev`; signed-out use needs no server mode.
>   Signup is open, and `AUTH_ALLOWED_EMAILS` replaces the allowlist table.
> - **Added in review:** a Fernet cookie key, per-path body caps with a sync
>   concurrency guard, trusted proxy hops for client IPs, a hashed dependency
>   lock, deploy credentials pinned to the repository id and `main`, and
>   deploys gated on CI.
>
> Sections 11–13 are kept as the record of how the work was scoped and decided.

Target: a proven production shape — Cloud Run + Cloud SQL Postgres +
Terraform + GitHub Actions with Workload Identity Federation + WorkOS
AuthKit + JSON-line logging into Cloud Logging. It is the stack a sibling
service already runs in production ("the reference stack" below), so one
set of conventions covers both and what is learned operating one applies
to the other.

Written 2026-09-12 against a survey of that service.

---

## 1. The one thing we do NOT copy

The reference stack is **server-authoritative**: the browser holds nothing,
the API is the truth. Vocal Compass is **local-first** and that is a
feature, not an accident — you practice in a car with no signal and it
works. So:

- **IndexedDB stays the source of truth.** The server is a backup, a
  multi-device merge point, and the analytics warehouse.
- **Sign-in stays optional.** Unauthenticated use is a supported mode
  forever, not an onboarding step to get past.
- Everything else — hosting, auth mechanism, database, logging, IaC,
  CI/CD, security posture — follows the reference stack.

---

## 2. Current state: honest gap inventory

| Area | Today | Severity |
|---|---|---|
| Auth | Hand-rolled 6-digit magic codes, **echoed in the HTTP response** | **Critical** — dev-only by design; unusable publicly |
| Auth brute force | No attempt counter, no lockout, no rate limit on `/auth/verify` | **Critical** — 10⁶ codes, a 15-min TTL, and an unthrottled endpoint: exhaustible in minutes at a few thousand req/s |
| Session tokens | Stored **in plaintext** as the table primary key | **High** — DB read = full account takeover |
| Database | Local SQLite file (`dev.db`) | **Critical once deployed** — on Cloud Run that file is ephemeral disk and dies with the instance |
| Migrations | None. `Base.metadata.create_all()` | **High** — no forward path |
| Schema | One `records` table, `kind` + JSON blob | **Medium** — unqueryable for the frequency/time analysis you want |
| Sync | Pushes **every record every time**, full arrays | **High** — fine at 72 rows, fails at 100 sessions with traces |
| Logging | None at all | **High** — no way to debug production |
| CORS | Hardcoded `localhost:5199` / `5173` | Medium |
| Security headers | None | Medium |
| Rate limiting | None on any endpoint | High |
| Deploy | None — `uvicorn` by hand | — |
| Account lifecycle | No sign-out-everywhere, no delete-account, no export | Medium |
| Secrets | None used; `VC_ECHO_CODES` defaults **on** | **Critical** if deployed as-is |

**Do not deploy the current server to a public address.** The three
Critical rows are each independently sufficient to lose the data or the
accounts.

---

## 3. Target architecture

```
                    ┌─────────────────────────────────┐
  browser ─────────▶│ Global external ALB (HTTPS)     │
  (IndexedDB is     │  vocalcompass.<domain>          │
   still the truth) └───┬──────────────────────┬──────┘
                        │ /api/*               │ everything else
                        ▼                      ▼
              ┌──────────────────┐   ┌──────────────────────┐
              │ Cloud Run v2     │   │ GCS bucket + Cloud   │
              │ vc-<env>-backend │   │ CDN  (the Vite SPA)  │
              │ FastAPI, min=0   │   └──────────────────────┘
              └────────┬─────────┘
                       │ unix socket /cloudsql
                       ▼
              ┌──────────────────┐      ┌──────────────────┐
              │ Cloud SQL PG 16  │      │ WorkOS AuthKit   │
              │ database: vocal  │      │ (hosted sign-in) │
              └──────────────────┘      └──────────────────┘
```

Same-origin is the point: the SPA and `/api` share a hostname, so the
session cookie needs no CORS and no token ever touches JavaScript.

---

## 4. Auth: WorkOS AuthKit, BFF sealed-cookie

Delete the magic-code system entirely. AuthKit hosts signup, sign-in,
password reset, and social providers; **we never handle a password**.
Free below 1M monthly active users, and a pattern already proven in the
reference stack.

Flow:

1. `GET /api/auth/login?screen_hint=sign-up` → redirect to AuthKit.
2. `GET /api/auth/callback?code=…` → exchange server-side, seal the WorkOS
   session into an **HttpOnly, Secure, SameSite=Lax** cookie
   (`vc_session`, 30-day max-age), redirect back to the SPA.
3. Every request: an auth dependency unseals the cookie; an
   expired-but-refreshable session auto-refreshes and re-`Set-Cookie`s
   mid-request.
4. `POST /api/auth/logout` clears it; **sign-out-everywhere** revokes the
   WorkOS session.

`AUTH_MODE` = `fixed` (local dev + CI, a fixed fake user) | `workos`
(staging/prod, hard-fail if unset) | `anonymous` (local-first, no account).
That last mode is our addition to the usual BFF pattern and is what keeps
the offline promise honest.

**Identity linking:** match on `workos_sub`, fall back to email, backfill
`workos_sub`.

**Open signup or allowlist?** AuthKit's hosted signup is open, so a private
workspace would gate it with an `allowlist_entry` table plus an email
allowlist file. Recommend: open signup for Vocal Compass (it is a training
app, not a private workspace), with the allowlist table built but empty and
`AUTH_ENFORCE_ALLOWLIST=false`.

---

## 5. Database layout

Cloud SQL **Postgres 16**, SQLAlchemy 2.0 `Mapped[]` style, **Alembic**
migrations run from the container entrypoint when
`RUN_MIGRATIONS_ON_START=1`.

The design principle: **typed columns for everything you aggregate on,
JSONB for fidelity.** The current kind-keyed blob table made adding a
record type free, but it cannot answer "where am I least stable, by
frequency, over 100 sessions" without a full scan and client-side parsing —
and that question is the reason the data exists.

```sql
-- identity ------------------------------------------------------------
user
  id                uuid        pk
  workos_sub        text        unique, indexed
  email             citext      unique, indexed
  display_name      text
  timezone          text        default 'UTC'
  tos_accepted_at   timestamptz
  tos_version       text
  created_at        timestamptz default now()
  updated_at        timestamptz

device                     -- one row per browser/install that syncs
  id                uuid    pk
  user_id           uuid    fk user, indexed
  label             text    -- "Chrome on MacBook"
  last_seen_at      timestamptz
  cursor_trial      bigint  -- last acked seq, per record kind
  cursor_phrase     bigint
  cursor_range      bigint
  cursor_session    bigint

-- training records ----------------------------------------------------
trial                      -- one sung attempt at a destination
  id                uuid   pk        -- client-generated → idempotent push
  user_id           uuid   fk, indexed
  seq               bigserial indexed -- server change cursor for sync
  created_at        timestamptz indexed  -- client clock
  recorded_at       timestamptz          -- server receipt
  exercise_id       text   indexed
  feedback_mode     text                 -- blind | commit | live
  difficulty        text
  delay_ms          int
  key_tonic_midi    smallint
  target_midi       real   indexed       -- the frequency axis
  selected_midi     real
  scored            bool
  destination_match bool
  target_error_cents   real
  residual_cents       real
  stability_cents      real              -- within-trial wobble
  search_transitions   smallint
  hint_level        smallint
  lost_event        bool
  final_error_kind  text   indexed
  selection_latency_ms int
  recovery_time_ms  int
  confidence_before smallint
  effort            smallint
  register          text
  detector_name     text                 -- provenance: mpm-pitchy-v1
  detector_confidence  real
  payload           jsonb                -- whole client record, forward-compatible
  deleted_at        timestamptz          -- soft delete == tombstone

phrase_attempt             -- Echo Quest and every future phrase game
  id, user_id, seq, created_at, recorded_at
  phrase_id         text   indexed
  phrase_name       text
  level             smallint
  key_tonic_midi    smallint
  bpm               smallint
  role              text                 -- melody | root | third | fifth
  guide             text                 -- full | anchor | none
  verified          bool   indexed       -- cold first take
  hits, misses, extras  smallint
  sequence_accuracy real
  mean_abs_onset_ms int
  landing_hit       bool
  payload           jsonb                -- per-note results
  deleted_at        timestamptz

range_measurement
  id, user_id, seq, created_at, recorded_at
  low_midi          real
  high_midi         real
  span_semitones    real   generated (high - low)
  method            text                 -- glissando | guided-steps
  payload           jsonb
  deleted_at        timestamptz

exercise_session           -- a VFE run
  id, user_id, seq, created_at, recorded_at
  plan_id           text
  steps_completed   smallint
  payload           jsonb
  deleted_at        timestamptz

-- the big arrays live apart so hot aggregates never drag them ---------
pitch_trace
  id                uuid   pk
  user_id           uuid   fk, indexed
  source_kind       text                 -- trial | phrase | range
  source_id         uuid   indexed
  frame_ms          int                  -- polling cadence (70)
  times_ms          int[]                -- columnar, not JSON: unnest()-able
  midis             real[]
  clarities         real[]
  rms               real[]
  created_at        timestamptz

-- observability -------------------------------------------------------
analytics_span    (id, user_id, name, started_at, ended_at, duration_ms, attrs jsonb)
analytics_event   (id, span_id, user_id, name, at, attrs jsonb)

-- ops ------------------------------------------------------------------
app_setting       (key pk, value jsonb, updated_at)
allowlist_entry   (email pk, note, created_at)
```

Notes:
- **Columnar arrays for traces.** `unnest(times_ms, midis, rms)` gives you
  frame-level SQL directly — "median rms by semitone zone by month" is one
  query. JSONB would force parsing.
- **`method` on `range_measurement`** because the glissando→guided-steps
  change makes older measurements non-comparable. The column is how future
  you knows.
- **`detector_name` on `trial`** for the same reason: when the estimator is
  swapped, the old rows say what produced them.
- Soft delete (`deleted_at`) replaces the separate tombstone table: same
  semantics (deleted stays deleted, sync propagates it), one less join.

---

## 6. Sync redesign (the scalability fix)

Today `/sync` pushes every record every call and returns the full set.
At your target volume — 100 sessions × ~15 trials × ~60 trace frames — that
is megabytes per sync and grows without bound.

Replace with cursor-based incremental sync:

- `POST /api/sync` body: `{ since: {trial: 812, phrase: 44, …}, records: […only new/changed…] }`
- Response: records with `seq > since[kind]`, plus the new cursors and a
  `has_more` flag (page at 500 records).
- Client stores its cursors per kind in IndexedDB; `device.cursor_*` is the
  server's view for diagnostics.
- Idempotent by client-generated UUID, exactly as today — a retried push is
  a no-op, which is what makes an offline queue safe.
- Traces upload separately and lazily (`POST /api/traces`), so a flaky
  connection syncs the scores first and the waveforms after.

---

## 7. Logging and observability

- **Stdlib `logging`** with a small JSON-line formatter (a
  `logging.Formatter` subclass). Cloud Logging ingests stdout and parses
  the JSON into structured fields. No `google-cloud-logging` dependency.
- `redact_keys()` for anything sensitive; **assert in a test** that a
  session cookie value never appears in log output (the same kind of test
  that guards API keys).
- **Request middleware** opens a span per request, logs method, path,
  status, duration, user id, request id; persists to `analytics_span` /
  `analytics_event`.
- Domain events worth recording from day one: `auth.signup`,
  `auth.login`, `sync.push` (counts + bytes), `trial.saved`,
  `phrase.saved`, `range.measured`, `account.deleted`.
- **Alerting** via a Terraform monitoring module: a log-based metric on
  `severity>=ERROR`, an uptime check on `/health`, and an email channel.
- Health endpoints: `/health` (liveness, no DB) and `/ready` (readiness,
  touches the DB) — Cloud Run's startup and liveness probes hit them.

Deliberately skipped, as in the reference stack: no Sentry, no
OpenTelemetry. Error aggregation can be added later if logs stop being
enough.

---

## 8. Config and secrets

- Pydantic settings model + layered loader (`config.json` defaults ← env ←
  validate).
- **Secret Manager** containers and IAM owned by Terraform; **values added
  out-of-band** with `gcloud secrets versions add` so an apply can never
  clobber them. Per-secret `secretAccessor` to the service account, never a
  project-wide role.
- Secrets needed: `DATABASE_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`,
  `WORKOS_COOKIE_PASSWORD`.
- `VC_ECHO_CODES` disappears with the magic-code system. Until then it must
  default **off**, not on.
- `.env.example` is the convention doc; real `.env` gitignored.

---

## 9. Security hardening

| Control | Implementation |
|---|---|
| CORS | Explicit allowlist from env; localhost origins **only outside staging/prod**. Same-origin in prod means CORS is mostly moot. |
| Security headers | `SecurityHeadersMiddleware`: HSTS 2y, CSP `default-src 'self'`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` |
| Body size cap | 10 MB (traces are the biggest payload), 413 on `Content-Length` |
| Rate limiting | Sliding-window per-user/IP on auth (5/min), sync (60/min), traces (30/min). An in-process limiter is enough; note it is **per-instance**, acceptable at min=0..2 |
| Docs endpoints | `/docs`, `/redoc`, `/openapi.json` disabled when `ENVIRONMENT` is staging/production |
| Open redirect | Safe-path regex on any `next` param |
| Dependency scan | `scripts/ci/dependency_scan.sh` gating CI **and** deploy |
| Account deletion | `DELETE /api/account` — cascade all user rows, revoke WorkOS session, return the export first |
| Data export | `GET /api/account/export` → the same JSON the client already writes |

---

## 10. Deploy topology, IaC, CI/CD

**Terraform**, in three layers: `bootstrap/` (WIF pool, deployer SA,
Artifact Registry) + `modules/` + `envs/{staging,prod}` with
`*.auto.tfvars`.

**Cloud Run v2**, `vc-<env>-backend`, `us-west1` (co-located with the
Cloud SQL instance), cpu 1 / memory 512Mi, **min instances 0** — there is
no in-process background work, so cold starts are acceptable and the idle
cost is zero.

**Dockerfile**: `python:3.12-slim`, non-root uid 1000, entrypoint runs
Alembic then execs uvicorn.

**GitHub Actions**, keyless via Workload Identity Federation, all actions
SHA-pinned:
- `ci.yml` on PR: pytest (SQLite, `AUTH_MODE=fixed`) + a Postgres 16
  service-container job + `npm test` (the 217 vitest) + dependency scan.
- `deploy-gcp.yml`: `staging/**` → staging, `release/**` → prod. Build and
  push image → `gcloud run deploy` → `npm run build` → `gcloud storage
  rsync dist gs://vc-<env>-spa-<project>` → cache-control metadata
  (`immutable` for `/assets/**`, `no-store` for `index.html`) → CDN
  invalidate → smoke `curl /api/ready`.

**Frontend**: GCS bucket + Cloud CDN behind the same LB, `not_found_page =
index.html` for SPA routing. `VITE_API_BASE=/api`, same-origin.

---

## 11. Phased build order

Each phase is independently shippable and leaves the app working.

| # | Phase | Contents | Est. |
|---|---|---|---|
| 1 | **Stop the bleeding** | Rate-limit + attempt-cap `/auth/verify`; hash session tokens; `VC_ECHO_CODES` defaults off; CORS from env; security headers; body cap | 0.5 day |
| 2 | **Postgres + Alembic** | SQLAlchemy models above, initial migration, local Postgres via Docker Compose, dual-run against SQLite in CI, backfill script from `dev.db` | 1.5 days |
| 3 | **Typed schema + incremental sync** | Split the blob table into typed tables, `seq` cursors, paged sync, separate trace upload, client cursor storage | 2 days |
| 4 | **WorkOS AuthKit** | Replace magic codes; BFF cookie; `AUTH_MODE`; identity linking; sign-out-everywhere; delete-account; export | 2 days |
| 5 | **Logging + observability** | JSON formatter, request middleware, analytics tables, redaction test, `/health` + `/ready` | 1 day |
| 6 | **Containerize + CI** | Dockerfile, entrypoint, `ci.yml` with the Postgres job, dependency scan | 1 day |
| 7 | **Terraform + first deploy** | bootstrap, modules, staging env, WIF, Secret Manager, first `gcloud run deploy` | 2 days |
| 8 | **Prod + frontend + monitoring** | prod env, LB host rule, SPA bucket + CDN, uptime check, error alert, smoke test | 1.5 days |

**~11-12 focused days.** Phase 1 is worth doing this week regardless —
it is small and it is the difference between "insecure but private" and
"insecure and reachable".

---

## 12. Cost, and the decision that drives it

Standalone, the expensive line is the **load balancer** (~$18/mo for
forwarding rules), not the compute:

| Item | Standalone | Sharing existing infra |
|---|---|---|
| Global external ALB | ~$18/mo | **$0** (add a host rule to an existing LB) |
| Cloud SQL db-f1-micro | ~$9/mo | **$0** (add a `vocal` database to an existing instance) |
| Cloud Run (min=0) | ~$0-3/mo | ~$0-3/mo |
| GCS + CDN + Artifact Registry | ~$1/mo | ~$1/mo |
| **Total** | **~$30/mo** | **~$4/mo** |

If another service's LB already does host-based routing and its Cloud SQL
instance has headroom, adding `vocalcompass.<your-domain>` as a host rule
plus a second database on the same instance is the cheap, conventional
move — and it keeps one Terraform state to operate.

The argument against: blast radius. A bad Vocal Compass migration runs on
the same Postgres instance as the other service (different database, but
same instance and same maintenance window), and a Terraform mistake
touches shared infra. When the other service already has real users and
Vocal Compass is new, **separate project, shared LB only** is the middle
path I would actually pick: own Cloud SQL (isolated blast radius, $9/mo),
shared LB (saves $18/mo, one DNS story).

---

## 13. Decisions needed before Phase 2

1. **Infra split**: project shared with an existing service / separate
   project with shared LB (recommended) / fully standalone?
2. **Domain**: subdomain of an existing domain, or its own?
3. **WorkOS**: new tenant, or a second application in an existing one?
4. **Signup**: open, or allowlist-gated?
5. **Existing data**: your local IndexedDB records — migrate into the first
   account on sign-in, or start clean?
