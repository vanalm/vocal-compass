"""Rate limits: the sliding-window estimate, bucket and client matching, and 429s from the middleware and the per-user dependency."""

from __future__ import annotations

import json
import random
from collections.abc import Callable
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from support import FakeProvider, events, set_cookies
from vocal_compass.auth.providers import Identity
from vocal_compass.ratelimit import BUCKETS, Bucket, RateLimiter, bucket_for, client_ip

Logs = Callable[[], list[dict[str, Any]]]
SignIn = Callable[[str], TestClient]
THREE = Bucket("three", "/api/three", 3)
REFUSED = {"detail": "Too many requests. Try again shortly."}


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def limiter(clock: Clock) -> RateLimiter:
    return RateLimiter(clock)


@pytest.fixture
def frozen(app: FastAPI, clock: Clock) -> Clock:
    """Gives the app a limiter on a clock that stands still, so every request of a test lands in one window."""
    app.state.rate_limiter = RateLimiter(clock)
    return clock


def test_the_bucket_table() -> None:
    assert [(bucket.name, bucket.prefix, bucket.limit, bucket.per_user) for bucket in BUCKETS] == [
        ("auth", "/api/auth", 30, False),
        ("sync", "/api/sync", 120, True),
        ("telemetry", "/api/telemetry", 30, False),
        ("api", "/api", 600, False),
    ]


@pytest.mark.parametrize(
    ("path", "per_ip", "per_user"),
    [
        ("/api/auth/login", "auth", None),
        ("/api/auth/callback", "auth", None),
        ("/api/authority", "api", None),
        ("/api/sync", "api", "sync"),
        ("/api/synced", "api", None),
        ("/api/telemetry/errors", "telemetry", None),
        ("/api/me", "api", None),
        ("/api", "api", None),
        ("/range", None, None),
        ("/apis", None, None),
    ],
)
def test_a_path_counts_against_the_first_bucket_of_each_kind_covering_it(
    path: str, per_ip: str | None, per_user: str | None
) -> None:
    assert [getattr(bucket_for(path, per_user=flag), "name", None) for flag in (False, True)] == [per_ip, per_user]


PEER = ("192.0.2.1", 50000)


@pytest.mark.parametrize(
    ("forwarded", "hops", "client"),
    [
        (None, 0, "192.0.2.1"),
        ("203.0.113.7", 0, "192.0.2.1"),  # no proxy is trusted, so the header is the client's own writing
        ("203.0.113.7", 1, "203.0.113.7"),
        ("198.51.100.9, 203.0.113.7", 1, "203.0.113.7"),  # whatever the client wrote comes first
        ("198.51.100.9, 203.0.113.7, 10.0.0.1", 2, "203.0.113.7"),
        (" 2001:DB8::1 ,10.0.0.1", 2, "2001:db8::1"),
        ("10.0.0.1", 2, "192.0.2.1"),  # shorter than the trusted hops
        ("198.51.100.9, not-an-ip", 1, "192.0.2.1"),
        ("", 1, "192.0.2.1"),
        (None, 1, "192.0.2.1"),
    ],
)
def test_the_client_is_the_trusted_forwarded_entry_else_the_peer(forwarded: str | None, hops: int, client: str) -> None:
    headers = [] if forwarded is None else [(b"x-forwarded-for", forwarded.encode())]
    assert client_ip({"type": "http", "headers": headers, "client": PEER}, hops) == client


def test_repeated_forwarded_headers_read_as_one_list() -> None:
    headers = [(b"x-forwarded-for", b"198.51.100.9"), (b"x-forwarded-for", b"203.0.113.7, 10.0.0.1")]
    assert client_ip({"type": "http", "headers": headers, "client": PEER}, 2) == "203.0.113.7"


def test_a_bucket_admits_its_limit_then_waits_for_the_window_to_slide(clock: Clock, limiter: RateLimiter) -> None:
    assert [limiter.check(THREE, "a") for _ in range(3)] == [None, None, None]
    assert limiter.check(THREE, "a") == 61  # all three are this window's: admitted only once the next begins
    clock.now = 59.0
    assert limiter.check(THREE, "a") == 2
    clock.now = 60.5  # the previous window's three now weigh 2.975
    assert limiter.check(THREE, "a") is None
    assert limiter.check(THREE, "a") == 20  # 2.975 + 1: wait until a third of the old window has slid out
    clock.now = 80.5
    assert limiter.check(THREE, "a") is None


def test_retry_after_is_exactly_as_long_as_needed(clock: Clock, limiter: RateLimiter) -> None:
    """A second sooner is still refused; at Retry-After the request is admitted."""
    rng = random.Random(7)
    refusals = 0
    for _ in range(5000):
        clock.now += rng.uniform(0, 4)
        retry_after = limiter.check(THREE, "a")
        if retry_after is None:
            continue
        refusals += 1
        clock.now += retry_after - 1
        assert limiter.check(THREE, "a") is not None
        clock.now += 1
        assert limiter.check(THREE, "a") is None
    assert refusals > 500


def test_keys_and_buckets_are_counted_apart(limiter: RateLimiter) -> None:
    for _ in range(3):
        limiter.check(THREE, "a")
    assert limiter.check(THREE, "a") is not None
    assert limiter.check(THREE, "b") is None
    assert limiter.check(Bucket("other", "/api/other", 3), "a") is None


