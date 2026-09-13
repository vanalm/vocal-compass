"""WorkOSProvider: each SDK call checked against the installed SDK's real signatures, and no network, ever."""

from __future__ import annotations

import inspect
import json
import socket
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any
from unittest.mock import ANY
from urllib.parse import parse_qs, urlsplit

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jwt.exceptions import PyJWKClientConnectionError
from workos import BadRequestError
from workos._errors import WorkOSConnectionError, WorkOSTimeoutError
from workos.session import (
    AuthenticateWithSessionCookieErrorResponse,
    AuthenticateWithSessionCookieFailureReason,
    AuthenticateWithSessionCookieSuccessResponse,
    RefreshWithSessionCookieErrorResponse,
    RefreshWithSessionCookieSuccessResponse,
    Session,
    seal_session_from_auth_response,
    unseal_data,
)
from workos.user_management._resource import UserManagement
from workos.user_management.models import AuthenticateResponse

from support import FERNET_KEY, make_settings, set_cookies
from vocal_compass.auth import providers
from vocal_compass.auth.providers import (
    AuthenticationFailed,
    DevProvider,
    Identity,
    ProviderUnavailable,
    WorkOSProvider,
    make_provider,
)

Logs = Callable[[], list[dict[str, Any]]]
Reason = AuthenticateWithSessionCookieFailureReason
CALLBACK = "https://vocal.example.com/api/auth/callback"
LOGOUT_URL = "https://api.workos.com/user_management/sessions/logout?session_id=session_01"
WORKOS_SETTINGS = {
    "auth_mode": "workos",
    "workos_client_id": "client_01",
    "workos_api_key": "sk_test_key",
    "workos_cookie_password": FERNET_KEY,
}
USER: dict[str, Any] = {
    "object": "user",
    "id": "user_01",
    "first_name": "Ada",
    "last_name": "Lovelace",
    "profile_picture_url": None,
    "email": "ada@example.com",
    "email_verified": True,
    "external_id": None,
    "last_sign_in_at": None,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
}
ADA = Identity("user_01", "ada@example.com", "Ada Lovelace", True)
LIVE = AuthenticateWithSessionCookieSuccessResponse(authenticated=True, session_id="session_01", user=USER)
EXPIRED = AuthenticateWithSessionCookieErrorResponse(authenticated=False, reason=Reason.INVALID_JWT)


def renewed(user: dict[str, Any] = USER) -> RefreshWithSessionCookieSuccessResponse:
    return RefreshWithSessionCookieSuccessResponse(
        authenticated=True, sealed_session="sealed-2", session_id="session_01", user=user
    )


def refused(reason: Reason | str) -> RefreshWithSessionCookieErrorResponse:
    return RefreshWithSessionCookieErrorResponse(authenticated=False, reason=reason)


def exchanged(**user: Any) -> AuthenticateResponse:
    return AuthenticateResponse.from_dict({"user": {**USER, **user}, "access_token": "access-1", "refresh_token": "refresh-1"})


def conforms(method: Callable[..., Any], **kwargs: Any) -> None:
    """Fail unless the real SDK method accepts exactly these keyword arguments."""
    inspect.signature(method).bind(None, **kwargs)


def outcome(result: Any) -> Any:
    if isinstance(result, Exception):
        raise result
    return result


class FakeSession:
    """Stands in for workos.session.Session, answering with the SDK's own result types, or raising."""

    def __init__(self, checked: Any = LIVE, renewal: Any = None) -> None:
        self.checked = checked
        self.renewal = renewal
        self.refreshes = 0

    def authenticate(self) -> Any:
        conforms(Session.authenticate)
        return outcome(self.checked)

    def refresh(self) -> Any:
        conforms(Session.refresh)
        self.refreshes += 1
        return outcome(self.renewal)

    def get_logout_url(self) -> str:
        conforms(Session.get_logout_url)
        return LOGOUT_URL


