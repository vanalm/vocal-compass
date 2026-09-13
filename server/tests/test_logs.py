"""Log line shape for Cloud Logging, request/trace correlation, domain events, and redaction."""

from __future__ import annotations

import io
import json
import logging
import socket
import sys
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit

import httpx2
import pytest
import sqlalchemy as sa
import uvicorn
from fastapi import FastAPI
from fastapi.testclient import TestClient

from support import CLIENT_LOGGER, FakeProvider, item, make_settings, post_sync, postgres_only, sample, sign_in, tombstone_for
from vocal_compass.logs import (
    ERROR_EVENT_TYPE,
    SPAN_FIELD,
    TRACE_FIELD,
    JsonFormatter,
    RequestContext,
    TextFormatter,
    bind_request,
    bind_user,
    configure_logging,
    event,
    redact,
    unbind_request,
)
from vocal_compass.models import User

TRACE_ID = "0af7651916cd43dd8448eb211c80319c"
SPAN_ID = "00f067aa0ba902b7"


def record(message: str = "hello world", level: int = logging.WARNING, exc_info: Any = None) -> logging.LogRecord:
    return logging.LogRecord("vocal_compass.test", level, __file__, 1, message, (), exc_info)


def as_json(log_record: logging.LogRecord, project: str = "vc-project") -> dict[str, Any]:
    formatter = JsonFormatter(release="abc123", environment="production", project=project)
    entry: dict[str, Any] = json.loads(formatter.format(log_record))
    return entry


@pytest.fixture
def request_context() -> Iterator[RequestContext]:
    context = RequestContext("req-1", trace_id=TRACE_ID, span_id=SPAN_ID)
    token = bind_request(context)
    try:
        yield context
    finally:
        unbind_request(token)


def test_json_line_shape() -> None:
    entry = as_json(record())
    assert entry.keys() == {"severity", "message", "time", "logger", "release", "environment"}
    assert entry["severity"] == "WARNING"
    assert entry["message"] == "hello world"
    assert entry["logger"] == "vocal_compass.test"
    assert (entry["release"], entry["environment"]) == ("abc123", "production")
    assert entry["time"].endswith("Z")
    assert datetime.fromisoformat(entry["time"]).tzinfo == UTC


@pytest.mark.parametrize(
    ("level", "severity"),
    [
        (logging.DEBUG, "DEBUG"),
        (logging.INFO, "INFO"),
        (logging.WARNING, "WARNING"),
        (logging.ERROR, "ERROR"),
        (logging.CRITICAL, "CRITICAL"),
        (5, "DEFAULT"),
    ],
)
def test_severity_uses_cloud_logging_names(level: int, severity: str) -> None:
    assert as_json(record(level=level))["severity"] == severity


def test_request_context_adds_request_trace_span_and_user(request_context: RequestContext) -> None:
    user_id = uuid.uuid4()
    bind_user(user_id)
    entry = as_json(record())
    assert entry["requestId"] == "req-1"
    assert entry["userId"] == str(user_id)
    assert entry[TRACE_FIELD] == f"projects/vc-project/traces/{TRACE_ID}"
    assert entry[SPAN_FIELD] == SPAN_ID


def test_trace_field_needs_a_project(request_context: RequestContext) -> None:
    entry = as_json(record(), project="")
    assert entry["requestId"] == "req-1"
    assert TRACE_FIELD not in entry and SPAN_FIELD not in entry


def test_lines_outside_a_request_carry_no_request_fields() -> None:
    bind_user(uuid.uuid4())  # no request bound: a no-op
    entry = as_json(record())
    assert "requestId" not in entry and "userId" not in entry


def test_exceptions_carry_the_stack_for_error_reporting() -> None:
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        entry = as_json(record("failed", level=logging.ERROR, exc_info=sys.exc_info()))
    assert entry["@type"] == ERROR_EVENT_TYPE
    assert entry["message"].startswith("failed\nTraceback (most recent call last):")
    assert entry["message"].endswith("RuntimeError: boom")


def test_exception_text_never_carries_a_violated_keys_values() -> None:
    """Postgres quotes them in its own error text, beyond hide_parameters, and unescaped: a value may hold a parenthesis."""
    detail = "\n".join(
        (
            'duplicate key value violates unique constraint "uq_user_email"',
            "DETAIL:  Key (email)=(someone@example.com) already exists.",
            "DETAIL:  Key (lower(email::text))=(some)one@example.com) already exists.",
            'DETAIL:  Key (user_id, id)=(0b7c4e1e-5d0a-4f4e-9d51-3f0c8e6a2b11, trial-7f3a9c) is not present in table "user".',
        )
    )
    try:
        raise RuntimeError(detail)
    except RuntimeError:
        exc_info = sys.exc_info()
    json_message = as_json(record("failed", level=logging.ERROR, exc_info=exc_info))["message"]
    text_line = TextFormatter().format(record("failed", level=logging.ERROR, exc_info=exc_info))
    for written in (json_message, text_line):
        assert 'RuntimeError: duplicate key value violates unique constraint "uq_user_email"' in written
        assert "DETAIL:  Key (email)=([redacted]) already exists." in written
        assert "DETAIL:  Key (lower(email::text))=([redacted]) already exists." in written
        assert 'DETAIL:  Key (user_id, id)=([redacted]) is not present in table "user".' in written
        assert not [value for value in ("example.com", "0b7c4e1e", "trial-7f3a9c") if value in written]


