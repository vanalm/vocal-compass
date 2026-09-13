"""The session cookie, and the dependencies that resolve it to the signed-in User.

The cookie carries only the provider's sealed value, and every request asks
the provider to open it, so the provider stays the authority on whether a
session is still good. A session proves an identity, not an account: the user
row is found by provider user id, so a deleted account, like an email the
allowlist no longer admits, reads as signed out.

What a request decides about the cookie, a renewed value to keep or a dead one
to clear, is noted on the request, and SessionCookieMiddleware writes it onto
whatever response the request ends with, a 422, 429 or 500 included: renewal
can spend the old refresh token, so a response without the new cookie would
sign the browser out.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

import sqlalchemy as sa
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..db import get_session, utcnow
from ..logs import bind_user, event
from ..models import User
from ..settings import Settings
from .providers import IdentityProvider, ProviderUnavailable

SESSION_MAX_AGE = 30 * 24 * 60 * 60
STATE_MAX_AGE = 10 * 60
# Coarse on purpose: stamping every request would turn each read into a write.
LAST_SEEN_RESOLUTION = timedelta(minutes=5)
SIGN_IN_REQUIRED = "Sign in to sync."
_PENDING_COOKIE = "vc_session_cookie"  # the request.state attribute write_session_cookie sets


@dataclass(frozen=True, slots=True)
class Cookie:
    """A cookie's name and lifetime. Always HttpOnly, SameSite=Lax, Path=/ and host-only; Secure over https."""

    name: str
    max_age: int
    secure: bool

    def set(self, response: Response, value: str) -> None:
        response.set_cookie(
            self.name, value, max_age=self.max_age, path="/", secure=self.secure, httponly=True, samesite="lax"
        )

    def clear(self, response: Response) -> None:
        response.delete_cookie(self.name, path="/", secure=self.secure, httponly=True, samesite="lax")

    def header(self, value: str | None) -> str:
        """The Set-Cookie header that stores `value`, or with None clears the cookie."""
        response = Response()
        if value is None:
            self.clear(response)
        else:
            self.set(response, value)
        return response.headers["set-cookie"]


def session_cookie(settings: Settings) -> Cookie:
    # Browsers keep a __Host- cookie only if it is Secure, host-only and Path=/, so no subdomain can plant one.
    return Cookie("__Host-vc_session" if settings.https else "vc_session", SESSION_MAX_AGE, settings.https)


def state_cookie(settings: Settings) -> Cookie:
    return Cookie("vc_oauth_state", STATE_MAX_AGE, settings.https)


def identity_provider(request: Request) -> IdentityProvider:
    provider: IdentityProvider = request.app.state.identity_provider
    return provider


def write_session_cookie(request: Request, sealed: str | None) -> None:
    """Have this request's response, whatever it turns out to be, set the session cookie to `sealed`, or clear it."""
    setattr(request.state, _PENDING_COOKIE, sealed)


class SessionCookieMiddleware:
    """Writes the session cookie a request noted with write_session_cookie onto the request's response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # request.state lives in this dict, which stays shared however the scope is copied further in.
        state = scope.setdefault("state", {})

        async def send_with_cookie(message: Message) -> None:
            if message["type"] == "http.response.start" and _PENDING_COOKIE in state:
                cookie = session_cookie(scope["app"].state.settings)
                MutableHeaders(scope=message).append("set-cookie", cookie.header(state[_PENDING_COOKIE]))
            await send(message)

        await self.app(scope, receive, send_with_cookie)


def optional_user(request: Request, session: Session = Depends(get_session)) -> User | None:
    """The signed-in user, or None. A renewed session is written back to the cookie; one that will never open again is cleared."""
    settings: Settings = request.app.state.settings
    sealed = request.cookies.get(session_cookie(settings).name)
    if not sealed:
        return None
    try:
        loaded = identity_provider(request).load(sealed)
    except ProviderUnavailable:
        return None  # the session may be good: the cookie stays for a later request to try
    if loaded is None:
        event("auth.session_expired")
        write_session_cookie(request, None)
        return None
    identity, refreshed = loaded
    if refreshed is not None:
        write_session_cookie(request, refreshed)
    if not settings.email_allowed(identity.email, verified=identity.email_verified):
        return None
    user = session.scalar(sa.select(User).where(User.workos_user_id == identity.provider_user_id))
    if user is None:
        return None
    bind_user(user.id)
    now = utcnow()
    if now - user.last_seen_at >= LAST_SEEN_RESOLUTION:
        # A statement rather than an attribute change: if the account was just deleted it matches nothing instead of raising.
        session.execute(sa.update(User).where(User.id == user.id).values(last_seen_at=now))
        session.commit()
    return user


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, SIGN_IN_REQUIRED)
    return user
