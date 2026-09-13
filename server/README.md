# Vocal Compass server

One FastAPI process serves the built SPA and `/api`: sign-in through WorkOS AuthKit, incremental
sync of practice records into an account, account export and deletion, and browser error reports.
Postgres in production, SQLite on a laptop. The browser's local data stays the source of truth; an
account holds a synced copy.

## Run locally

```bash
cd server
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn --factory vocal_compass.app:create_app --reload --port 8799
```

Then run `npm run dev` from the repo root. Vite serves the SPA on http://localhost:5199 and proxies
`/api` to port 8799, so the browser sees one origin for pages, cookies and API calls. Development
needs no configuration: dev auth signs you in as `dev@localhost`, data goes to `./dev.db`, which the
server creates and migrates to the newest schema whenever it starts, logs are readable text, and API
docs are at http://localhost:8799/docs.

## Dependencies

`requirements.in` and `requirements-dev.in` name the direct dependencies. `requirements.txt` and
`requirements-dev.txt` lock every package with hashes, for Linux and macOS alike; the image installs
with `--require-hashes`. After changing a `.in` file, regenerate both locks from `server/`:

```bash
uv pip compile --universal --python-version 3.12 --generate-hashes requirements.in -o requirements.txt
uv pip compile --universal --python-version 3.12 --generate-hashes requirements-dev.in -o requirements-dev.txt
```

## Test

```bash
cd server && .venv/bin/python -m pytest -q
```

Each test gets an in-memory SQLite database. To run the whole suite against Postgres 16, as CI does:

```bash
docker run -d --rm --name vc-pg -e POSTGRES_USER=vocal -e POSTGRES_PASSWORD=vocal -p 127.0.0.1:55432:5432 postgres:16
TEST_DATABASE_URL=postgresql+psycopg://vocal:vocal@127.0.0.1:55432/vocal .venv/bin/python -m pytest -q
docker stop vc-pg
```

Run the tests from a full checkout: one reads the client's `src/core/storage/TrialRepository.ts`.

## Configuration

The environment is read once at startup; a bad value stops the process with a message naming the
variable. `.env.example` lists every variable with comments (`uvicorn --env-file .env` loads one).

| Variable | Default | Notes |
|---|---|---|
| `ENVIRONMENT` | `development` | `development`, `test`, `staging` or `production` |
| `APP_BASE_URL` | `http://localhost:5199` | The origin browsers use, no trailing slash. OAuth redirect: `{APP_BASE_URL}/api/auth/callback`. https adds Secure `__Host-` cookies and HSTS |
| `DATABASE_URL` | `sqlite:///./dev.db` in development and test | Required in staging and production; `sqlite://` or `postgresql+psycopg://` |
| `AUTH_MODE` | `dev` in development and test, else `workos` | `dev` is refused in staging and production |
| `WORKOS_CLIENT_ID`, `WORKOS_API_KEY` | none | Required when `AUTH_MODE=workos` |
| `WORKOS_COOKIE_PASSWORD` | none | Required when `AUTH_MODE=workos`: a Fernet key, see below |
| `SESSION_SECRET` | a public constant | Signs dev-auth cookies |
| `AUTH_ALLOWED_EMAILS` | empty: anyone may sign up | Comma list; `@example.com` admits a whole domain |
| `LOG_FORMAT` | `text` in development, else `json` | `json` is Cloud Logging's structured format |
| `LOG_LEVEL` | `INFO` | |
| `GOOGLE_CLOUD_PROJECT` | empty | Ties log lines to request traces |
| `SPA_DIST_DIR` | empty: no SPA | The built SPA; the container sets `/app/web` |
| `RELEASE` | `dev` | The image's git SHA, reported by `/api/health` and on every log line |
| `TRUSTED_PROXY_HOPS` | `0` | How many proxies in front of the app append to `X-Forwarded-For`: `1` on Cloud Run's run.app URL, `2` behind the load balancer. `0` trusts only the connection's peer |
| `RUN_MIGRATIONS_ON_START` | `0` | `0` or `1`; `1` makes `entrypoint.sh` run `alembic upgrade head` before the server starts |

The WorkOS SDK seals sessions with Fernet, so `WORKOS_COOKIE_PASSWORD` must be 32 random bytes,
base64-encoded: `python3 -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"`.
In the WorkOS dashboard, add `{APP_BASE_URL}/api/auth/callback` as a redirect URI and set the
sign-out redirect, where WorkOS sends the browser after `logoutUrl`.

