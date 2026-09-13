"""Logging: JSON lines on stdout shaped for Cloud Logging, or readable text locally.

Stdlib logging only. Cloud Run ships stdout to Cloud Logging, which parses each
JSON line into a structured entry: `severity` sets the level, the
`logging.googleapis.com/trace` field ties the line to its request's trace, and
an `@type` of ReportedErrorEvent sends exceptions to Error Reporting. Domain
events are ordinary lines with an `event` field, so Terraform can route them
to BigQuery and log-based metrics without a second pipeline.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import uuid
from collections.abc import Mapping
from contextvars import ContextVar, Token
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .settings import Settings

ERROR_EVENT_TYPE = "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent"
TRACE_FIELD = "logging.googleapis.com/trace"
SPAN_FIELD = "logging.googleapis.com/spanId"
REDACTED = "[redacted]"

_FIELDS_ATTR = "vc_fields"
_SENSITIVE_WORDS = frozenset({"cookie", "authorization", "token", "password", "secret", "code"})
# Postgres quotes a violated key's values in its own error text, "Key (email)=(someone@example.com) already exists.",
# which hide_parameters cannot reach. The columns may be an expression with parentheses of its own, and Postgres
# escapes none inside the values, so they run to the line's last parenthesis (or its end).
_KEY_VALUES = re.compile(r"(Key \(.*?\)=\()(?:.*\)|.*)")
_events = logging.getLogger("vocal_compass.events")


@dataclass(slots=True)
class RequestContext:
    """What every log line emitted while serving one request carries.

    Mutable on purpose: the object is shared by reference, so a user id bound
    inside a threadpool dependency (where ContextVar writes do not propagate
    back) is still seen by every later line of the same request.
    """

    request_id: str
    trace_id: str | None = None
    span_id: str | None = None
    user_id: str | None = None


_request: ContextVar[RequestContext | None] = ContextVar("vc_request", default=None)


def bind_request(context: RequestContext) -> Token[RequestContext | None]:
    return _request.set(context)


def unbind_request(token: Token[RequestContext | None]) -> None:
    _request.reset(token)


def bind_user(user_id: uuid.UUID | str) -> None:
    """Attach the internal user id to the current request's log lines (never an email)."""
    context = _request.get()
    if context is not None:
        context.user_id = str(user_id)


def event(name: str, /, *, severity: int = logging.INFO, **fields: Any) -> None:
    """Log one domain event: a line whose `event` field is `name`, with `fields` alongside."""
    _events.log(severity, name, extra={_FIELDS_ATTR: {"event": name, **fields}})


