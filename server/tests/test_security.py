"""Security middleware: hardening headers on every response, the unsafe-method Origin check, and the body limits."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from support import events, item, sample
from vocal_compass import middleware
from vocal_compass.api import sync as sync_api
from vocal_compass.middleware import BODY_LIMIT, SYNC_BODY_LIMIT

Logs = Callable[[], list[dict[str, Any]]]

# The spec's policy, verbatim.
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; "
    "frame-ancestors 'none'; form-action 'self'"
)
HARDENING = {
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "microphone=(self), camera=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
    "strict-transport-security": None,
}
TOO_LARGE = (413, {"detail": "Request body too large."})
JSON = {"Content-Type": "application/json"}


def hardening(response: httpx2.Response) -> dict[str, str | None]:
    return {name: response.headers.get(name) for name in HARDENING}


@pytest.fixture
def spa_client(make_app: Callable[..., FastAPI], spa_dist: Path) -> Iterator[TestClient]:
    app = make_app(spa_dist_dir=spa_dist)

    def boom() -> None:
        raise RuntimeError("kaboom")

    app.add_api_route("/api/boom", boom)
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize(
    ("method", "path", "headers", "content", "status"),
    [
        ("GET", "/api/health", {}, None, 200),
        ("GET", "/range", {}, None, 200),
        ("GET", "/assets/index-3f2a9c1b.js", {}, None, 200),
        ("GET", "/api/nope", {}, None, 404),
        ("POST", "/api/sync", {}, None, 401),
        ("GET", "/api/boom", {}, None, 500),
        ("POST", "/api/sync", {"Origin": "https://evil.example"}, None, 403),
        ("POST", "/api/telemetry/errors", JSON, b"x" * (BODY_LIMIT + 1), 413),
    ],
)
def test_every_response_carries_the_hardening_headers(
    spa_client: TestClient, method: str, path: str, headers: dict[str, str], content: bytes | None, status: int
) -> None:
    response = spa_client.request(method, path, headers=headers, content=content)
    assert response.status_code == status
    assert hardening(response) == HARDENING


def test_hsts_is_sent_only_when_the_app_is_served_over_https(make_app: Callable[..., FastAPI]) -> None:
    with TestClient(make_app(app_base_url="https://vocal.example.com"), base_url="https://testserver") as client:
        response = client.get("/api/health")
    assert hardening(response) == {**HARDENING, "strict-transport-security": "max-age=63072000; includeSubDomains"}


def test_the_local_api_docs_alone_go_without_the_csp(client: TestClient) -> None:
    """Swagger UI and ReDoc run inline scripts from a CDN, and are served only in development and test."""
    for path in ("/docs", "/redoc"):
        assert hardening(client.get(path)) == {**HARDENING, "content-security-policy": None}
    assert client.get("/openapi.json").headers["content-security-policy"] == CSP


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize(
    "origin", ["https://evil.example", "null", "http://localhost:5199.evil.example", "https://localhost:5199"]
)
def test_unsafe_api_requests_from_another_origin_are_refused(
    client: TestClient, json_logs: Logs, method: str, origin: str
) -> None:
    response = client.request(method, "/api/account", headers={"Origin": origin})
    assert (response.status_code, response.json()) == (403, {"detail": "Cross-origin request refused."})
    assert response.headers["cache-control"] == "no-store"
    warnings = [line["message"] for line in json_logs() if line["severity"] == "WARNING"]
    assert warnings == [f"Refused a cross-origin {method} /api/account from {origin}"]


@pytest.mark.parametrize("headers", [{}, {"Origin": "http://localhost:5199"}])
def test_same_origin_and_originless_requests_pass(client: TestClient, headers: dict[str, str]) -> None:
    assert client.post("/api/auth/logout", headers=headers).status_code == 200


def test_safe_methods_and_pages_are_not_origin_checked(client: TestClient) -> None:
    assert client.get("/api/me", headers={"Origin": "https://evil.example"}).status_code == 200
    assert client.post("/range", headers={"Origin": "https://evil.example"}).status_code == 404


@pytest.mark.parametrize(("environment", "allowed"), [("development", True), ("test", False)])
@pytest.mark.parametrize("origin", ["http://localhost:5199", "http://127.0.0.1:5199"])
def test_the_vite_dev_server_origins_are_accepted_only_in_development(
    make_app: Callable[..., FastAPI], environment: str, allowed: bool, origin: str
) -> None:
    with TestClient(make_app(environment=environment, app_base_url="https://vocal.example.com")) as client:
        assert client.post("/api/auth/logout", headers={"Origin": origin}).status_code == (200 if allowed else 403)
        assert client.post("/api/auth/logout", headers={"Origin": "https://vocal.example.com"}).status_code == 200


def test_a_declared_body_over_the_limit_is_refused_unread(make_app: Callable[..., FastAPI]) -> None:
    """Refused on Content-Length alone, so even a route that never reads its body does not run."""
    app = make_app()
    ran: list[int] = []
    app.add_api_route("/api/unread", lambda: ran.append(1), methods=["POST"])
    with TestClient(app) as client:
        response = client.post("/api/unread", content=b"x" * (BODY_LIMIT + 1))
        assert client.post("/api/unread", content=b"x" * BODY_LIMIT).status_code == 200
    assert (response.status_code, response.json()) == TOO_LARGE
    assert ran == [1]


@pytest.mark.parametrize(("size", "status"), [(BODY_LIMIT, 204), (BODY_LIMIT + 1, 413)])
def test_an_error_report_may_fill_the_limit_but_not_pass_it(client: TestClient, size: int, status: int) -> None:
    """Refused before FastAPI parses it, and so before the route clips its fields."""
    report = json.dumps({"message": "boom"}).encode()
    body = report[:-1] + b" " * (size - len(report)) + b"}"
    assert client.post("/api/telemetry/errors", content=body, headers=JSON).status_code == status


def test_a_streamed_body_is_cut_off_once_it_passes_the_limit(client: TestClient, json_logs: Logs) -> None:
    """A chunked body declares no length, so only counting the stream can catch it."""
    chunks = [b'{"message": "', b"x" * (BODY_LIMIT // 2), b"x" * (BODY_LIMIT // 2), b'"}']
    response = client.post("/api/telemetry/errors", content=iter(chunks), headers=JSON)
    assert "content-length" not in response.request.headers
    assert (response.status_code, response.json()) == TOO_LARGE
    assert response.headers["x-request-id"] and response.headers["x-content-type-options"] == "nosniff"
    assert events(json_logs(), "client.error") == []


def test_a_sync_body_has_a_limit_of_its_own(client: TestClient) -> None:
    """Signed out, so a body within the limit is read and parsed, then refused as 401."""
    batch = [item("session", sample("session", f"s{number}", note="n" * 1000)) for number in range(100)]
    body = json.dumps({"cursor": 0, "records": batch})
    assert len(body) > BODY_LIMIT
    assert client.post("/api/sync", content=body, headers=JSON).status_code == 401
    declared = client.post("/api/sync", content=b"x" * (SYNC_BODY_LIMIT + 1), headers=JSON)
    streamed = client.post("/api/sync", content=iter([b"x" * SYNC_BODY_LIMIT, b"x"]), headers=JSON)
    assert [(response.status_code, response.json()) for response in (declared, streamed)] == [TOO_LARGE] * 2


def test_a_422_does_not_echo_what_was_sent(signed_in: Callable[[str], TestClient]) -> None:
    """FastAPI's own 422 would copy every invalid value back out, doubling what a hostile body costs."""
    response = signed_in("singer@example.com").post("/api/sync", json={"cursor": 0, "tombstones": ["7f3a9c"] * 501})
    assert response.status_code == 422
    assert "7f3a9c" not in response.text
    assert [error["loc"] for error in response.json()["detail"]] == [["body", "tombstones"]]


def test_sync_bodies_beyond_the_slots_get_503_until_one_frees(
    signed_in: Callable[[str], TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(middleware, "SYNC_BODIES_AT_ONCE", 1)  # read when the app handles its first request
    phone, laptop = signed_in("singer@example.com"), signed_in("singer@example.com")
    entered, release = threading.Event(), threading.Event()
    apply_push = sync_api._apply_push

    def held(*args: Any) -> int:
        entered.set()
        assert release.wait(10)
        return apply_push(*args)

    monkeypatch.setattr(sync_api, "_apply_push", held)
    with ThreadPoolExecutor(1) as pool:
        first = pool.submit(phone.post, "/api/sync", json={"cursor": 0})
        assert entered.wait(10)
        busy = laptop.post("/api/sync", json={"cursor": 0})
        release.set()
        assert first.result().status_code == 200
    assert (busy.status_code, busy.json(), busy.headers["retry-after"]) == (
        503,
        {"detail": "The server is busy. Try again shortly."},
        "2",
    )
    assert laptop.post("/api/sync", json={"cursor": 0}).status_code == 200