@postgres_only
def test_a_real_unique_violation_logs_no_key_values(app: FastAPI, json_logs: Callable[[], list[dict[str, Any]]]) -> None:
    email = "private.person@example.com"
    with app.state.sessions() as session:
        session.add(User(email=email))
        session.commit()
        session.add(User(email=email))
        with pytest.raises(sa.exc.IntegrityError) as raised:
            session.commit()
    logging.getLogger("vocal_compass.test").error("Sign-up failed", exc_info=raised.value)
    lines = json_logs()
    (error,) = [line for line in lines if line["severity"] == "ERROR"]
    assert "DETAIL:  Key (email)=([redacted]) already exists." in error["message"]
    assert email not in json.dumps(lines)


def test_events_are_lines_with_an_event_field(json_logs: Callable[[], list[dict[str, Any]]]) -> None:
    event("sync.completed", accepted=3, has_more=False)
    event("client.error", severity=logging.WARNING, source="worklet")
    completed, client_error = [line for line in json_logs() if "event" in line]
    assert completed["event"] == completed["message"] == "sync.completed"
    assert (completed["severity"], completed["accepted"], completed["has_more"]) == ("INFO", 3, False)
    assert (client_error["severity"], client_error["source"]) == ("WARNING", "worklet")


def test_event_fields_cannot_overwrite_core_fields(json_logs: Callable[[], list[dict[str, Any]]]) -> None:
    event("auth.login", message="spoofed", logger="spoofed", release="spoofed")
    line = json_logs()[-1]
    assert (line["message"], line["logger"], line["release"]) == ("auth.login", "vocal_compass.events", "test")


def test_redaction_is_recursive_word_wise_and_case_insensitive() -> None:
    assert redact(
        {
            "Cookie": "a",
            "headers": {"Authorization": "b", "x-request-id": "kept"},
            "items": [{"sessionToken": "c"}, {"api_key": "d"}, {"WORKOS_API_KEY": "e"}, ("tuple", {"code": "f"})],
            "passwords": ["g"],
            "clientSecret": "h",
            "set-cookie": "i",
            "accepted": 3,
            "encoded": "kept",
        }
    ) == {
        "Cookie": "[redacted]",
        "headers": {"Authorization": "[redacted]", "x-request-id": "kept"},
        "items": [{"sessionToken": "[redacted]"}, {"api_key": "[redacted]"}, {"WORKOS_API_KEY": "[redacted]"}, ["tuple", {"code": "[redacted]"}]],
        "passwords": "[redacted]",
        "clientSecret": "[redacted]",
        "set-cookie": "[redacted]",
        "accepted": 3,
        "encoded": "kept",
    }


def test_event_fields_are_redacted_in_json(json_logs: Callable[[], list[dict[str, Any]]]) -> None:
    event("auth.callback", code="the-auth-code", nested={"refresh_token": "the-token"}, provider="dev")
    line = json_logs()[-1]
    assert line["code"] == "[redacted]"
    assert line["nested"] == {"refresh_token": "[redacted]"}
    assert "the-auth-code" not in json.dumps(line) and "the-token" not in json.dumps(line)


def test_text_lines_are_readable_and_redacted(request_context: RequestContext) -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(TextFormatter())
    events_logger = logging.getLogger("vocal_compass.events")
    events_logger.addHandler(handler)
    events_logger.setLevel(logging.INFO)  # not whatever level an earlier test left the root logger at
    try:
        event("sync.completed", accepted=3, token="the-token")
    finally:
        events_logger.removeHandler(handler)
        events_logger.setLevel(logging.NOTSET)
    line = stream.getvalue()
    assert "sync.completed  accepted=3 token=[redacted] requestId=req-1" in line
    assert "the-token" not in line


def test_configure_logging_owns_one_stdout_handler_and_routes_uvicorn(monkeypatch: pytest.MonkeyPatch) -> None:
    root = logging.getLogger()
    access = logging.getLogger("uvicorn.access")
    monkeypatch.setattr(access, "handlers", [logging.NullHandler()])  # uvicorn's own, access log enabled
    monkeypatch.setattr(access, "propagate", False)
    monkeypatch.setattr(logging.getLogger("uvicorn.error"), "level", logging.INFO)  # uvicorn's --log-level
    configure_logging(make_settings(log_level="WARNING"))
    configure_logging(make_settings(log_level="WARNING"))
    ours = [h for h in root.handlers if isinstance(h.formatter, (JsonFormatter, TextFormatter))]
    assert len(ours) == 1 and isinstance(ours[0].formatter, JsonFormatter)
    assert root.level == logging.WARNING
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        server_logger = logging.getLogger(name)
        assert server_logger.handlers == [] and server_logger.propagate and server_logger.level == logging.NOTSET
    configure_logging(make_settings(environment="development"))
    assert [type(h.formatter) for h in root.handlers if isinstance(h.formatter, (JsonFormatter, TextFormatter))] == [TextFormatter]


