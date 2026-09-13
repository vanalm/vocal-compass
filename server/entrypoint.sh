#!/usr/bin/env bash
# Container entrypoint: migrate when RUN_MIGRATIONS_ON_START=1, then exec the command (uvicorn).
#
# A failed migration exits non-zero before the server starts, so Cloud Run keeps the previous
# revision serving; migrations/env.py holds an advisory lock, so several instances may start at
# once. exec makes the server PID 1, so it receives Cloud Run's SIGTERM itself.
set -euo pipefail

if [[ "${RUN_MIGRATIONS_ON_START:-0}" == "1" ]]; then
  if ! alembic -c "$(dirname "$0")/alembic.ini" upgrade head; then
    echo "entrypoint: alembic upgrade head failed; not starting the server" >&2
    exit 1
  fi
fi

exec "$@"