Rate limits are counted per instance, so with several instances a client can get up to that many
times the limit:

| Routes | Limit per minute |
|---|---|
| `/api/auth/*` | 30 per client IP |
| `/api/sync` | 120 per signed-in user, and toward the 600 per client IP below |
| `/api/telemetry/*` | 30 per client IP |
| everything else under `/api` | 600 per client IP |

The client IP is the `X-Forwarded-For` entry the outermost trusted proxy wrote (`TRUSTED_PROXY_HOPS`),
so entries a client adds itself change nothing.

Request bodies are capped before a route parses them: 4 MB for `/api/sync`, 64 KB for everything
else, 413 above that. An instance also handles at most two sync bodies at once; a sync that arrives
while both are taken gets 503 with `Retry-After`.

## Module map

| Module | Job |
|---|---|
| `vocal_compass/app.py` | `create_app()`: settings, logging, engine, identity provider, routers, middleware order |
| `vocal_compass/settings.py` | Environment variables into validated `Settings` |
| `vocal_compass/logs.py` | JSON and text formatters, request context, `event()`, redaction |
| `vocal_compass/middleware.py` | Security headers, request id and trace, JSON 500, Origin check, body limits, JSON 404 and 422 |
| `vocal_compass/ratelimit.py` | Sliding-window limits: the bucket table, per-IP middleware, per-user dependency |
| `vocal_compass/db.py` | Engine per backend, the session dependency, `migrate()`, column types that behave alike on both |
| `vocal_compass/models.py` | `User`, and one table per record kind |
| `vocal_compass/records.py` | `KINDS`: each client kind's model, export key and typed columns |
| `vocal_compass/auth/providers.py` | `IdentityProvider`, `WorkOSProvider`, `DevProvider` |
| `vocal_compass/auth/session.py` | Cookies, the `optional_user` / `current_user` dependencies, and the middleware that writes the session cookie |
| `vocal_compass/auth/routes.py` | `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`, `/api/me` |
| `vocal_compass/api/health.py` | `/api/health` (liveness), `/api/ready` (database) |
| `vocal_compass/api/sync.py` | `/api/sync` |
| `vocal_compass/api/account.py` | `/api/account/export`, `DELETE /api/account` |
| `vocal_compass/api/telemetry.py` | `/api/telemetry/errors` |
| `vocal_compass/spa.py` | Built SPA files, page fallback, cache headers |
| `migrations/` | Alembic; Postgres upgrades hold an advisory lock, so instances can start together |
| `entrypoint.sh` | The container entrypoint: migrate if asked, then `exec` the server |

## Adding a record kind

1. A model in `models.py`: `class Chord(SyncedRecord, Base)` with its typed columns (Boolean, Integer,
   Float, or bounded String).
2. An entry in `records.KINDS`: the client's kind name, its key in ExportPayload, the model, and each
   column's path in the client record. The entry refuses to load if columns and paths disagree.
3. A migration: `.venv/bin/alembic revision --autogenerate -m "chord"`, then review it, and extend the
   Postgres `trace_frame` view if the kind carries a trace. `test_migrations.py` fails until the
   migration builds exactly what the models describe.
4. The client. Add the kind to `SyncRecordKind` in `src/core/types.ts`, and `tsc` flags the missing
   `LOCAL` entry in `src/core/sync/syncAccount.ts` and `noneSent()` entry in `src/core/sync/SyncLedger.ts`;
   that `LOCAL` entry needs a `SyncRecord` member in `src/core/sync/ApiClient.ts`, which makes it flag
   `saveRecord`'s missing case, and both need repository methods. Nothing flags the rest of
   `src/core/storage`: each repository's `applyTombstone` and `clear` (IndexedDB's `applyTombstone` falls
   through to `sessions`), IndexedDB's object store and `DB_VERSION`, and the export key in
   `ExportPayload` and `parseImportJson`, which `test_account.py` fails without.

On the server, sync, export and account deletion then handle the kind without further changes.

## After restoring the database

A point-in-time restore rewinds each account's sync sequence, but devices keep the cursors they had.
A device whose cursor is ahead of its account pulls the whole account again, and the server logs
`sync.cursor_ahead` at WARNING. That catches only a device that syncs before new writes carry the
account's sequence past its cursor: one that syncs later skips the rows written in between. Records
the restore lost also stay missing, since devices never push again what their ledger marks sent. A
complete recovery needs a sync generation that the server reports and clients compare, resetting their
ledgers when it changes; there is none yet.
