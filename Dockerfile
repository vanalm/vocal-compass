# One image serves the built SPA and /api, so a release can never pair an SPA with the wrong API.
#
#   docker build --build-arg RELEASE="$(git rev-parse HEAD)" -t vc-app .
#
# Configuration is all environment variables (server/README.md). Set RUN_MIGRATIONS_ON_START=1 to
# migrate before serving.

# The SPA is static output, the same on every platform. Building it natively keeps a cross-build
# (--platform linux/amd64 on an Apple Silicon Mac) out of emulation.
FROM --platform=$BUILDPLATFORM node:22-slim AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# Only what `npm run build` reads. A new build input, such as a public/ directory, needs a line here.
COPY index.html tsconfig.json vite.config.ts ./
COPY src/ src/
# The SPA tags its error reports with the same release as the API.
ARG RELEASE=dev
RUN VITE_RELEASE="$RELEASE" npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app/server

# requirements.txt locks every transitive dependency with its hashes, so each build installs the same
# files. All of them ship wheels for amd64 and arm64, so the image needs no compiler.
COPY server/requirements.txt ./
RUN pip install --root-user-action=ignore --require-hashes -r requirements.txt

RUN useradd --uid 1000 --user-group --no-create-home --shell /usr/sbin/nologin app
COPY server/alembic.ini server/entrypoint.sh ./
COPY server/migrations/ migrations/
COPY server/vocal_compass/ vocal_compass/
COPY --from=web /web/dist/ /app/web/
# The code stays root-owned and read-only to the app, so compile it now; Cloud Run cold starts
# would otherwise recompile it on every new instance.
RUN python -m compileall -q vocal_compass migrations

# Last, so a new commit rebuilds only metadata on top of the cached layers.
ARG RELEASE=dev
ENV RELEASE=$RELEASE \
    SPA_DIST_DIR=/app/web \
    PORT=8080
USER app
EXPOSE 8080

ENTRYPOINT ["/app/server/entrypoint.sh"]
# A shell expands Cloud Run's $PORT, then execs uvicorn, which stays PID 1 through the entrypoint's exec.
# --no-proxy-headers keeps the connection's peer as the client address: the app reads X-Forwarded-For
# itself, trusting only the TRUSTED_PROXY_HOPS entries its own proxies appended, while uvicorn would
# take the leftmost entry, which the client writes.
CMD ["sh", "-c", "exec uvicorn --factory vocal_compass.app:create_app --host 0.0.0.0 --port \"${PORT:-8080}\" --no-access-log --no-proxy-headers"]
