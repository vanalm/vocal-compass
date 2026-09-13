"""Identity providers: who signed in, and the sealed value the session cookie carries to prove it.

The server never handles a password, and the browser never holds a token. A
provider turns an authorization code into an Identity plus an opaque sealed
value, and later opens that value again, refreshing it when it has aged.
AUTH_MODE selects the provider in make_provider, the one place providers are
wired in.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from collections.abc import Mapping
from typing import Any, NamedTuple, Protocol
from urllib.parse import urlencode, urlsplit

from workos import WorkOSClient, WorkOSError
from workos.session import (
    AuthenticateWithSessionCookieFailureReason,
    AuthenticateWithSessionCookieSuccessResponse,
    RefreshWithSessionCookieSuccessResponse,
    seal_session_from_auth_response,
)

from ..settings import Settings

logger = logging.getLogger(__name__)

# The SDK's defaults (a 60 s timeout, retried three times with backoff) would outlast
# Cloud Run's 60 s request timeout while WorkOS is unreachable.
WORKOS_TIMEOUT_SECONDS = 5
WORKOS_RETRIES = 1
# Renewal failures that say nothing about the session itself, so it is kept for a later request to renew.
# Every other reason the SDK names ends the session.
_TRANSIENT = frozenset(
    {
        AuthenticateWithSessionCookieFailureReason.REFRESH_NETWORK_ERROR,
        # The renewed access token did not verify, which includes failing to fetch the signing keys.
        AuthenticateWithSessionCookieFailureReason.INVALID_JWT,
    }
)


class Identity(NamedTuple):
    provider_user_id: str
    email: str
    name: str | None
    email_verified: bool


class AuthenticationFailed(Exception):
    """The provider would not exchange the authorization code for an identity."""


class ProviderUnavailable(Exception):
    """The provider could not be asked whether a session is good, so it may well be."""


class IdentityProvider(Protocol):
    mode: str  # reported to the client as authMode

    def authorization_url(self, *, state: str, redirect_uri: str, screen_hint: str | None) -> str:
        """Where the browser signs in; the provider then sends it to redirect_uri with `code` and `state`."""

    def authenticate(self, code: str, redirect_uri: str) -> tuple[Identity, str]:
        """The identity a code proves, and the sealed session value. Raises AuthenticationFailed."""

    def load(self, sealed: str) -> tuple[Identity, str | None] | None:
        """The identity a sealed value proves, plus a refreshed value when it had to be renewed.

        None means the value will never open again: tampered, or expired past
        renewal. Raises ProviderUnavailable, and nothing else, when the provider
        cannot be asked, so a bad cookie is never a 500.
        """

    def logout_url(self, sealed: str) -> str | None:
        """Where the browser goes to end the provider's own session, if it keeps one."""


DEV_CODE = "dev"
DEV_IDENTITY = Identity("dev-user", "dev@localhost", "Dev Singer", True)


class DevProvider:
    """One fixed local user and no network, for development and tests (Settings refuses it anywhere else).

    The sealed value is the identity as JSON, signed with HMAC-SHA256 under
    SESSION_SECRET, so an edited cookie is simply signed out.
    """

    mode = "dev"

    def __init__(self, secret: str) -> None:
        self._key = secret.encode()

    def authorization_url(self, *, state: str, redirect_uri: str, screen_hint: str | None) -> str:
        # A same-origin path rather than redirect_uri itself, so it also works through the Vite dev proxy.
        return f"{urlsplit(redirect_uri).path}?{urlencode({'code': DEV_CODE, 'state': state})}"

    def authenticate(self, code: str, redirect_uri: str) -> tuple[Identity, str]:
        if code != DEV_CODE:
            raise AuthenticationFailed("dev sign-in accepts only its own code")
        return DEV_IDENTITY, self.seal(DEV_IDENTITY)

    def seal(self, identity: Identity) -> str:
        body = _encode(json.dumps(identity._asdict(), separators=(",", ":")).encode())
        return f"{body}.{self._sign(body)}"

    def load(self, sealed: str) -> tuple[Identity, str | None] | None:
        body, _, signature = sealed.partition(".")
        if not hmac.compare_digest(signature.encode(), self._sign(body).encode()):
            return None
        try:
            return Identity(**json.loads(_decode(body))), None
        except (ValueError, TypeError):
            return None

    def logout_url(self, sealed: str) -> str | None:
        return None

    def _sign(self, body: str) -> str:
        return _encode(hmac.new(self._key, body.encode(), hashlib.sha256).digest())


