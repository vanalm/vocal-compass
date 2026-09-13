"""Sign-in, sign-out, and who is signed in.

The callback turns the provider's code into a session cookie the page's
scripts cannot read. A state cookie ties each callback to the login that
started it in this browser, so a callback link crafted elsewhere cannot sign
someone into an account that is not theirs.
"""

from __future__ import annotations

import hmac
import logging
import re
import secrets
from typing import Annotated, Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..api import PREFIX
from ..db import get_session, utcnow
from ..logs import bind_user, event
from ..models import User
from ..settings import Settings
from .providers import AuthenticationFailed, Identity
from .session import identity_provider, optional_user, session_cookie, state_cookie, write_session_cookie

router = APIRouter(prefix=PREFIX, tags=["auth"])

CALLBACK_PATH = f"{PREFIX}/auth/callback"
SCREEN_HINTS = frozenset({"sign-in", "sign-up"})
# One leading slash, then printable ASCII without space or backslash; 512 characters at most.
_RETURN_TO = re.compile(r"/[!-\[\]-~]{0,511}")


def safe_return_to(value: str | None) -> str:
    """`value` when it is a path on this origin, else "/".

    Browsers read //host and /\\host as other origins and silently drop tabs
    and newlines, so anything but plain printable characters after a single
    leading slash is refused. The leading slash already rules out a scheme.
    """
    return value if value and _RETURN_TO.fullmatch(value) and "//" not in value else "/"


def redirect_uri(settings: Settings) -> str:
    return f"{settings.app_base_url}{CALLBACK_PATH}"


@router.get("/auth/login")
def login(
    request: Request,
    return_to: Annotated[str | None, Query(alias="returnTo")] = None,
    screen_hint: Annotated[str | None, Query(alias="screenHint")] = None,
) -> RedirectResponse:
    settings: Settings = request.app.state.settings
    nonce = secrets.token_urlsafe(32)
    location = identity_provider(request).authorization_url(
        state=nonce,
        redirect_uri=redirect_uri(settings),
        screen_hint=screen_hint if screen_hint in SCREEN_HINTS else None,
    )
    response = RedirectResponse(location, status_code=302)
    # Hex keeps any path cookie-safe; the callback validates it again anyway.
    state_cookie(settings).set(response, f"{nonce}.{safe_return_to(return_to).encode().hex()}")
    return response


@router.get("/auth/callback")
def callback(
    request: Request, code: str = "", state: str = "", session: Session = Depends(get_session)
) -> RedirectResponse:
    settings: Settings = request.app.state.settings
    started = _read_state(request.cookies.get(state_cookie(settings).name))
    if started is None or not hmac.compare_digest(state.encode(), started[0].encode()):
        event("auth.failed", severity=logging.WARNING, reason="state")
        return _back_to_app(settings, "/?auth=failed")
    try:
        identity, sealed = identity_provider(request).authenticate(code, redirect_uri(settings))
    except AuthenticationFailed:
        event("auth.failed", severity=logging.WARNING, reason="exchange")
        return _back_to_app(settings, "/?auth=failed")
    if not settings.email_allowed(identity.email, verified=identity.email_verified):
        return _denied(settings, "allowlist" if identity.email_verified else "unverified_email")
    signed_in = _sign_in(session, identity)
    if signed_in is None:
        return _denied(settings, "unverified_email")
    user, created = signed_in
    bind_user(user.id)
    event("auth.signup" if created else "auth.login")
    write_session_cookie(request, sealed)
    return _back_to_app(settings, started[1])


@router.post("/auth/logout")
def logout(request: Request, user: User | None = Depends(optional_user)) -> dict[str, str | None]:
    sealed = request.cookies.get(session_cookie(request.app.state.settings).name)
    logout_url = identity_provider(request).logout_url(sealed) if sealed else None
    write_session_cookie(request, None)
    if user is not None:
        event("auth.logout")
    return {"logoutUrl": logout_url}


@router.get("/me")
def me(request: Request, user: User | None = Depends(optional_user)) -> dict[str, Any]:
    """Never 401: a signed-out page load asks this too, and should not log an error."""
    account = None if user is None else {"id": str(user.id), "email": user.email, "name": user.name}
    return {"user": account, "authMode": identity_provider(request).mode}


def _read_state(value: str | None) -> tuple[str, str] | None:
    """(nonce, returnTo) from the state cookie, or None when it is missing or malformed."""
    nonce, _, path = (value or "").partition(".")
    try:
        return_to = bytes.fromhex(path).decode()
    except ValueError:
        return None
    return (nonce, safe_return_to(return_to)) if nonce else None


def _back_to_app(settings: Settings, location: str) -> RedirectResponse:
    """A redirect that ends the sign-in attempt: its state cookie is spent either way."""
    response = RedirectResponse(location, status_code=302)
    state_cookie(settings).clear(response)
    return response


def _denied(settings: Settings, reason: str) -> RedirectResponse:
    event("auth.denied", reason=reason)
    return _back_to_app(settings, "/?auth=denied")


def _sign_in(session: Session, identity: Identity) -> tuple[User, bool] | None:
    try:
        return _upsert_user(session, identity)
    except IntegrityError:
        # A concurrent first sign-in by the same person inserted the row first; now it matches.
        session.rollback()
        return _upsert_user(session, identity)


def _upsert_user(session: Session, identity: Identity) -> tuple[User, bool] | None:
    """The account `identity` signs in to, created on first sign-in (True when created); None when it may not claim one.

    Matched by provider user id, else by email. Whoever holds a verified
    address owns the account that uses it: the row is linked to this provider
    id, backfilling a missing one or replacing one whose provider account was
    recreated. An unverified address proves nothing, so it may start an
    account but never claim one. A row found by provider id follows its
    verified address when that changes, unless another account uses it.
    """
    email = identity.email.strip().lower()
    by_id = session.scalar(sa.select(User).where(User.workos_user_id == identity.provider_user_id))
    by_email = session.scalar(sa.select(User).where(User.email == email))
    user = by_id or by_email
    created = user is None
    if user is None:
        user = User(email=email)
        session.add(user)
    elif by_id is None and not identity.email_verified:
        return None
    elif by_email is None and identity.email_verified:
        user.email = email
    user.workos_user_id = identity.provider_user_id
    if identity.name:
        user.name = identity.name
    user.last_seen_at = utcnow()
    session.commit()
    return user, created