def redact(value: Any) -> Any:
    """Copy `value`, replacing whatever sits under a sensitive-looking key, at any depth.

    Keys are matched word by word (snake, kebab, and camelCase split), case-
    insensitively, against cookie/authorization/token/password/secret/code and
    api_key. Word-wise means `status_code` is redacted too: name such fields
    `status` instead.
    """
    if isinstance(value, Mapping):
        return {key: REDACTED if _sensitive(str(key)) else redact(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    return value


def _sensitive(key: str) -> bool:
    words = re.findall(r"[a-z0-9]+", re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", key).lower())
    return "apikey" in "".join(words) or any(word.removesuffix("s") in _SENSITIVE_WORDS for word in words)


class _Formatter(logging.Formatter):
    """What both line formats share: the one place an exception becomes text."""

    def formatException(self, ei: Any) -> str:
        return _KEY_VALUES.sub(rf"\g<1>{REDACTED})", super().formatException(ei))


class JsonFormatter(_Formatter):
    """One Cloud Logging entry per line; see the module docstring for the fields that matter."""

    def __init__(self, *, release: str, environment: str, project: str = "") -> None:
        super().__init__()
        self._release = release
        self._environment = environment
        self._project = project

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = redact(getattr(record, _FIELDS_ATTR, {}))
        message = record.getMessage()
        if record.exc_info:
            message = f"{message}\n{self.formatException(record.exc_info)}"
            entry["@type"] = ERROR_EVENT_TYPE
        if record.stack_info:
            message = f"{message}\n{self.formatStack(record.stack_info)}"
        entry.update(
            severity=_severity(record.levelno),
            message=message,
            time=datetime.fromtimestamp(record.created, UTC).isoformat(timespec="microseconds").replace("+00:00", "Z"),
            logger=record.name,
            release=self._release,
            environment=self._environment,
        )
        context = _request.get()
        if context is not None:
            entry["requestId"] = context.request_id
            if context.user_id:
                entry["userId"] = context.user_id
            if context.trace_id and self._project:
                entry[TRACE_FIELD] = f"projects/{self._project}/traces/{context.trace_id}"
                if context.span_id:
                    entry[SPAN_FIELD] = context.span_id
        return json.dumps(entry, default=str, ensure_ascii=False)


class TextFormatter(_Formatter):
    """Readable lines for a local terminal: event fields and request id trail the message."""

    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)-8s %(name)s  %(message)s", "%H:%M:%S")

    def formatMessage(self, record: logging.LogRecord) -> str:
        fields = redact(getattr(record, _FIELDS_ATTR, {}))
        fields.pop("event", None)  # already the message
        context = _request.get()
        if context is not None:
            fields["requestId"] = context.request_id
            if context.user_id:
                fields["userId"] = context.user_id
        suffix = " ".join(f"{key}={value}" for key, value in fields.items())
        line = super().formatMessage(record)
        return f"{line}  {suffix}" if suffix else line


def formatter_for(settings: Settings) -> logging.Formatter:
    if settings.log_format == "text":
        return TextFormatter()
    return JsonFormatter(
        release=settings.release,
        environment=settings.environment,
        project=settings.google_cloud_project,
    )


class _StdoutHandler(logging.StreamHandler):  # type: ignore[type-arg]
    """Marks the one handler configure_logging owns, so a second call replaces it."""


def configure_logging(settings: Settings) -> None:
    """Send every log line, ours and uvicorn's, through one stdout handler.

    Idempotent: replaces the handler a previous call installed and leaves any
    other handler (pytest's capture, for one) alone. Uvicorn's access log is
    rerouted only if uvicorn left it enabled: uvicorn logs each request
    whenever that logger has any handler, root's included, so routing it
    under --no-access-log would silently switch per-request lines back on.
    Uvicorn's loggers also lose their own levels, so LOG_LEVEL governs them too,
    and its access lines lose their query strings.
    """
    root = logging.getLogger()
    for handler in [h for h in root.handlers if isinstance(h, _StdoutHandler)]:
        root.removeHandler(handler)
    handler = _StdoutHandler(sys.stdout)
    handler.setFormatter(formatter_for(settings))
    root.addHandler(handler)
    root.setLevel(settings.log_level)
    access = logging.getLogger("uvicorn.access")
    access.addFilter(_without_query_string)
    for server_logger in (logging.getLogger("uvicorn"), logging.getLogger("uvicorn.error"), access):
        if server_logger is access and not access.handlers:
            continue
        server_logger.handlers.clear()
        server_logger.setLevel(logging.NOTSET)
        server_logger.propagate = True


def _without_query_string(record: logging.LogRecord) -> bool:
    """Cuts the query string from a uvicorn access line, logged with (client, method, path?query, HTTP version, status).

    Only a local server prints access lines (containers run --no-access-log),
    and there a sign-in callback's would show its code and state. Every path
    loses its query, not only the callback's: one rule cannot miss a route,
    and a local access log needs no more than the path.
    """
    if isinstance(record.args, tuple) and len(record.args) == 5:
        client, method, target, version, status = record.args
        record.args = (client, method, str(target).partition("?")[0], version, status)
    return True


def _severity(levelno: int) -> str:
    for threshold, name in (
        (logging.CRITICAL, "CRITICAL"),
        (logging.ERROR, "ERROR"),
        (logging.WARNING, "WARNING"),
        (logging.INFO, "INFO"),
        (logging.DEBUG, "DEBUG"),
    ):
        if levelno >= threshold:
            return name
    return "DEFAULT"
