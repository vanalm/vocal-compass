"""POST /api/telemetry/errors: the browser's uncaught errors, logged as client.error events.

Anyone may report, signed in or not, so a report is bounded before it is
logged: long fields are cut rather than refused (a truncated stack still
helps), and the page URL keeps only its path, since a query string or fragment
can carry tokens. The route has its own rate-limit bucket. Fields are logged
under client_* names where the line's own `message` and `release` are the server's.
"""

from __future__ import annotations

import logging
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends
from pydantic import AfterValidator, BaseModel, Field

from ..auth.session import optional_user
from ..logs import event
from . import PREFIX

router = APIRouter(prefix=PREFIX, tags=["telemetry"])

MAX_MESSAGE = 500
MAX_STACK = 4000
MAX_LABEL = 100  # source and release
MAX_PATH = 512


def _clipped(limit: int) -> AfterValidator:
    return AfterValidator(lambda value: value[:limit])


def _path_only(url: str) -> str:
    try:
        return urlsplit(url).path[:MAX_PATH]
    except ValueError:  # unparseable, such as a broken IPv6 literal
        return ""


class ErrorReport(BaseModel):
    message: Annotated[str, Field(min_length=1), _clipped(MAX_MESSAGE)]
    stack: Annotated[str, _clipped(MAX_STACK)] | None = None
    source: Annotated[str, _clipped(MAX_LABEL)] | None = None
    url: Annotated[str, AfterValidator(_path_only)] | None = None
    release: Annotated[str, _clipped(MAX_LABEL)] | None = None


# optional_user binds a signed-in reporter's user id to the log line.
@router.post("/telemetry/errors", status_code=204, dependencies=[Depends(optional_user)])
def report_error(report: ErrorReport) -> None:
    event(
        "client.error",
        severity=logging.WARNING,
        client_message=report.message,
        stack=report.stack,
        source=report.source,
        path=report.url,
        client_release=report.release,
    )