class FakeUserManagement:
    """Records each call once it fits the real UserManagement signature, so the fake cannot drift from the SDK."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.exchange: Any = exchanged()
        self.session: Any = FakeSession()

    def get_authorization_url(self, **kwargs: Any) -> str:
        self._record("get_authorization_url", kwargs)
        return f"https://api.workos.com/user_management/authorize?state={kwargs['state']}"

    def authenticate_with_code(self, **kwargs: Any) -> Any:
        self._record("authenticate_with_code", kwargs)
        return outcome(self.exchange)

    def load_sealed_session(self, **kwargs: Any) -> Any:
        self._record("load_sealed_session", kwargs)
        return outcome(self.session)

    def _record(self, name: str, kwargs: dict[str, Any]) -> None:
        conforms(getattr(UserManagement, name), **kwargs)
        self.calls.append((name, kwargs))


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: object, **kwargs: object) -> None:
        raise AssertionError("a WorkOS test tried to open a connection")

    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)


@pytest.fixture
def users() -> FakeUserManagement:
    return FakeUserManagement()


@pytest.fixture
def workos(users: FakeUserManagement) -> WorkOSProvider:
    return WorkOSProvider(SimpleNamespace(user_management=users), FERNET_KEY)  # type: ignore[arg-type]


def warnings(json_logs: Logs) -> list[str]:
    return [line["message"] for line in json_logs() if line["severity"] == "WARNING"]


@pytest.mark.parametrize("hint", ["sign-up", None])
def test_sign_in_goes_to_authkit(workos: WorkOSProvider, users: FakeUserManagement, hint: str | None) -> None:
    url = workos.authorization_url(state="nonce-1", redirect_uri=CALLBACK, screen_hint=hint)
    assert url == "https://api.workos.com/user_management/authorize?state=nonce-1"
    assert users.calls == [
        ("get_authorization_url", {"provider": "authkit", "redirect_uri": CALLBACK, "state": "nonce-1", "screen_hint": hint})
    ]


def test_the_real_sdk_builds_the_authkit_url_without_a_request() -> None:
    provider = make_provider(make_settings(**WORKOS_SETTINGS))
    for hint, extra in (("sign-up", {"screen_hint": ["sign-up"]}), (None, {})):
        url = urlsplit(provider.authorization_url(state="nonce-1", redirect_uri=CALLBACK, screen_hint=hint))
        assert (url.scheme, url.netloc, url.path) == ("https", "api.workos.com", "/user_management/authorize")
        assert parse_qs(url.query) == {
            "provider": ["authkit"],
            "state": ["nonce-1"],
            "redirect_uri": [CALLBACK],
            "client_id": ["client_01"],
            "response_type": ["code"],
            **extra,
        }


def test_workos_mode_builds_an_sdk_client_bounded_within_cloud_runs_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    built: list[dict[str, Any]] = []

    def client(**kwargs: Any) -> SimpleNamespace:
        built.append(kwargs)
        return SimpleNamespace(user_management=None)

    monkeypatch.setattr(providers, "WorkOSClient", client)
    assert isinstance(make_provider(make_settings(**WORKOS_SETTINGS)), WorkOSProvider)
    assert built == [
        {"api_key": "sk_test_key", "client_id": "client_01", "request_timeout": 5, "max_retries": 1}
    ]
    # Two attempts, each with its timeout and up to a second of backoff, well inside a 60 s request.
    assert (providers.WORKOS_TIMEOUT_SECONDS + 1) * (providers.WORKOS_RETRIES + 1) < 60
    assert isinstance(make_provider(make_settings()), DevProvider)


def test_a_code_exchange_seals_what_the_sdk_opens(workos: WorkOSProvider, users: FakeUserManagement) -> None:
    identity, sealed = workos.authenticate("code-1", CALLBACK)
    assert identity == ADA
    assert users.calls == [("authenticate_with_code", {"code": "code-1"})]
    session = unseal_data(sealed, FERNET_KEY)
    assert (session["access_token"], session["refresh_token"], session["user"]["id"]) == ("access-1", "refresh-1", "user_01")


@pytest.mark.parametrize(
    ("fields", "name"),
    [({"name": "Ada King"}, "Ada King"), ({"first_name": None}, "Lovelace"), ({"first_name": None, "last_name": None}, None)],
)
def test_the_name_is_the_full_name_else_first_and_last(
    workos: WorkOSProvider, users: FakeUserManagement, fields: dict[str, Any], name: str | None
) -> None:
    users.exchange = exchanged(**fields)
    assert workos.authenticate("code-1", CALLBACK)[0].name == name


@pytest.mark.parametrize("error", [BadRequestError("invalid_grant"), WorkOSConnectionError(), WorkOSTimeoutError()])
def test_a_failed_exchange_is_an_authentication_failure(
    workos: WorkOSProvider, users: FakeUserManagement, json_logs: Logs, error: Exception
) -> None:
    users.exchange = error
    with pytest.raises(AuthenticationFailed):
        workos.authenticate("code-7f3a9c", CALLBACK)
    assert warnings(json_logs) == [f"WorkOS code exchange failed: {type(error).__name__}"]
    assert "code-7f3a9c" not in json.dumps(json_logs())


@pytest.mark.parametrize("verified", [True, False])
def test_the_identity_says_whether_workos_verified_the_email(
    workos: WorkOSProvider, users: FakeUserManagement, verified: bool
) -> None:
    """Sign-in decides what an unverified address may do (auth/routes.py), so the exchange reports it rather than refusing."""
    users.exchange = exchanged(email_verified=verified)
    assert workos.authenticate("code-1", CALLBACK)[0] == ADA._replace(email_verified=verified)


def test_a_live_session_opens_as_it_is(workos: WorkOSProvider, users: FakeUserManagement) -> None:
    assert workos.load("sealed-1") == (ADA, None)
    assert users.calls == [("load_sealed_session", {"session_data": "sealed-1", "cookie_password": FERNET_KEY})]
    assert users.session.refreshes == 0


def test_an_expired_session_is_renewed_and_resealed(workos: WorkOSProvider, users: FakeUserManagement) -> None:
    users.session = FakeSession(EXPIRED, renewed({**USER, "name": "Ada King"}))
    assert workos.load("sealed-1") == (ADA._replace(name="Ada King"), "sealed-2")


@pytest.mark.parametrize(
    "reason",
    [
        Reason.INVALID_SESSION_COOKIE,
        Reason.REFRESH_DENIED,
        Reason.SSO_REQUIRED,
        # How the SDK reports WorkOS's 400 for a spent or revoked refresh token (APIError.__str__).
        "(message=Refresh token already used, request_id=req_1, error=invalid_grant, error_description=Refresh token already used)",
    ],
)
def test_a_session_workos_will_not_renew_is_over_quietly(
    workos: WorkOSProvider, users: FakeUserManagement, json_logs: Logs, reason: Reason | str
) -> None:
    users.session = FakeSession(EXPIRED, refused(reason))
    assert workos.load("sealed-1") is None
    assert warnings(json_logs) == []


@pytest.mark.parametrize(
    ("session", "warning"),
    [
        (FakeSession(PyJWKClientConnectionError("keys unreachable")), "WorkOS session check failed: PyJWKClientConnectionError"),
        (ValueError("cookie_password is required"), "WorkOS session check failed: ValueError"),
        (FakeSession(EXPIRED, refused(Reason.REFRESH_NETWORK_ERROR)), "WorkOS session refresh failed: refresh_network_error"),
        (FakeSession(EXPIRED, refused(Reason.INVALID_JWT)), "WorkOS session refresh failed: invalid_jwt"),
        (
            FakeSession(EXPIRED, refused("(message=Service Unavailable, request_id=req_1)")),
            "WorkOS session refresh failed: (message=Service Unavailable, request_id=req_1)",
        ),
        (FakeSession(EXPIRED, PyJWKClientConnectionError("keys unreachable")), "WorkOS session check failed: PyJWKClientConnectionError"),
    ],
)
def test_provider_trouble_is_unavailability_with_a_warning(
    workos: WorkOSProvider, users: FakeUserManagement, json_logs: Logs, session: Any, warning: str
) -> None:
    """The session may be fine, so the caller keeps its cookie."""
    users.session = session
    with pytest.raises(ProviderUnavailable):
        workos.load("sealed-1")
    assert warnings(json_logs) == [warning]


def test_a_session_without_a_user_id_and_email_is_over_with_a_warning(
    workos: WorkOSProvider, users: FakeUserManagement, json_logs: Logs
) -> None:
    users.session = FakeSession(
        AuthenticateWithSessionCookieSuccessResponse(authenticated=True, session_id="s", user={"id": "user_01"})
    )
    assert workos.load("sealed-1") is None
    assert warnings(json_logs) == ["WorkOS session holds no user id and email"]


@pytest.mark.parametrize(
    ("session", "url", "refreshes"),
    [
        (FakeSession(), LOGOUT_URL, 0),
        (FakeSession(EXPIRED, renewed()), LOGOUT_URL, 1),
        (FakeSession(EXPIRED, refused(Reason.REFRESH_DENIED)), None, 1),
    ],
)
def test_the_logout_url_ends_a_live_or_renewable_session(
    workos: WorkOSProvider, users: FakeUserManagement, session: FakeSession, url: str | None, refreshes: int
) -> None:
    users.session = session
    assert workos.logout_url("sealed-1") == url
    assert session.refreshes == refreshes


def test_a_logout_url_the_provider_cannot_give_is_a_warning(
    workos: WorkOSProvider, users: FakeUserManagement, json_logs: Logs
) -> None:
    users.session = FakeSession(PyJWKClientConnectionError("keys unreachable"))
    assert workos.logout_url("sealed-1") is None
    assert warnings(json_logs) == ["WorkOS logout URL failed: PyJWKClientConnectionError"]


def test_the_real_sdk_ends_unusable_cookies_without_a_request(json_logs: Logs) -> None:
    """Real Session objects, on cookies that are unreadable or hold neither a usable token nor a refresh token."""
    provider = make_provider(make_settings(**WORKOS_SETTINGS))
    foreign = seal_session_from_auth_response(
        access_token="a", refresh_token="r", user=USER, cookie_password=Fernet.generate_key().decode()
    )
    tokenless = seal_session_from_auth_response(
        access_token="not-a-jwt", refresh_token="", user=USER, cookie_password=FERNET_KEY
    )
    for sealed in ("garbage", foreign, tokenless):
        assert provider.load(sealed) is None
        assert provider.logout_url(sealed) is None
    assert warnings(json_logs) == []


def test_workos_sign_in_runs_through_the_routes(make_app: Callable[..., FastAPI], users: FakeUserManagement) -> None:
    app = make_app(**WORKOS_SETTINGS, app_base_url="https://vocal.example.com")
    app.state.identity_provider = WorkOSProvider(SimpleNamespace(user_management=users), FERNET_KEY)  # type: ignore[arg-type]
    with TestClient(app, base_url="https://vocal.example.com") as browser:
        login = browser.get("/api/auth/login", params={"screenHint": "sign-up"}, follow_redirects=False)
        state = parse_qs(urlsplit(login.headers["location"]).query)["state"][0]
        callback = browser.get("/api/auth/callback", params={"code": "code-1", "state": state}, follow_redirects=False)
        assert callback.headers["location"] == "/"
        # A Fernet token may end in "=", which the cookie carries quoted; Starlette unquotes it on the way back in.
        sealed = set_cookies(callback)["__Host-vc_session"]["value"].strip('"')
        assert unseal_data(sealed, FERNET_KEY)["refresh_token"] == "refresh-1"
        assert browser.get("/api/me").json() == {
            "user": {"id": ANY, "email": "ada@example.com", "name": "Ada Lovelace"},
            "authMode": "workos",
        }
        assert browser.post("/api/auth/logout").json() == {"logoutUrl": LOGOUT_URL}
    assert users.calls[-1] == ("load_sealed_session", {"session_data": sealed, "cookie_password": FERNET_KEY})
