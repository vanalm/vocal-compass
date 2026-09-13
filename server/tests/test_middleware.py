"""Request ids, trace correlation, API cache headers, JSON 404s, and the 500 handler."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from support import LOG_PROJECT
from vocal_compass.logs import ERROR_EVENT_TYPE, SPAN_FIELD, TRACE_FIELD
from vocal_compass.middleware import parse_trace

TRACE_ID = "105445aa7843bc8bf206b12000100000"


def test_a_request_id_is_generated(client: TestClient) -> None:
    assert re.fullmatch(r"[0-9a-f]{32}", client.get("/api/health").headers["x-request-id"])


def test_a_sane_inbound_request_id_is_echoed(client: TestClient) -> None:
    response = client.get("/api/health", headers={"X-Request-ID": "lb-7f3a.2:b_9"})
    assert response.headers["x-request-id"] == "lb-7f3a.2:b_9"


@pytest.mark.parametrize("inbound", ["has space", "semi;colon", "<script>", "x" * 129])
def test_an_insane_inbound_request_id_is_replaced(client: TestClient, inbound: str) -> None:
    echoed = client.get("/api/health", headers={"X-Request-ID": inbound}).headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f]{32}", echoed)


@pytest.mark.parametrize("path", ["/api/health", "/api/nope"])
def test_api_responses_are_never_cached(client: TestClient, path: str) -> None:
    assert client.get(path).headers["cache-control"] == "no-store"


@pytest.mark.parametrize(("method", "path"), [("GET", "/api/nope"), ("POST", "/api/nope"), ("GET", "/api"), ("GET", "/somewhere")])
def test_unmatched_paths_are_a_json_404(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path)
    assert response.status_code == 404
    assert response.json() == {"detail": "Not found"}


def test_a_wrong_method_on_a_real_route_is_still_405(client: TestClient) -> None:
    assert client.post("/api/health").status_code == 405


@pytest.mark.parametrize("asynchronous", [False, True])
def test_unhandled_exceptions_become_a_json_500_and_one_error_log(
    make_app: Callable[..., FastAPI], json_logs: Callable[[], list[dict[str, Any]]], asynchronous: bool
) -> None:
    app = make_app()

    def boom() -> None:
        raise RuntimeError("kaboom")

    async def async_boom() -> None:
        raise RuntimeError("kaboom")

    app.add_api_route("/api/boom", async_boom if asynchronous else boom)
    with TestClient(app) as client:
        response = client.get("/api/boom", headers={"X-Request-ID": "req-500"})
    assert response.status_code == 500
    assert response.json() == {"detail": "Something went wrong.", "requestId": "req-500"}
    assert response.headers["x-request-id"] == "req-500"
    assert response.headers["cache-control"] == "no-store"
    errors = [line for line in json_logs() if line["severity"] == "ERROR"]
    assert len(errors) == 1
    assert errors[0]["requestId"] == "req-500"
    assert errors[0]["@type"] == ERROR_EVENT_TYPE
    assert errors[0]["message"].startswith("Unhandled exception serving GET /api/boom\nTraceback")
    assert "RuntimeError: kaboom" in errors[0]["message"]


def test_trace_headers_reach_every_log_line_of_the_request(
    make_app: Callable[..., FastAPI], json_logs: Callable[[], list[dict[str, Any]]]
) -> None:
    app = make_app()

    def noisy() -> dict[str, str]:
        logging.getLogger("vocal_compass.test").info("inside the handler")
        return {}

    app.add_api_route("/api/noisy", noisy)
    with TestClient(app) as client:
        client.get("/api/noisy", headers={"X-Cloud-Trace-Context": f"{TRACE_ID}/1;o=1", "X-Request-ID": "req-t"})
    (line,) = [line for line in json_logs() if line["message"] == "inside the handler"]
    assert line["requestId"] == "req-t"
    assert line[TRACE_FIELD] == f"projects/{LOG_PROJECT}/traces/{TRACE_ID}"
    assert line[SPAN_FIELD] == "0000000000000001"


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({"x-cloud-trace-context": f"{TRACE_ID}/12345678901234567890;o=1"}, (TRACE_ID, "ab54a98ceb1f0ad2")),
        ({"x-cloud-trace-context": TRACE_ID.upper()}, (TRACE_ID, None)),
        ({"x-cloud-trace-context": f"{TRACE_ID}/18446744073709551616"}, (TRACE_ID, None)),
        ({"traceparent": "00-0af7651916cd43dd8448eb211c80319c-B7AD6B7169203331-01"}, ("0af7651916cd43dd8448eb211c80319c", "b7ad6b7169203331")),
        (
            {"x-cloud-trace-context": f"{TRACE_ID}/1", "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"},
            (TRACE_ID, "0000000000000001"),
        ),
        (
            {"x-cloud-trace-context": "not-a-trace", "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"},
            ("0af7651916cd43dd8448eb211c80319c", "b7ad6b7169203331"),
        ),
        ({"x-cloud-trace-context": "0" * 32}, (None, None)),
        ({"traceparent": f"00-{'0' * 32}-b7ad6b7169203331-01"}, (None, None)),
        ({"traceparent": "garbage"}, (None, None)),
        ({}, (None, None)),
    ],
)
def test_parse_trace(headers: dict[str, str], expected: tuple[str | None, str | None]) -> None:
    assert parse_trace(Headers(headers=headers)) == expected
