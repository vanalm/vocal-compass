"""ASGI middleware, the router fallback, and the validation error handler that shape every response.

Described here outermost first; app.py adds them in reverse, since Starlette
runs the last-added middleware outermost. SecurityHeadersMiddleware stamps the
browser-hardening headers on every response, the 500 below included, and
auth.session.SessionCookieMiddleware writes onto it the session cookie the
request's dependencies settled on. RequestContextMiddleware binds the request id and trace ids every log line of
the request carries, stamps the headers the /api contract promises, and turns
an unhandled exception into a JSON 500 plus one ERROR log with the stack.
Handling the exception there, rather than in Starlette's server-error handler,
keeps the request context bound while it is logged and stops the server from
logging the same failure a second time. Inside it, cheap refusals run before
any route: OriginCheckMiddleware, ratelimit.RateLimitMiddleware, then
BodyLimitMiddleware.

Middleware read Settings from app.state on each request, as routes do.
"""

from __future__ import annotations

import logging
import re
import threading
import uuid

from fastapi import HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from starlette.websockets import WebSocketClose

from .api import PREFIX, is_api_path
from .logs import RequestContext, bind_request, unbind_request
from .settings import Settings

logger = logging.getLogger(__name__)

CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
    )
)
STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains"
# Vite's dev server, however the browser addresses it, proxies /api here in development.
DEV_ORIGINS = frozenset({"http://localhost:5199", "http://127.0.0.1:5199"})
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
BODY_LIMIT = 64_000
# Only a sync carries a big body. Parsed, JSON can take ~25 times its size in memory, so the number of
# sync bodies one instance holds at once is bounded too: SYNC_BODY_LIMIT x 25 x SYNC_BODIES_AT_ONCE
# (~200 MB) stays well inside the 1 GiB Terraform gives each instance, with room left for bodies
# still arriving while they wait for a slot.
SYNC_PATH = f"{PREFIX}/sync"
SYNC_BODY_LIMIT = 4_000_000
SYNC_BODIES_AT_ONCE = 2
BODY_TOO_LARGE = "Request body too large."
SERVER_BUSY = "The server is busy. Try again shortly."
CROSS_ORIGIN_REFUSED = "Cross-origin request refused."

_REQUEST_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_CLOUD_TRACE = re.compile(r"([0-9a-f]{32})(?:/([0-9]{1,20}))?(?:;o=[0-9]+)?", re.IGNORECASE)
_TRACEPARENT = re.compile(r"[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}", re.IGNORECASE)


def parse_trace(headers: Headers) -> tuple[str | None, str | None]:
    """(trace id, span id as 16 hex digits) from X-Cloud-Trace-Context, else W3C traceparent.

    Google's header carries the span in decimal; Cloud Logging wants hex. An
    all-zero id is invalid in both formats and is dropped.
    """
    cloud = _CLOUD_TRACE.fullmatch(headers.get("x-cloud-trace-context", "").strip())
    if cloud and int(cloud[1], 16):
        span = int(cloud[2] or 0)
        return cloud[1].lower(), f"{span:016x}" if 0 < span < 2**64 else None
    parent = _TRACEPARENT.fullmatch(headers.get("traceparent", "").strip())
    if parent and int(parent[1], 16):
        return parent[1].lower(), parent[2].lower() if int(parent[2], 16) else None
    return None, None


def security_headers(settings: Settings) -> dict[str, str]:
    headers = {
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "DENY",
        # The app listens to the singer, so its own pages keep the microphone.
        "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
        "Cross-Origin-Opener-Policy": "same-origin",
    }
    if settings.https:
        headers["Strict-Transport-Security"] = STRICT_TRANSPORT_SECURITY
    return headers