def test_only_a_keys_first_refusal_in_a_window_is_logged(clock: Clock, limiter: RateLimiter, json_logs: Logs) -> None:
    for _ in range(10):
        limiter.check(THREE, "203.0.113.7")
    clock.now = 60.0
    for _ in range(10):
        limiter.check(THREE, "203.0.113.7")
    lines = events(json_logs(), "ratelimit.exceeded")
    assert [(line["severity"], line["bucket"]) for line in lines] == [("WARNING", "three")] * 2
    assert "203.0.113.7" not in json.dumps(json_logs())


def test_keys_idle_for_a_window_are_swept_before_the_table_fills(clock: Clock) -> None:
    one = Bucket("one", "/api/one", 1)
    limiter = RateLimiter(clock, max_keys=3)
    limiter.check(one, "idle-1")
    limiter.check(one, "idle-2")
    clock.now = 130.0
    assert limiter.check(one, "active") is None
    assert limiter.check(one, "new") is None  # unswept, the table would be full here and forget "active"
    assert limiter.check(one, "active") is not None


def test_a_full_table_fails_open(clock: Clock) -> None:
    one = Bucket("one", "/api/one", 1)
    limiter = RateLimiter(clock, max_keys=2)
    limiter.check(one, "a")
    assert limiter.check(one, "a") is not None
    limiter.check(one, "b")
    assert limiter.check(one, "c") is None  # no room: every count is dropped rather than the table growing
    assert limiter.check(one, "a") is None


@pytest.mark.parametrize(
    ("method", "path", "bucket", "limit"),
    [
        ("GET", "/api/auth/login", "auth", 30),
        ("POST", "/api/telemetry/errors", "telemetry", 30),
        ("GET", "/api/health", "api", 600),
    ],
)
def test_per_ip_buckets_answer_429_with_retry_after(
    client: TestClient, frozen: Clock, json_logs: Logs, method: str, path: str, bucket: str, limit: int
) -> None:
    body = {"message": "boom"} if method == "POST" else None
    statuses = {client.request(method, path, json=body, follow_redirects=False).status_code for _ in range(limit)}
    assert 429 not in statuses
    refused = client.request(method, path, json=body, follow_redirects=False)
    assert (refused.status_code, refused.json(), refused.headers["retry-after"]) == (429, REFUSED, "61")
    assert refused.headers["cache-control"] == "no-store" and refused.headers["x-frame-options"] == "DENY"
    (exceeded,) = events(json_logs(), "ratelimit.exceeded")
    assert exceeded["bucket"] == bucket


def test_per_ip_counts_follow_the_trusted_entry_whatever_the_client_writes(
    make_app: Callable[..., FastAPI], clock: Clock
) -> None:
    app = make_app(trusted_proxy_hops=2)
    app.state.rate_limiter = RateLimiter(clock)
    client = TestClient(app)

    def login(forwarded: str) -> int:
        return client.get("/api/auth/login", headers={"X-Forwarded-For": forwarded}, follow_redirects=False).status_code

    assert {login(f"198.51.100.{number}, 203.0.113.7, 10.0.0.1") for number in range(30)} == {302}
    assert login("198.51.100.99, 203.0.113.7, 10.0.0.1") == 429
    assert login("203.0.113.8, 10.0.0.1") == 302  # another client behind the same proxies
    assert client.get("/api/me", headers={"X-Forwarded-For": "203.0.113.7, 10.0.0.1"}).status_code == 200  # another bucket


def test_signed_out_syncs_count_against_the_per_ip_catch_all(client: TestClient, frozen: Clock, json_logs: Logs) -> None:
    assert {client.post("/api/sync", json={"cursor": 0}).status_code for _ in range(600)} == {401}
    refused = client.post("/api/sync", json={"cursor": 0})
    assert (refused.status_code, refused.json(), refused.headers["retry-after"]) == (429, REFUSED, "61")
    assert client.get("/api/me").status_code == 429
    (exceeded,) = events(json_logs(), "ratelimit.exceeded")
    assert exceeded["bucket"] == "api"


def test_sync_is_limited_per_user_across_devices(signed_in: SignIn, frozen: Clock, json_logs: Logs) -> None:
    phone, laptop, other = signed_in("singer@example.com"), signed_in("singer@example.com"), signed_in("other@example.com")
    for index in range(120):
        assert (phone if index % 2 else laptop).post("/api/sync", json={"cursor": 0}).status_code == 200
    refused = phone.post("/api/sync", json={"cursor": 0})
    assert (refused.status_code, refused.json(), refused.headers["retry-after"]) == (429, REFUSED, "61")
    assert laptop.post("/api/sync", json={"cursor": 0}).status_code == 429
    assert other.post("/api/sync", json={"cursor": 0}).status_code == 200
    (exceeded,) = events(json_logs(), "ratelimit.exceeded")
    assert (exceeded["bucket"], exceeded["userId"]) == ("sync", phone.get("/api/me").json()["user"]["id"])


def test_a_refused_sync_keeps_the_session_it_just_refreshed(
    signed_in: SignIn, provider: FakeProvider, frozen: Clock
) -> None:
    device = signed_in("singer@example.com")
    for _ in range(120):
        device.post("/api/sync", json={"cursor": 0})
    provider.refresh = True
    refused = device.post("/api/sync", json={"cursor": 0})
    assert refused.status_code == 429
    refreshed = provider.seal(Identity("user_singer@example.com", "singer@example.com", "Refreshed", True))
    assert set_cookies(refused)["vc_session"]["value"] == refreshed