def test_configure_logging_keeps_a_disabled_access_log_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    access = logging.getLogger("uvicorn.access")
    monkeypatch.setattr(access, "handlers", [])  # what uvicorn leaves under --no-access-log
    monkeypatch.setattr(access, "propagate", False)
    configure_logging(make_settings())
    assert not access.hasHandlers()


def test_secrets_never_reach_the_logs(
    app: FastAPI, provider: FakeProvider, json_logs: Callable[[], list[dict[str, Any]]]
) -> None:
    """Everything the server logs at DEBUG over a whole visit: sign-in, sync, an error report, export, sign-out.

    FakeProvider seals sessions exactly as the dev provider does but takes a
    distinctive code, so the code itself can be searched for.
    """
    email = "singer@example.com"
    code = f"{email}|user_7f3a9c"
    authorization = "Bearer vc-authorization-7f3a9c"
    device = TestClient(app, headers={"Authorization": authorization})
    login = device.get("/api/auth/login", params={"returnTo": "/range"}, follow_redirects=False)
    nonce = parse_qs(urlsplit(login.headers["location"]).query)["state"][0]
    device.get("/api/auth/callback", params={"code": code, "state": nonce}, follow_redirects=False)
    sealed = device.cookies["vc_session"]
    post_sync(device, records=[item("trial", sample("trial", "t1"))], tombstones=[tombstone_for("trial", "t0")])
    report = {"message": "TypeError: boom", "url": f"https://vocal.example.com/api/auth/callback?code={code}&state={nonce}"}
    assert device.post("/api/telemetry/errors", json=report).status_code == 204
    device.get("/api/me")
    device.get("/api/account/export")
    device.post("/api/auth/logout")

    lines = [line for line in json_logs() if line["logger"] != CLIENT_LOGGER]
    assert {"auth.signup", "sync.completed", "client.error", "account.exported", "auth.logout"} <= {line.get("event") for line in lines}
    text = "\n".join(json.dumps(line) for line in lines)
    for secret in (nonce, code, quote(code, safe=""), sealed, email, quote(email, safe=""), authorization.split()[1]):
        assert secret not in text


def test_the_local_access_log_prints_no_query_strings(make_app: Callable[..., FastAPI]) -> None:
    """A development server prints uvicorn's access lines as text, where the callback's would show its code and state."""
    app = make_app(environment="development")
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(TextFormatter())
    # The test's own HTTP client logs every URL and header it handles; only the server's lines count.
    handler.addFilter(lambda record: record.name.partition(".")[0] not in {CLIENT_LOGGER, "httpcore2"})
    root = logging.getLogger()
    root.addHandler(handler)
    listener = socket.create_server(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(app, lifespan="off", ws="none", log_config=None))
    serving = threading.Thread(target=server.run, kwargs={"sockets": [listener]})
    serving.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and serving.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        with httpx2.Client(base_url=f"http://127.0.0.1:{listener.getsockname()[1]}") as browser:
            login = browser.get("/api/auth/login", params={"returnTo": "/range"})
            nonce = parse_qs(urlsplit(login.headers["location"]).query)["state"][0]
            assert browser.get(login.headers["location"]).headers["location"] == "/range"
            assert browser.get("/api/me").json()["user"] is not None
    finally:
        server.should_exit = True
        serving.join(10)
        root.removeHandler(handler)
        listener.close()
    lines = stream.getvalue().splitlines()
    requests = [line.split('"')[1] for line in lines if " uvicorn.access " in line]
    assert requests == ["GET /api/auth/login HTTP/1.1", "GET /api/auth/callback HTTP/1.1", "GET /api/me HTTP/1.1"]
    assert not [line for line in lines if nonce in line or "code=" in line]


def test_a_failed_statement_never_logs_its_bound_values(
    app: FastAPI, provider: FakeProvider, json_logs: Callable[[], list[dict[str, Any]]]
) -> None:
    """Such as the signing-in email, when a database failover breaks the sign-in's lookup."""
    email = "private.person@example.com"

    def break_statements(
        connection: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> tuple[str, Any]:
        # A syntax error that keeps the statement's parameters; statements without any, such as BEGIN, still run.
        return (f"{statement} and then some" if parameters else statement), parameters

    sa.event.listen(app.state.engine, "before_cursor_execute", break_statements, retval=True)
    try:
        response = sign_in(TestClient(app), email)
    finally:
        sa.event.remove(app.state.engine, "before_cursor_execute", break_statements)
    assert response.status_code == 500
    lines = [line for line in json_logs() if line["logger"] != CLIENT_LOGGER]
    (error,) = [line for line in lines if line["severity"] == "ERROR"]
    assert "[SQL parameters hidden due to hide_parameters=True]" in error["message"]
    assert email not in json.dumps(lines)