def allowed_origins(settings: Settings) -> frozenset[str]:
    return frozenset({settings.origin}) | (DEV_ORIGINS if settings.environment == "development" else frozenset())


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        app = scope["app"]
        stamped = security_headers(app.state.settings)
        if scope["path"] in (app.docs_url, app.redoc_url):
            # FastAPI's API docs, served only locally, run inline scripts from a CDN.
            del stamped["Content-Security-Policy"]

        async def send_stamped(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).update(stamped)
            await send(message)

        await self.app(scope, receive, send_stamped)


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        inbound_id = headers.get("x-request-id", "")
        context = RequestContext(
            inbound_id if _REQUEST_ID.fullmatch(inbound_id) else uuid.uuid4().hex,
            *parse_trace(headers),
        )
        api = is_api_path(scope["path"])
        started = False

        async def send_stamped(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                response_headers = MutableHeaders(scope=message)
                response_headers["X-Request-ID"] = context.request_id
                if api:
                    response_headers["Cache-Control"] = "no-store"
            await send(message)

        token = bind_request(context)
        try:
            await self.app(scope, receive, send_stamped)
        except Exception:
            logger.exception("Unhandled exception serving %s %s", scope["method"], scope["path"])
            if started:
                raise  # too late to answer; let the server close the connection
            response = JSONResponse(
                {"detail": "Something went wrong.", "requestId": context.request_id},
                status_code=500,
            )
            await response(scope, receive, send_stamped)
        finally:
            unbind_request(token)


class OriginCheckMiddleware:
    """Refuses a state-changing /api request that another site's page sent.

    Defense in depth behind the SameSite=Lax session cookie. A request with no
    Origin (curl, a server) passes: browsers send one with every cross-origin
    POST, PUT, PATCH and DELETE.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in UNSAFE_METHODS and is_api_path(scope["path"]):
            origin = Headers(scope=scope).get("origin")
            if origin is not None and origin not in allowed_origins(scope["app"].state.settings):
                logger.warning("Refused a cross-origin %s %s from %.200s", scope["method"], scope["path"], origin)
                await JSONResponse({"detail": CROSS_ORIGIN_REFUSED}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


class BodyTooLarge(HTTPException):
    """Raised by the body stream once it passes its cap; FastAPI re-raises it from a body read as a JSON 413."""

    def __init__(self) -> None:
        super().__init__(413, BODY_TOO_LARGE)


class ServerBusy(HTTPException):
    """Raised by a complete sync body that finds every slot taken; FastAPI re-raises it as a JSON 503."""

    def __init__(self) -> None:
        super().__init__(503, SERVER_BUSY, headers={"Retry-After": "2"})


class BodyLimitMiddleware:
    """Caps request bodies, and how many sync bodies one instance holds at once.

    FastAPI parses a route's JSON body before it resolves dependencies, so a
    body costs its parse even when the request then fails to authenticate.
    /api/sync takes up to SYNC_BODY_LIMIT, every other route BODY_LIMIT; a
    body over its cap is refused before reading when Content-Length says so,
    else cut off mid-stream. A sync body takes one of SYNC_BODIES_AT_ONCE slots
    once it has fully arrived, so a client dribbling one in holds none, and
    keeps it until the response is sent; with every slot taken it gets 503.
    Taking a slot never waits, so a thread semaphore serves any event loop.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._sync_slots = threading.BoundedSemaphore(SYNC_BODIES_AT_ONCE)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        sync = scope["path"] == SYNC_PATH
        limit = SYNC_BODY_LIMIT if sync else BODY_LIMIT
        declared = Headers(scope=scope).get("content-length", "")
        if declared.isascii() and declared.isdigit() and int(declared) > limit:
            await JSONResponse({"detail": BODY_TOO_LARGE}, status_code=413)(scope, receive, send)
            return
        received = 0
        holding = False

        async def receive_limited() -> Message:
            nonlocal received, holding
            message = await receive()
            if message["type"] != "http.request":
                return message
            received += len(message.get("body", b""))
            if received > limit:
                raise BodyTooLarge
            if sync and not holding and not message.get("more_body", False):
                if not self._sync_slots.acquire(blocking=False):
                    raise ServerBusy
                holding = True
            return message

        try:
            await self.app(scope, receive_limited, send)
        finally:
            if holding:
                self._sync_slots.release()


async def not_found(scope: Scope, receive: Receive, send: Send) -> None:
    """The router's fallback for requests no route matched: a JSON 404, never index.html."""
    if scope["type"] == "websocket":
        await WebSocketClose()(scope, receive, send)
        return
    await JSONResponse({"detail": "Not found"}, status_code=404)(scope, receive, send)


async def validation_failed(request: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's 422 without its `input` fields: echoing each invalid value back doubles what a hostile body costs."""
    errors = [{key: value for key, value in error.items() if key != "input"} for error in exc.errors()]
    return JSONResponse({"detail": jsonable_encoder(errors)}, status_code=422)
