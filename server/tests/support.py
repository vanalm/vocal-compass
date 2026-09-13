"""Helpers shared by conftest.py and the test modules."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx2
import pytest
import sqlalchemy as sa
from alembic.config import Config
from fastapi.testclient import TestClient

from vocal_compass.auth.providers import DEV_CODE, AuthenticationFailed, DevProvider, Identity, ProviderUnavailable
from vocal_compass.models import Base
from vocal_compass.settings import DEV_SESSION_SECRET, Settings

SERVER_DIR = Path(__file__).resolve().parents[1]
MEMORY_DATABASE_URL = "sqlite://"
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
LOG_PROJECT = "vc-test-project"  # the GOOGLE_CLOUD_PROJECT the json_logs fixture formats with
CLIENT_LOGGER = "httpx2"  # the TestClient's own request log, which prints every URL it fetches
FERNET_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="  # a valid WORKOS_COOKIE_PASSWORD: 32 bytes, url-safe base64

postgres_only = pytest.mark.skipif(
    not TEST_DATABASE_URL.startswith("postgresql"), reason="set TEST_DATABASE_URL to a Postgres database"
)

FRAME = {"t": 0, "midi": 60.1, "clarity": 0.91, "rms": 0.12}

TRIAL: dict[str, Any] = {
    "id": "trial-1",
    "createdAt": "2026-09-12T10:00:00.000Z",
    "definition": {
        "id": "def-1",
        "exerciseId": "degree-leap",
        "keyName": "C",
        "tonicMidi": 60,
        "scale": [0, 2, 4, 5, 7, 9, 11],
        "startDegree": 1,
        "targetDegree": 5,
        "startMidi": 60,
        "targetMidi": 67,
        "phraseMidis": [60, 64],
        "delayMs": 1500,
        "load": "neutral",
        "createdAt": "2026-09-12T09:59:58.000Z",
    },
    "scored": True,
    "selectedMidi": 67,
    "selectedNote": "G4",
    "targetNote": "G4",
    "targetErrorCents": -12.5,
    "residualToSelectedCents": -12.5,
    "destinationMatch": True,
    "cleanLandingOnSelected": True,
    "wrongDirection": False,
    "octaveDisplacement": False,
    "searchTransitions": 1,
    "pitchPathSemitones": 7.2,
    "stabilityCents": 8.25,
    "detectorConfidence": 0.93,
    "acousticErrorKind": "success",
    "explanation": "Landed on the target.",
    "feedbackMode": "blind",
    "hintLevel": 0,
    "lostEvent": False,
    "intent": None,
    "finalErrorKind": "success",
    "selectionLatencyMs": 412.7,
    "recoveryTimeMs": None,
    "confidenceBefore": 4,
    "effort": 2,
    "register": "chest",
    "trace": [FRAME],
}

RANGE: dict[str, Any] = {
    "id": "range-1",
    "createdAt": "2026-09-12T10:10:00.000Z",
    "lowMidi": 45.3,
    "highMidi": 69,
    "method": "guided-turns",
    "micLowCut": "80",
    "steps": [
        {
            "targetMidi": 57,
            "direction": "anchor",
            "attempt": 1,
            "hit": True,
            "octaveOff": None,
            "sungMidi": 57.1,
            "centsOff": 10.5,
            "timeToMatchMs": 640.5,
            "startedAt": 1000.25,
            "endedAt": 2400.75,
        }
    ],
    "trace": [FRAME],
}

SESSION: dict[str, Any] = {"id": "session-1", "createdAt": "2026-09-12T10:20:00.000Z", "planId": "vfe", "stepsCompleted": 4}

PHRASE: dict[str, Any] = {
    "id": "phrase-1",
    "createdAt": "2026-09-12T10:05:00.000Z",
    "phraseId": "l1-arc-13531",
    "phraseName": "Arc 1-3-5-3-1",
    "level": 1,
    "keyTonicMidi": 57,
    "bpm": 90,
    "role": "melody",
    "guide": "none",
    "verified": True,
    "hits": 4,
    "misses": 1,
    "extras": 0,
    "sequenceAccuracy": 0.8,
    "meanAbsOnsetMs": 63.5,
    "landingHit": True,
    "trace": [FRAME],
}

_SAMPLES = {"trial": TRIAL, "range": RANGE, "session": SESSION, "phrase": PHRASE}


def make_settings(**overrides: Any) -> Settings:
    """Test-environment Settings at DEBUG, so log assertions see every line."""
    return Settings(
        **{
            "environment": "test",
            "database_url": TEST_DATABASE_URL or MEMORY_DATABASE_URL,
            "log_level": "DEBUG",
            **overrides,
        }
    )


def alembic_config(connection: sa.Connection | None = None) -> Config:
    """The real alembic.ini; with a connection, migrations run over it instead of reading DATABASE_URL."""
    config = Config(str(SERVER_DIR / "alembic.ini"))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def empty_tables(engine: sa.Engine) -> None:
    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())


def sample(kind: str, record_id: str, created_at: str = "2026-09-12T10:00:00.000Z", **fields: Any) -> dict[str, Any]:
    """A realistic client record of `kind`, under its own id and time."""
    return {**_SAMPLES[kind], "id": record_id, "createdAt": created_at, **fields}


def item(kind: str, record: dict[str, Any]) -> dict[str, Any]:
    """A record as a sync request carries it."""
    return {"kind": kind, "record": record}


def tombstone_for(kind: str, record_id: str, created_at: str = "2026-09-12T11:00:00.000Z") -> dict[str, Any]:
    return {"id": f"deleted-{kind}-{record_id}", "createdAt": created_at, "kind": kind, "recordId": record_id}


def post_sync(
    client: TestClient,
    cursor: int = 0,
    records: list[dict[str, Any]] | None = None,
    tombstones: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """A sync that must succeed. Its body comes back without the userId every page carries, so bodies compare across accounts."""
    response = client.post("/api/sync", json={"cursor": cursor, "records": records or [], "tombstones": tombstones or []})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert isinstance(body.pop("userId"), str)
    return body


def events(lines: list[dict[str, Any]], *names: str) -> list[dict[str, Any]]:
    """The domain-event log lines with any of `names`, in order."""
    return [line for line in lines if line.get("event") in names]


class FakeProvider(DevProvider):
    """A stand-in for a hosted provider that signs in whoever the code names, with no network.

    The code is "email" or "email|provider user id". The fake records the
    screen hints it is asked for, signs addresses in as verified unless
    `verified` is cleared, reports every session as refreshed while `refresh`
    is set and itself as unreachable while `unavailable` is, and hands out
    `logout` as its logout URL.
    """

    mode = "workos"

    def __init__(self) -> None:
        super().__init__(DEV_SESSION_SECRET)
        self.screen_hints: list[str | None] = []
        self.verified = True
        self.refresh = False
        self.unavailable = False
        self.logout: str | None = None

    def authorization_url(self, *, state: str, redirect_uri: str, screen_hint: str | None) -> str:
        self.screen_hints.append(screen_hint)
        return super().authorization_url(state=state, redirect_uri=redirect_uri, screen_hint=screen_hint)

    def authenticate(self, code: str, redirect_uri: str) -> tuple[Identity, str]:
        email, _, subject = code.partition("|")
        if "@" not in email:
            raise AuthenticationFailed("the fake provider signs in email addresses")
        identity = Identity(subject or f"user_{email.lower()}", email, None, self.verified)
        return identity, self.seal(identity)

    def load(self, sealed: str) -> tuple[Identity, str | None] | None:
        if self.unavailable:
            raise ProviderUnavailable
        loaded = super().load(sealed)
        if loaded is None or not self.refresh:
            return loaded
        return loaded[0], self.seal(loaded[0]._replace(name="Refreshed"))

    def logout_url(self, sealed: str) -> str | None:
        return self.logout


def sign_in(client: TestClient, code: str = DEV_CODE, return_to: str | None = None) -> httpx2.Response:
    """The browser's part of signing in: /api/auth/login, then the callback with `code` and the state login issued."""
    params = {} if return_to is None else {"returnTo": return_to}
    login = client.get("/api/auth/login", params=params, follow_redirects=False)
    state = parse_qs(urlsplit(login.headers["location"]).query)["state"][0]
    return client.get("/api/auth/callback", params={"code": code, "state": state}, follow_redirects=False)


def set_cookies(response: httpx2.Response) -> dict[str, dict[str, str]]:
    """A response's Set-Cookie headers by name: "value", plus each attribute under its lowercased name ("" for flags)."""
    cookies: dict[str, dict[str, str]] = {}
    for header in response.headers.get_list("set-cookie"):
        pair, *attributes = (part.strip() for part in header.split(";"))
        name, _, value = pair.partition("=")
        cookies[name] = {"value": value} | {key.lower(): val for key, _, val in (a.partition("=") for a in attributes)}
    return cookies
