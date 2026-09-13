"""Liveness and readiness probes.

Liveness never touches the database, so an outage does not get healthy
instances killed and restarted; it is async so it still answers when the
threadpool is saturated. Readiness does touch it, so a new revision takes
traffic only once it can reach the database.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from . import PREFIX

logger = logging.getLogger(__name__)
router = APIRouter(prefix=PREFIX, tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict[str, str]:
    return {"status": "ok", "release": request.app.state.settings.release}


@router.get("/ready", responses={503: {"description": "The database is unreachable."}})
def ready(request: Request) -> JSONResponse:
    try:
        with request.app.state.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.warning("Readiness check failed: %s", getattr(exc, "orig", None) or type(exc).__name__)
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ready"})
