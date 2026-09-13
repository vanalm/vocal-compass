"""Rate limits for /api: a sliding one-minute window per bucket of routes, counted per client IP or per signed-in user.

Counts live in this process only. Cloud Run may run several instances, so a
client can get up to that many times a bucket's limit, and an instance that
restarts forgets its counts. That is enough for what the limits are for,
blunting floods and runaway clients; exact limits would need a shared store.

A window is estimated from two fixed one-minute counts, the previous one
weighted by how much of it the sliding window still covers, so each active
client costs one small record however many requests it sends.

Every /api request counts against a per-IP bucket, and a route with a
per-user bucket counts against that as well, so a request that never signs
in is still limited.
"""

from __future__ import annotations

import ipaddress
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .api import PREFIX
from .auth.session import current_user
from .logs import event
from .models import User

WINDOW_SECONDS = 60
MAX_KEYS = 100_000
TOO_MANY_REQUESTS = "Too many requests. Try again shortly."


@dataclass(frozen=True, slots=True)
class Bucket:
    """Requests under `prefix` share `limit` per window, per client IP or, with per_user, per signed-in user."""

    name: str
    prefix: str
    limit: int
    per_user: bool = False

    def covers(self, path: str) -> bool:
        return path == self.prefix or path.startswith(f"{self.prefix}/")


# Of the per-IP buckets, and separately the per-user ones, the first that covers a path applies,
# so the catch-all comes last.
BUCKETS = (
    Bucket("auth", f"{PREFIX}/auth", 30),
    Bucket("sync", f"{PREFIX}/sync", 120, per_user=True),
    Bucket("telemetry", f"{PREFIX}/telemetry", 30),
    Bucket("api", PREFIX, 600),
)


def bucket_for(path: str, *, per_user: bool = False) -> Bucket | None:
    """The per-IP bucket, or with per_user the per-user bucket, that `path` counts against."""
    return next((bucket for bucket in BUCKETS if bucket.per_user is per_user and bucket.covers(path)), None)


def client_ip(scope: Scope, trusted_hops: int) -> str:
    """The client's address as the outermost trusted proxy saw it: the `trusted_hops`-th X-Forwarded-For entry from the right.

    Each proxy appends the address it took the request from, so entries left
    of the trusted ones are whatever the client wrote. With no trusted hops, a
    header shorter than that, or an entry that is not an address, it is the
    connection's peer. The header is read here, never through uvicorn's
    --proxy-headers, which under --forwarded-allow-ips=* replaces the peer with
    the header's first, client-written entry: the peer is the client only
    where uvicorn leaves it alone, as its default (trust 127.0.0.1) does.
    """
    entries = ",".join(Headers(scope=scope).getlist("x-forwarded-for")).split(",")
    if 0 < trusted_hops <= len(entries):
        try:
            return str(ipaddress.ip_address(entries[-trusted_hops].strip()))
        except ValueError:
            pass
    client = scope.get("client")
    return str(client[0]) if client else ""


@dataclass(slots=True)
class _Count:
    window: int
    previous: int = 0
    current: int = 0
    reported: bool = False


class RateLimiter:
    """Request counts per (bucket, key), shared by the middleware and limit_per_user, which runs in the threadpool."""

    def __init__(self, clock: Callable[[], float] = time.monotonic, max_keys: int = MAX_KEYS) -> None:
        self._clock = clock
        self._max_keys = max_keys
        self._counts: dict[tuple[str, str], _Count] = {}
        self._window = 0
        self._lock = threading.Lock()

    def check(self, bucket: Bucket, key: str) -> int | None:
        """Count one request by `key` against `bucket`.

        None when it may proceed; otherwise the whole seconds until it would be
        admitted, for Retry-After. Only a key's first refusal in a window logs
        ratelimit.exceeded, so a flood costs a log line a minute rather than one per request.
        """
        window, elapsed = divmod(self._clock(), WINDOW_SECONDS)
        with self._lock:
            count = self._count(bucket.name, key, int(window))
            if count.previous * (1 - elapsed / WINDOW_SECONDS) + count.current < bucket.limit:
                count.current += 1
                return None
            if count.current < bucket.limit:
                # Admitted later in this window, once enough of the previous one has slid out.
                wait = WINDOW_SECONDS * (1 - (bucket.limit - count.current) / count.previous) - elapsed
            else:
                wait = WINDOW_SECONDS - elapsed  # admitted just after the next window starts
            first_refusal, count.reported = not count.reported, True
        if first_refusal:
            event("ratelimit.exceeded", severity=logging.WARNING, bucket=bucket.name)
        return int(wait) + 1

    def _count(self, bucket: str, key: str, window: int) -> _Count:
        if window != self._window:
            # Once a window: forget keys idle since before the previous window, which no longer count.
            self._counts = {held: count for held, count in self._counts.items() if count.window >= window - 1}
            self._window = window
        count = self._counts.get((bucket, key))
        if count is None:
            if len(self._counts) >= self._max_keys:
                self._counts.clear()  # fail open rather than grow without bound under a flood of new keys
            count = self._counts[(bucket, key)] = _Count(window)
        elif count.window != window:
            previous = count.current if count.window == window - 1 else 0
            count.window, count.previous, count.current, count.reported = window, previous, 0, False
        return count


class RateLimitMiddleware:
    """Enforces the per-IP buckets before a request reaches any route.

    A per-user bucket needs the signed-in user, which only the route resolves,
    so routes in one also declare the limit_per_user dependency.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        bucket = bucket_for(scope["path"]) if scope["type"] == "http" else None
        if bucket is not None:
            state = scope["app"].state
            limiter: RateLimiter = state.rate_limiter
            retry_after = limiter.check(bucket, client_ip(scope, state.settings.trusted_proxy_hops))
            if retry_after is not None:
                refusal = JSONResponse({"detail": TOO_MANY_REQUESTS}, status_code=429, headers={"Retry-After": str(retry_after)})
                await refusal(scope, receive, send)
                return
        await self.app(scope, receive, send)


def limit_per_user(request: Request, user: User = Depends(current_user)) -> None:
    """Route dependency: counts the request against its path's per-user bucket for the signed-in user."""
    bucket = bucket_for(request.scope["path"], per_user=True)
    limiter: RateLimiter = request.app.state.rate_limiter
    retry_after = None if bucket is None else limiter.check(bucket, str(user.id))
    if retry_after is not None:
        raise HTTPException(429, TOO_MANY_REQUESTS, headers={"Retry-After": str(retry_after)})
