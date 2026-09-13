"""POST /api/telemetry/errors: bounded client error reports, logged as client.error events."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from support import events

Logs = Callable[[], list[dict[str, Any]]]
SignIn = Callable[[str], TestClient]
REPORT = {
    "message": "TypeError: x is undefined",
    "stack": "TypeError: x is undefined\n    at Range (/assets/index-3f2a9c1b.js:1:2)",
    "source": "window.error",
    "url": "/range",
    "release": "0123abc",
}
LOGGED = ("client_message", "stack", "source", "path", "client_release")


def reported(json_logs: Logs) -> list[dict[str, Any]]:
    return events(json_logs(), "client.error")


def test_a_report_is_logged_as_a_client_error_warning(client: TestClient, json_logs: Logs) -> None:
    response = client.post("/api/telemetry/errors", json=REPORT)
    assert (response.status_code, response.content) == (204, b"")
    (line,) = reported(json_logs)
    assert line["severity"] == "WARNING"
    assert [line[key] for key in LOGGED] == [REPORT["message"], REPORT["stack"], "window.error", "/range", "0123abc"]
    assert line["release"] == "test" and "userId" not in line


def test_only_the_message_is_required(client: TestClient, json_logs: Logs) -> None:
    assert client.post("/api/telemetry/errors", json={"message": "boom"}).status_code == 204
    (line,) = reported(json_logs)
    assert [line[key] for key in LOGGED] == ["boom", None, None, None, None]


def test_long_fields_are_cut_not_refused(client: TestClient, json_logs: Logs) -> None:
    report = {"message": "m" * 600, "stack": "s" * 5000, "source": "o" * 200, "url": "/" + "p" * 600, "release": "r" * 200}
    assert client.post("/api/telemetry/errors", json=report).status_code == 204
    (line,) = reported(json_logs)
    assert [len(line[key]) for key in LOGGED] == [500, 4000, 100, 512, 100]


@pytest.mark.parametrize(
    ("url", "path"),
    [
        ("https://vocal.example.com/range?code=secret-code#access_token=secret-token", "/range"),
        ("/quest/level-2?take=3", "/quest/level-2"),
        ("http://[::1", ""),
    ],
)
def test_a_url_keeps_only_its_path(client: TestClient, json_logs: Logs, url: str, path: str) -> None:
    client.post("/api/telemetry/errors", json={"message": "boom", "url": url})
    (line,) = reported(json_logs)
    assert line["path"] == path
    assert "secret" not in json.dumps(json_logs())


def test_a_signed_in_reporter_is_identified_by_user_id(signed_in: SignIn, json_logs: Logs) -> None:
    device = signed_in("singer@example.com")
    device.post("/api/telemetry/errors", json=REPORT)
    (line,) = reported(json_logs)
    assert line["userId"] == device.get("/api/me").json()["user"]["id"]


@pytest.mark.parametrize("body", [{}, {"message": ""}, {"message": 5}, {"message": "boom", "stack": ["frame"]}, [REPORT]])
def test_a_malformed_report_is_422_and_logs_nothing(client: TestClient, json_logs: Logs, body: Any) -> None:
    assert client.post("/api/telemetry/errors", json=body).status_code == 422
    assert reported(json_logs) == []