class WorkOSProvider:
    """WorkOS AuthKit: hosted sign-in, and a session sealed from its access and refresh tokens.

    Written against the installed workos 10.3.0; the file:line comments cite
    the SDK source each call was checked against. The sealed value is Fernet-
    encrypted under WORKOS_COOKIE_PASSWORD, so only this server can open or
    forge one. Opening it verifies the access token against WorkOS's signing
    keys (fetched once, then cached) and renews an expired token with the
    refresh token, a request to WorkOS. A session WorkOS will not renew is
    over. If WorkOS cannot be asked, a WARNING is logged and the provider is
    unavailable: a WorkOS outage must neither turn a page load into a 500 nor
    end anyone's session.
    """

    mode = "workos"

    def __init__(self, client: WorkOSClient, cookie_password: str) -> None:
        self._users = client.user_management
        self._cookie_password = cookie_password

    def authorization_url(self, *, state: str, redirect_uri: str, screen_hint: str | None) -> str:
        # user_management/_resource.py:557 builds the URL locally and leaves out a None screen_hint.
        return self._users.get_authorization_url(
            provider="authkit", redirect_uri=redirect_uri, state=state, screen_hint=screen_hint
        )

    def authenticate(self, code: str, redirect_uri: str) -> tuple[Identity, str]:
        # user_management/_resource.py:222: WorkOS's code exchange takes no redirect_uri.
        try:
            response = self._users.authenticate_with_code(code=code)
        except WorkOSError as exc:
            logger.warning("WorkOS code exchange failed: %s", type(exc).__name__)
            raise AuthenticationFailed("WorkOS did not exchange the code") from None
        user = response.user.to_dict()
        identity = _identity(user)
        if identity is None:
            raise AuthenticationFailed("WorkOS returned no user id and email")
        # This SDK's exchange has no seal option; session.py:200 seals exactly what Session.authenticate unseals.
        sealed = seal_session_from_auth_response(
            access_token=response.access_token,
            refresh_token=response.refresh_token,
            user=user,
            cookie_password=self._cookie_password,
        )
        return identity, sealed

    def load(self, sealed: str) -> tuple[Identity, str | None] | None:
        try:
            # user_management/_resource.py:2569 wraps the value in a session.py:235 Session.
            session = self._users.load_sealed_session(session_data=sealed, cookie_password=self._cookie_password)
            # session.py:257 unseals and verifies locally, fetching signing keys on a cold cache.
            checked = session.authenticate()
            if isinstance(checked, AuthenticateWithSessionCookieSuccessResponse):
                return _opened(checked.user, None)
            # session.py:312 renews through WorkOS and returns the new value as sealed_session.
            renewed = session.refresh()
        except Exception as exc:  # beyond WorkOSError the SDK lets through, e.g., PyJWKClientError from a key fetch
            logger.warning("WorkOS session check failed: %s", type(exc).__name__)
            raise ProviderUnavailable from None
        if isinstance(renewed, RefreshWithSessionCookieSuccessResponse):
            return _opened(renewed.user, renewed.sealed_session)
        # Failures the SDK knows arrive as a reason; the rest as the error's text (session.py:98).
        reason = renewed.reason
        if isinstance(reason, AuthenticateWithSessionCookieFailureReason):
            if reason not in _TRANSIENT:
                return None
            reason = reason.value
        elif "invalid_grant" in reason:
            return None  # WorkOS's answer to a spent or revoked refresh token
        logger.warning("WorkOS session refresh failed: %.300s", reason)
        raise ProviderUnavailable

    def logout_url(self, sealed: str) -> str | None:
        try:
            session = self._users.load_sealed_session(session_data=sealed, cookie_password=self._cookie_password)
            # session.py:419 reads the session id from a live access token, so an expired one is renewed
            # first; refresh() re-seals the Session in place (session.py:398).
            if not session.authenticate().authenticated and not session.refresh().authenticated:
                return None
            return session.get_logout_url()
        except Exception as exc:
            logger.warning("WorkOS logout URL failed: %s", type(exc).__name__)
            return None


def make_provider(settings: Settings) -> IdentityProvider:
    """The identity provider AUTH_MODE names."""
    if settings.auth_mode == "dev":
        return DevProvider(settings.session_secret.get_secret_value())
    client = WorkOSClient(
        api_key=settings.workos_api_key.get_secret_value(),
        client_id=settings.workos_client_id,
        request_timeout=WORKOS_TIMEOUT_SECONDS,
        max_retries=WORKOS_RETRIES,
    )
    return WorkOSProvider(client, settings.workos_cookie_password.get_secret_value())


def _identity(user: Mapping[str, Any]) -> Identity | None:
    """An Identity from a WorkOS user object (User.to_dict, or the JSON a refresh returns); None without id and email."""
    user_id, email = user.get("id"), user.get("email")
    if not (isinstance(user_id, str) and user_id and isinstance(email, str) and email):
        return None
    name = user.get("name") or " ".join(part for part in (user.get("first_name"), user.get("last_name")) if part)
    return Identity(user_id, email, name or None, user.get("email_verified") is True)


def _opened(user: Mapping[str, Any] | None, refreshed: str | None) -> tuple[Identity, str | None] | None:
    identity = _identity(user or {})
    if identity is None:
        logger.warning("WorkOS session holds no user id and email")
        return None
    return identity, refreshed


def _encode(data: bytes) -> str:
    # Unpadded base64url is cookie-safe, so the value is never quoted.
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
