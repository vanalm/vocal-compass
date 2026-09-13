"""Signing in and out: the round trip, state and returnTo defences, cookies, the allowlist, identity linking, refresh."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
import sqlalchemy as sa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from support import CLIENT_LOGGER, FakeProvider, events, set_cookies, sign_in
from vocal_compass.auth.providers import DEV_IDENTITY, AuthenticationFailed, DevProvider, Identity
from vocal_compass.auth.routes import safe_return_to
from vocal_compass.auth.session import LAST_SEEN_RESOLUTION, SESSION_MAX_AGE, STATE_MAX_AGE, optional_user
from vocal_compass.db import utcnow
from vocal_compass.models import User

Logs = Callable[[], list[dict[str, Any]]]
SignIn = Callable[[str], TestClient]
SIGNED_OUT = {"user": None, "authMode": "dev"}
CALLBACK = "http://localhost:5199/api/auth/callback"


def test_dev_sign_in_round_trip(client: TestClient) -> None:
    assert client.get("/api/me").json() == SIGNED_OUT

    login = client.get("/api/auth/login", params={"returnTo": "/range?tab=turns"}, follow_redirects=False)
    assert login.status_code == 302
    location = urlsplit(login.headers["location"])
    query = parse_qs(location.query)
    assert (location.path, query["code"]) == ("/api/auth/callback", ["dev"])
    state = set_cookies(login)["vc_oauth_state"]
    assert state["value"].startswith(f"{query['state'][0]}.")
    assert (state["max-age"], state["path"], state["samesite"]) == (str(STATE_MAX_AGE), "/", "lax")
    assert "httponly" in state and "secure" not in state

    callback = client.get(login.headers["location"], follow_redirects=False)
    assert (callback.status_code, callback.headers["location"]) == (302, "/range?tab=turns")
    cookies = set_cookies(callback)
    assert cookies["vc_oauth_state"]["max-age"] == "0"
    session = cookies["vc_session"]
    assert (session["max-age"], session["path"], session["samesite"]) == (str(SESSION_MAX_AGE), "/", "lax")
    assert "httponly" in session and "secure" not in session and "domain" not in session

    me = client.get("/api/me").json()
    assert me["authMode"] == "dev"
    assert (me["user"]["email"], me["user"]["name"]) == (DEV_IDENTITY.email, DEV_IDENTITY.name)
    assert uuid.UUID(me["user"]["id"])


def test_https_deployments_use_secure_host_prefixed_cookies(make_app: Callable[..., FastAPI]) -> None:
    with TestClient(make_app(app_base_url="https://vocal.example.com"), base_url="https://testserver") as client:
        login = client.get("/api/auth/login", follow_redirects=False)
        assert "secure" in set_cookies(login)["vc_oauth_state"]
        cookies = set_cookies(client.get(login.headers["location"], follow_redirects=False))
        session = cookies["__Host-vc_session"]
        assert "vc_session" not in cookies
        assert "secure" in session and session["path"] == "/" and "domain" not in session
        assert client.get("/api/me").json()["user"]["email"] == DEV_IDENTITY.email


@pytest.mark.parametrize(("hint", "passed"), [("sign-up", "sign-up"), ("sign-in", "sign-in"), ("register", None), (None, None)])
def test_only_known_screen_hints_reach_the_provider(
    client: TestClient, provider: FakeProvider, hint: str | None, passed: str | None
) -> None:
    client.get("/api/auth/login", params={} if hint is None else {"screenHint": hint}, follow_redirects=False)
    assert provider.screen_hints == [passed]


@pytest.mark.parametrize("state", ["forged", "", None])
def test_a_callback_whose_state_does_not_match_fails(client: TestClient, json_logs: Logs, state: str | None) -> None:
    client.get("/api/auth/login", follow_redirects=False)
    params = {"code": "dev"} if state is None else {"code": "dev", "state": state}
    response = client.get("/api/auth/callback", params=params, follow_redirects=False)
    assert response.headers["location"] == "/?auth=failed"
    assert set(set_cookies(response)) == {"vc_oauth_state"}  # spent, and no session
    assert client.get("/api/me").json() == SIGNED_OUT
    (failed,) = events(json_logs(), "auth.failed")
    assert (failed["reason"], failed["severity"]) == ("state", "WARNING")


def test_a_callback_without_its_state_cookie_fails(client: TestClient) -> None:
    """A callback link opened in a browser that never started this sign-in."""
    login = client.get("/api/auth/login", follow_redirects=False)
    client.cookies.clear()
    assert client.get(login.headers["location"], follow_redirects=False).headers["location"] == "/?auth=failed"


def test_a_state_is_good_for_one_callback(client: TestClient) -> None:
    login = client.get("/api/auth/login", follow_redirects=False)
    assert client.get(login.headers["location"], follow_redirects=False).headers["location"] == "/"
    assert client.get(login.headers["location"], follow_redirects=False).headers["location"] == "/?auth=failed"


def test_a_code_the_provider_rejects_fails(client: TestClient, json_logs: Logs) -> None:
    assert sign_in(client, code="not-the-dev-code").headers["location"] == "/?auth=failed"
    assert client.get("/api/me").json() == SIGNED_OUT
    (failed,) = events(json_logs(), "auth.failed")
    assert failed["reason"] == "exchange"


@pytest.mark.parametrize(
    "path", ["/", "/range", "/quest/level-2?take=3&hint=none#top", "/progress/%E2%99%AA", "/" + "a" * 511]
)
def test_same_origin_paths_are_kept(path: str) -> None:
    assert safe_return_to(path) == path


@pytest.mark.parametrize(
    "unsafe",
    [
        "//evil.com",
        "/\\evil.com",
        "\\\\evil.com",
        "https://evil.com",
        "javascript:alert(1)",
        "evil.com",
        "/\t/evil.com",
        "/\n/evil.com",
        "/ /evil.com",
        "/range//evil.com",
        "/ünïcode",
        "/" + "a" * 512,
        "",
    ],
)
def test_unsafe_return_to_lands_on_the_home_page(client: TestClient, unsafe: str) -> None:
    assert sign_in(client, return_to=unsafe).headers["location"] == "/"
    assert client.get("/api/me").json()["user"] is not None


def test_a_forged_state_cookie_cannot_redirect_off_site(client: TestClient) -> None:
    forged = f"vc_oauth_state=nonce.{'//evil.com'.encode().hex()}"
    response = client.get(
        "/api/auth/callback", params={"code": "dev", "state": "nonce"}, headers={"Cookie": forged}, follow_redirects=False
    )
    assert response.headers["location"] == "/"


def test_the_dev_provider_seals_and_opens_its_fixed_identity() -> None:
    provider = DevProvider("secret")
    identity, sealed = provider.authenticate("dev", CALLBACK)
    assert identity == DEV_IDENTITY
    assert provider.load(sealed) == (DEV_IDENTITY, None)
    assert provider.logout_url(sealed) is None
    location = provider.authorization_url(
        state="a b&c", redirect_uri="https://vocal.example.com/api/auth/callback", screen_hint="sign-up"
    )
    assert location == "/api/auth/callback?code=dev&state=a+b%26c"
    with pytest.raises(AuthenticationFailed):
        provider.authenticate("something-else", CALLBACK)


def _forgeries() -> list[str]:
    provider = DevProvider("secret")
    body, signature = provider.seal(DEV_IDENTITY).split(".")
    other_body = provider.seal(Identity("user_2", "other@example.com", None, True)).split(".")[0]
    list_body = base64.urlsafe_b64encode(b"[1, 2]").rstrip(b"=").decode()
    list_signature = hmac.new(b"secret", list_body.encode(), hashlib.sha256).digest()
    return [
        f"{body}.{signature[:-1]}{'B' if signature.endswith('A') else 'A'}",  # a changed signature
        f"{other_body}.{signature}",  # another identity under this one's signature
        DevProvider("another-secret").seal(DEV_IDENTITY),  # the right shape under the wrong secret
        f"{list_body}.{base64.urlsafe_b64encode(list_signature).rstrip(b'=').decode()}",  # signed, but no identity
        f"{body}.",
        "garbage",
        "",
        "ünïcode.☃",
    ]


@pytest.mark.parametrize("sealed", _forgeries())
def test_the_dev_provider_opens_nothing_it_did_not_seal(sealed: str) -> None:
    assert DevProvider("secret").load(sealed) is None


def test_a_tampered_session_cookie_reads_as_signed_out(client: TestClient) -> None:
    sign_in(client)
    genuine = client.cookies["vc_session"]
    client.cookies.clear()
    body, signature = genuine.split(".")
    tampered = f"{body[:-1]}{'B' if body.endswith('A') else 'A'}.{signature}"
    assert client.get("/api/me", headers={"Cookie": f"vc_session={genuine}"}).json()["user"] is not None
    assert client.get("/api/me", headers={"Cookie": f"vc_session={tampered}"}).json() == SIGNED_OUT
    response = client.post("/api/sync", json={"cursor": 0}, headers={"Cookie": f"vc_session={tampered}"})
    assert (response.status_code, response.json()) == (401, {"detail": "Sign in to sync."})


@pytest.fixture
def listed_app(make_app: Callable[..., FastAPI]) -> FastAPI:
    app = make_app(auth_allowed_emails="alto@example.com, @school.edu")
    app.state.identity_provider = FakeProvider()
    return app


@pytest.mark.parametrize("email", ["alto@example.com", "Alto@Example.com", "singer@school.edu"])
def test_the_allowlist_admits_listed_emails_and_domains(listed_app: FastAPI, email: str) -> None:
    device = TestClient(listed_app)
    assert sign_in(device, email).headers["location"] == "/"
    assert device.get("/api/me").json()["user"]["email"] == email.lower()


@pytest.mark.parametrize("email", ["other@example.com", "alto@example.org", "singer@sub.school.edu", "singer@notschool.edu"])
def test_the_allowlist_turns_everyone_else_away(listed_app: FastAPI, json_logs: Logs, email: str) -> None:
    device = TestClient(listed_app)
    response = sign_in(device, email)
    assert response.headers["location"] == "/?auth=denied"
    assert set(set_cookies(response)) == {"vc_oauth_state"}
    assert device.get("/api/me").json()["user"] is None
    with listed_app.state.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(User)) == 0
    lines = [line for line in json_logs() if line["logger"] != CLIENT_LOGGER]
    (denied,) = events(lines, "auth.denied")
    assert denied["reason"] == "allowlist"
    assert email.lower() not in json.dumps(lines).lower()


def test_an_unverified_address_never_passes_the_allowlist(listed_app: FastAPI, json_logs: Logs) -> None:
    listed_app.state.identity_provider.verified = False
    device = TestClient(listed_app)
    assert sign_in(device, "alto@example.com").headers["location"] == "/?auth=denied"
    (denied,) = events(json_logs(), "auth.denied")
    assert denied["reason"] == "unverified_email"


def test_a_session_the_allowlist_no_longer_admits_is_signed_out(app: FastAPI, signed_in: SignIn) -> None:
    device = signed_in("alto@example.com")
    assert device.get("/api/me").json()["user"] is not None
    app.state.settings = app.state.settings.model_copy(update={"auth_allowed_emails": ("@school.edu",)})
    assert device.get("/api/me").json()["user"] is None
    assert device.post("/api/sync", json={"cursor": 0}).status_code == 401


def test_the_first_sign_in_is_a_signup_and_later_ones_are_logins(client: TestClient, json_logs: Logs) -> None:
    sign_in(client)
    sign_in(client)
    account = client.get("/api/me").json()["user"]["id"]
    lines = events(json_logs(), "auth.signup", "auth.login")
    assert [(line["event"], line["userId"]) for line in lines] == [("auth.signup", account), ("auth.login", account)]


def test_signing_in_links_an_account_known_only_by_email(
    app: FastAPI, provider: FakeProvider, client: TestClient, json_logs: Logs
) -> None:
    with app.state.sessions() as session:
        existing = User(email="singer@example.com")
        session.add(existing)
        session.commit()
    sign_in(client, "Singer@Example.com|user_01")
    assert client.get("/api/me").json()["user"]["id"] == str(existing.id)
    with app.state.sessions() as session:
        assert session.scalars(sa.select(User.workos_user_id)).all() == ["user_01"]
    assert [line["event"] for line in events(json_logs(), "auth.signup", "auth.login")] == ["auth.login"]


def test_a_recreated_provider_account_takes_over_its_email(app: FastAPI, provider: FakeProvider, client: TestClient) -> None:
    sign_in(client, "singer@example.com|user_old")
    account = client.get("/api/me").json()["user"]["id"]
    recreated = TestClient(app)
    sign_in(recreated, "singer@example.com|user_new")
    assert recreated.get("/api/me").json()["user"]["id"] == account
    assert client.get("/api/me").json()["user"] is None  # the old provider account no longer opens it


def test_an_unverified_address_cannot_claim_an_account_that_uses_it(
    app: FastAPI, provider: FakeProvider, client: TestClient, json_logs: Logs
) -> None:
    sign_in(TestClient(app), "singer@example.com|user_owner")
    provider.verified = False
    response = sign_in(client, "singer@example.com|user_claimant")
    assert (response.headers["location"], set(set_cookies(response))) == ("/?auth=denied", {"vc_oauth_state"})
    (denied,) = events(json_logs(), "auth.denied")
    assert denied["reason"] == "unverified_email"
    with app.state.sessions() as session:
        assert session.scalars(sa.select(User.workos_user_id)).all() == ["user_owner"]


def test_an_unverified_address_may_start_an_account(provider: FakeProvider, client: TestClient) -> None:
    provider.verified = False
    assert sign_in(client, "new@example.com").headers["location"] == "/"
    assert client.get("/api/me").json()["user"]["email"] == "new@example.com"


@pytest.mark.parametrize(("verified", "stored"), [(True, "new@example.com"), (False, "old@example.com")])
def test_an_account_follows_its_provider_accounts_verified_address(
    provider: FakeProvider, client: TestClient, verified: bool, stored: str
) -> None:
    sign_in(client, "old@example.com|user_01")
    provider.verified = verified
    assert sign_in(client, "new@example.com|user_01").headers["location"] == "/"
    assert client.get("/api/me").json()["user"]["email"] == stored


def test_an_address_another_account_uses_stays_with_it(app: FastAPI, provider: FakeProvider, client: TestClient) -> None:
    sign_in(TestClient(app), "taken@example.com|user_other")
    sign_in(client, "mine@example.com|user_01")
    assert sign_in(client, "taken@example.com|user_01").headers["location"] == "/"
    with app.state.sessions() as session:
        rows = session.execute(sa.select(User.workos_user_id, User.email)).tuples().all()
    assert dict(rows) == {"user_other": "taken@example.com", "user_01": "mine@example.com"}


@pytest.mark.parametrize(
    ("method", "path", "body", "status"),
    [
        ("GET", "/api/me", None, 200),
        ("POST", "/api/sync", {"cursor": 0}, 200),
        ("GET", "/api/account/export", None, 200),
        ("POST", "/api/sync", {"cursor": -1}, 422),
        ("GET", "/api/boom", None, 500),
    ],
)
def test_a_refreshed_session_is_written_back_whatever_the_response(
    app: FastAPI, signed_in: SignIn, provider: FakeProvider, method: str, path: str, body: Any, status: int
) -> None:
    """Renewal may have spent the old refresh token, so even a failed request must hand over the new cookie."""

    def boom(user: User | None = Depends(optional_user)) -> None:
        raise RuntimeError("kaboom")

    app.add_api_route("/api/boom", boom)
    device = signed_in("singer@example.com")
    assert "set-cookie" not in device.get("/api/me").headers
    provider.refresh = True
    response = device.request(method, path, json=body)
    assert response.status_code == status
    cookie = set_cookies(response)["vc_session"]
    assert cookie["value"] == provider.seal(Identity("user_singer@example.com", "singer@example.com", "Refreshed", True))
    assert (cookie["max-age"], "httponly" in cookie) == (str(SESSION_MAX_AGE), True)


def test_a_session_that_will_never_open_again_is_cleared_once(app: FastAPI, client: TestClient, json_logs: Logs) -> None:
    sign_in(client)
    app.state.identity_provider = DevProvider("a-rotated-secret")  # every cookie sealed before now reads as forged
    first = client.get("/api/me")
    assert first.json() == SIGNED_OUT
    assert set_cookies(first)["vc_session"]["max-age"] == "0"
    assert client.get("/api/me").json() == SIGNED_OUT
    (expired,) = events(json_logs(), "auth.session_expired")
    assert expired["severity"] == "INFO"


def test_a_provider_that_cannot_be_asked_keeps_the_session(
    signed_in: SignIn, provider: FakeProvider, json_logs: Logs
) -> None:
    device = signed_in("singer@example.com")
    provider.unavailable = True
    response = device.get("/api/me")
    assert (response.json()["user"], "set-cookie" in response.headers) == (None, False)
    assert device.post("/api/sync", json={"cursor": 0}).status_code == 401
    provider.unavailable = False
    assert device.get("/api/me").json()["user"]["email"] == "singer@example.com"
    assert events(json_logs(), "auth.session_expired") == []


def test_last_seen_is_stamped_only_once_it_is_stale(app: FastAPI, client: TestClient) -> None:
    sign_in(client)

    def last_seen(set_to: datetime | None = None) -> datetime:
        with app.state.sessions() as session:
            if set_to is not None:
                session.execute(sa.update(User).values(last_seen_at=set_to))
                session.commit()
            moment: datetime = session.scalars(sa.select(User.last_seen_at)).one()
            return moment

    recent = last_seen(set_to=utcnow() - LAST_SEEN_RESOLUTION + timedelta(minutes=1))
    client.get("/api/me")
    assert last_seen() == recent
    last_seen(set_to=utcnow() - LAST_SEEN_RESOLUTION - timedelta(seconds=1))
    before = utcnow()
    client.get("/api/me")
    assert last_seen() >= before


def test_signing_out_clears_the_session(client: TestClient, json_logs: Logs) -> None:
    sign_in(client)
    account = client.get("/api/me").json()["user"]["id"]
    response = client.post("/api/auth/logout")
    assert (response.status_code, response.json()) == (200, {"logoutUrl": None})
    assert set_cookies(response)["vc_session"]["max-age"] == "0"
    assert client.get("/api/me").json() == SIGNED_OUT
    (logout,) = events(json_logs(), "auth.logout")
    assert logout["userId"] == account


def test_signing_out_hands_back_the_providers_logout_url(signed_in: SignIn, provider: FakeProvider) -> None:
    provider.logout = "https://auth.example.com/logout?session=1"
    device = signed_in("singer@example.com")
    assert device.post("/api/auth/logout").json() == {"logoutUrl": "https://auth.example.com/logout?session=1"}


def test_signing_out_while_signed_out_is_quiet(client: TestClient, json_logs: Logs) -> None:
    response = client.post("/api/auth/logout")
    assert (response.status_code, response.json()) == (200, {"logoutUrl": None})
    assert events(json_logs(), "auth.logout") == []
