"""Account export in the client's own backup format, and account deletion."""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from support import SERVER_DIR, FakeProvider, events, item, post_sync, sample, set_cookies, tombstone_for
from vocal_compass.models import User
from vocal_compass.records import KINDS

SignIn = Callable[[str], TestClient]
Logs = Callable[[], list[dict[str, Any]]]
CLIENT_REPOSITORY = SERVER_DIR.parent / "src" / "core" / "storage" / "TrialRepository.ts"


def first_group(pattern: str, text: str) -> str:
    found = re.search(pattern, text, re.DOTALL)
    assert found, f"{pattern!r} not found in {CLIENT_REPOSITORY}"
    return found[1]


@pytest.mark.parametrize(("method", "path"), [("GET", "/api/account/export"), ("DELETE", "/api/account")])
def test_account_routes_need_a_signed_in_user(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path)
    assert (response.status_code, response.json()) == (401, {"detail": "Sign in to sync."})


def test_the_export_is_the_clients_backup_format(signed_in: SignIn, json_logs: Logs) -> None:
    singer = signed_in("singer@example.com")
    late = sample("trial", "t-late", "2026-09-12T12:00:00.000Z")
    early = sample("trial", "t-early", "2026-09-11T08:00:00.000Z")
    gone = sample("trial", "t-gone", "2026-09-10T08:00:00.000Z")
    kept = {kind: sample(kind, f"{kind}-1") for kind in ("range", "session", "phrase")}
    post_sync(singer, records=[item("trial", late), item("trial", early), item("trial", gone), *(item(k, r) for k, r in kept.items())])
    removed = tombstone_for("trial", "t-gone", "2026-09-12T13:00:00.000Z")
    never_pushed = tombstone_for("phrase", "p-never", "2026-09-12T09:00:00.000Z")
    post_sync(singer, cursor=6, tombstones=[removed, never_pushed])
    post_sync(signed_in("someone-else@example.com"), records=[item("trial", sample("trial", "t-theirs"))])

    today = datetime.now(UTC).date().isoformat()
    response = singer.get("/api/account/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["content-disposition"] == f'attachment; filename="vocal-compass-account-{today}.json"'
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "app": "vocal-compass",
        "version": 5,
        "trials": [early, late],
        "ranges": [kept["range"]],
        "sessions": [kept["session"]],
        "phrases": [kept["phrase"]],
        "tombstones": [never_pushed, removed],
    }
    (exported,) = events(json_logs(), "account.exported")
    assert {key: exported[key] for key in ("trials", "ranges", "sessions", "phrases", "tombstones")} == {
        "trials": 2,
        "ranges": 1,
        "sessions": 1,
        "phrases": 1,
        "tombstones": 2,
    }
    assert exported["userId"]


def test_an_empty_account_exports_empty_lists(signed_in: SignIn) -> None:
    assert signed_in("new@example.com").get("/api/account/export").json() == {
        "app": "vocal-compass",
        "version": 5,
        **{kind.export_key: [] for kind in KINDS.values()},
        "tombstones": [],
    }


def test_the_export_matches_the_clients_import_contract(signed_in: SignIn) -> None:
    """Read against the client's own source, so neither side can drift alone."""
    source = CLIENT_REPOSITORY.read_text()
    declared = re.findall(r"^\s+(\w+): ", first_group(r"export interface ExportPayload \{\n(.*?)\n\}", source), re.MULTILINE)
    imported = re.findall(r"parsed\.(\w+) \?\? \[\]", source)
    built = first_group(r"const payload: ExportPayload = \{(.*?)\};", source)

    singer = signed_in("singer@example.com")
    records = [item(kind, sample(kind, f"{kind}-1")) for kind in KINDS]
    deletion = tombstone_for("trial", "t-gone")
    post_sync(singer, records=records, tombstones=[deletion])
    export = singer.get("/api/account/export").json()

    assert list(export) == declared
    assert export["app"] == first_group(r'app: "([^"]+)"', built)
    assert export["version"] == int(first_group(r"version: (\d+)", built))
    # What parseImportJson reads back is exactly what the account holds.
    assert {key: export[key] for key in imported} == {
        **{KINDS[pushed["kind"]].export_key: [pushed["record"]] for pushed in records},
        "tombstones": [deletion],
    }


def test_deleting_the_account_removes_every_row_and_signs_out_everywhere(
    app: FastAPI, signed_in: SignIn, provider: FakeProvider, json_logs: Logs
) -> None:
    provider.logout = "https://auth.example.com/logout?session=1"
    alice, alice_tablet, bob = signed_in("alice@example.com"), signed_in("alice@example.com"), signed_in("bob@example.com")
    for device in (alice, bob):
        post_sync(
            device,
            records=[item(kind, sample(kind, f"{kind}-1")) for kind in KINDS],
            tombstones=[tombstone_for("phrase", "p-gone")],
        )
    with app.state.sessions() as session:
        alice_id = session.scalars(sa.select(User.id).where(User.email == "alice@example.com")).one()

    response = alice.delete("/api/account")
    assert (response.status_code, response.json()) == (200, {"deleted": True, "logoutUrl": provider.logout})
    assert set_cookies(response)["vc_session"]["max-age"] == "0"

    with app.state.sessions() as session:
        assert session.get(User, alice_id) is None
        for kind in KINDS.values():
            owners = session.scalars(sa.select(kind.model.user_id)).all()
            assert alice_id not in owners
            assert len(owners) == (2 if kind.name == "phrase" else 1)  # bob's rows, his stub included
    assert alice.get("/api/me").json()["user"] is None
    assert alice_tablet.post("/api/sync", json={"cursor": 0}).status_code == 401
    (deleted,) = events(json_logs(), "account.deleted")
    assert deleted["userId"] == str(alice_id)

    # Signing in again starts a new, empty account.
    fresh = signed_in("alice@example.com")
    assert fresh.get("/api/me").json()["user"]["id"] != str(alice_id)
    assert post_sync(fresh) == {"accepted": 0, "rejected": [], "records": [], "tombstones": [], "cursor": 0, "hasMore": False}
