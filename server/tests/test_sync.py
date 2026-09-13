"""The sync protocol: push, pull, tombstones, paging, rejection, isolation, locking, and one event per sync."""

from __future__ import annotations

import json
import random
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from support import TEST_DATABASE_URL, FakeProvider, events, item, post_sync, sample, sign_in, tombstone_for
from vocal_compass import middleware
from vocal_compass.api import sync as sync_api
from vocal_compass.models import Base, ExerciseSession, PhraseAttempt, Trial, User
from vocal_compass.records import KINDS

SignIn = Callable[[str], TestClient]
Logs = Callable[[], list[dict[str, Any]]]
SINGER = "singer@example.com"
NOTHING: dict[str, Any] = {"accepted": 0, "rejected": [], "records": [], "tombstones": [], "hasMore": False}
AT = "2026-09-12T10:00:00.000Z"


def raw_sync(client: TestClient, body: str) -> dict[str, Any]:
    """Post JSON text exactly as given, for bodies the test client would not encode itself; returns what post_sync does."""
    response = client.post("/api/sync", content=body, headers={"Content-Type": "application/json"})
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    assert isinstance(result.pop("userId"), str)
    return result


def test_sync_needs_a_signed_in_user(client: TestClient) -> None:
    response = client.post("/api/sync", json={"cursor": 0})
    assert (response.status_code, response.json()) == (401, {"detail": "Sign in to sync."})


def test_one_device_pushes_and_another_pulls_every_kind(signed_in: SignIn) -> None:
    phone, laptop = signed_in(SINGER), signed_in(SINGER)
    records = [item(kind, sample(kind, f"{kind}-1")) for kind in KINDS]
    assert post_sync(phone, records=records) == {**NOTHING, "accepted": 4, "cursor": 4}
    assert post_sync(laptop) == {**NOTHING, "records": records, "cursor": 4}
    assert post_sync(laptop, cursor=4) == {**NOTHING, "cursor": 4}


def test_pushing_the_same_records_again_changes_nothing(signed_in: SignIn) -> None:
    phone = signed_in(SINGER)
    records = [item(kind, sample(kind, f"{kind}-1")) for kind in KINDS]
    post_sync(phone, records=records)
    assert post_sync(phone, cursor=4, records=records) == {**NOTHING, "cursor": 4}


def test_records_are_immutable(app: FastAPI, signed_in: SignIn) -> None:
    phone, laptop = signed_in(SINGER), signed_in(SINGER)
    original = sample("trial", "t1")
    post_sync(phone, records=[item("trial", original)])
    edited = {**original, "finalErrorKind": "landing"}
    assert post_sync(phone, cursor=1, records=[item("trial", edited)]) == {**NOTHING, "cursor": 1}
    assert post_sync(laptop)["records"] == [item("trial", original)]
    with app.state.sessions() as session:
        assert session.scalars(sa.select(Trial.final_error_kind)).one() == "success"


def test_a_tombstone_retires_a_stored_record(app: FastAPI, signed_in: SignIn) -> None:
    phone, laptop = signed_in(SINGER), signed_in(SINGER)
    kept, removed = sample("trial", "t1"), sample("trial", "t2")
    post_sync(phone, records=[item("trial", kept), item("trial", removed)])
    deletion = tombstone_for("trial", "t2")
    assert post_sync(phone, cursor=2, tombstones=[deletion]) == {**NOTHING, "tombstones": [deletion], "cursor": 3}
    assert post_sync(laptop) == {**NOTHING, "records": [item("trial", kept)], "tombstones": [deletion], "cursor": 3}
    with app.state.sessions() as session:
        row = session.scalars(sa.select(Trial).where(Trial.id == "t2")).one()
        assert (row.seq, row.deletion_id, row.target_midi, row.final_error_kind) == (3, deletion["id"], None, None)
        assert row.deleted_at == datetime(2026, 9, 12, 11, 0, tzinfo=UTC)
        # SQL NULL, not the JSON text null: the payload itself is gone.
        assert session.scalar(sa.select(sa.func.count()).select_from(Trial).where(Trial.payload.is_(None))) == 1


def test_a_tombstone_for_a_record_the_account_never_had_blocks_it(app: FastAPI, signed_in: SignIn) -> None:
    phone, laptop = signed_in(SINGER), signed_in(SINGER)
    deletion = tombstone_for("phrase", "p1")
    assert post_sync(phone, tombstones=[deletion]) == {**NOTHING, "tombstones": [deletion], "cursor": 1}
    # A device that was offline pushes its copy afterwards: refused, and told to delete it.
    late = post_sync(laptop, records=[item("phrase", sample("phrase", "p1"))])
    assert late == {**NOTHING, "tombstones": [deletion], "cursor": 1}
    with app.state.sessions() as session:
        stub = session.scalars(sa.select(PhraseAttempt)).one()
        assert (stub.id, stub.seq, stub.payload, stub.phrase_id) == ("p1", 1, None, None)
        assert stub.created_at == stub.deleted_at


def test_deleted_records_stay_deleted(signed_in: SignIn) -> None:
    phone = signed_in(SINGER)
    record = item("session", sample("session", "s1"))
    deletion = tombstone_for("session", "s1")
    post_sync(phone, records=[record])
    post_sync(phone, cursor=1, tombstones=[deletion])
    another = {**deletion, "id": "deleted-again", "createdAt": "2026-09-13T00:00:00.000Z"}
    assert post_sync(phone, cursor=2, records=[record], tombstones=[deletion, another]) == {**NOTHING, "cursor": 2}


def test_a_tombstone_and_its_record_in_one_push_leave_it_deleted(signed_in: SignIn) -> None:
    phone = signed_in(SINGER)
    deletion = tombstone_for("range", "r1")
    result = post_sync(phone, records=[item("range", sample("range", "r1"))], tombstones=[deletion])
    assert result == {**NOTHING, "tombstones": [deletion], "cursor": 1}


def test_pulls_page_across_kinds_with_exact_cursors(signed_in: SignIn) -> None:
    phone, laptop = signed_in(SINGER), signed_in(SINGER)
    rng = random.Random(1203)
    kinds = [rng.choice(list(KINDS)) for _ in range(1203)]
    assert set(kinds) == set(KINDS)
    pushed = [item(kind, sample(kind, f"rec-{index:04d}")) for index, kind in enumerate(kinds)]
    cursor = 0
    for start in range(0, len(pushed), 500):
        batch = pushed[start : start + 500]
        assert post_sync(phone, cursor=cursor, records=batch) == {**NOTHING, "accepted": len(batch), "cursor": cursor + len(batch)}
        cursor += len(batch)

    pages: list[tuple[int, int, bool]] = []
    pulled: list[dict[str, Any]] = []
    cursor, has_more = 0, True
    while has_more:
        page = post_sync(laptop, cursor=cursor)
        pages.append((len(page["records"]), page["cursor"], page["hasMore"]))
        pulled += page["records"]
        cursor, has_more = page["cursor"], page["hasMore"]
    assert pages == [(500, 500, True), (500, 1000, True), (203, 1203, False)]
    assert pulled == pushed


def test_a_page_ending_exactly_at_the_last_row_has_no_more(signed_in: SignIn) -> None:
    phone, laptop = signed_in(SINGER), signed_in(SINGER)
    post_sync(phone, records=[item("session", sample("session", f"s{index}")) for index in range(500)])
    page = post_sync(laptop)
    assert (len(page["records"]), page["cursor"], page["hasMore"]) == (500, 500, False)


def test_a_page_also_ends_at_its_size_budget(signed_in: SignIn, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sync_api, "PAGE_BUDGET", 2_000)
    phone, laptop = signed_in(SINGER), signed_in(SINGER)

    def with_note(record_id: str, length: int) -> dict[str, Any]:
        return item("session", sample("session", record_id, note="n" * length))

    ids = ["s0", "s1", "s2", "s3", "big", "s4"]
    post_sync(phone, records=[with_note(record_id, 5_000 if record_id == "big" else 800) for record_id in ids])
    pages: list[list[str]] = []
    cursor, has_more = 0, True
    while has_more:
        page = post_sync(laptop, cursor=cursor)
        pages.append([pulled["record"]["id"] for pulled in page["records"]])
        cursor, has_more = page["cursor"], page["hasMore"]
    # Two 800-character notes fit the budget and a third does not; a record over it goes alone.
    assert pages == [["s0", "s1"], ["s2", "s3"], ["big"], ["s4"]]


def test_each_table_stops_at_a_page_before_the_merge(app: FastAPI, signed_in: SignIn) -> None:
    """Otherwise every page reads, casts and sorts every row above its cursor, and a first sync costs rows squared."""
    phone = signed_in(SINGER)
    statements: list[str] = []

    def capture(connection: Any, cursor: Any, statement: str, *rest: Any) -> None:
        if "UNION ALL" in statement:
            statements.append(statement)

    sa.event.listen(app.state.engine, "before_cursor_execute", capture)
    try:
        post_sync(phone)
    finally:
        sa.event.remove(app.state.engine, "before_cursor_execute", capture)
    (pull,) = statements
    assert pull.upper().count(" LIMIT ") == len(KINDS) + 1


def test_a_cursor_ahead_of_the_account_pulls_everything_again(app: FastAPI, signed_in: SignIn, json_logs: Logs) -> None:
    """After a restore to an earlier point, new rows reuse seqs that devices' cursors have already passed."""
    phone, laptop = signed_in(SINGER), signed_in(SINGER)
    before = [item("session", sample("session", f"s{number}")) for number in range(10)]
    post_sync(phone, records=before)
    assert post_sync(laptop)["cursor"] == 10
    with app.state.sessions() as session:  # restored to when the account held six rows
        session.execute(sa.delete(ExerciseSession).where(ExerciseSession.seq > 6))
        session.execute(sa.update(User).values(sync_seq=6))
        session.commit()
    after = [item("session", sample("session", f"after{number}")) for number in range(2)]
    assert post_sync(phone, cursor=10, records=after) == {**NOTHING, "accepted": 2, "records": before[:6], "cursor": 8}
    assert post_sync(laptop, cursor=10) == {**NOTHING, "records": before[:6] + after, "cursor": 8}
    lines = events(json_logs(), "sync.cursor_ahead")
    assert [(line["severity"], line["cursor"], line["head"]) for line in lines] == [("WARNING", 10, 6), ("WARNING", 10, 8)]


def test_a_push_is_not_echoed_back_but_advances_the_cursor(signed_in: SignIn) -> None:
    phone, laptop = signed_in(SINGER), signed_in(SINGER)
    from_laptop = [item("trial", sample("trial", "shared-id")), item("phrase", sample("phrase", "p-both"))]
    post_sync(laptop, records=from_laptop)
    from_phone = [
        item("range", sample("range", "shared-id")),  # the same id in another kind is another record
        item("phrase", sample("phrase", "p-both")),  # already held: not accepted, and not sent back
        item("session", sample("session", "s-phone")),
    ]
    assert post_sync(phone, records=from_phone) == {**NOTHING, "accepted": 2, "records": [from_laptop[0]], "cursor": 4}


def test_invalid_records_and_tombstones_are_rejected_one_at_a_time(signed_in: SignIn) -> None:
    phone = signed_in(SINGER)
    body = {
        "cursor": 0,
        "records": [
            item("trial", sample("trial", "ok")),
            item("chord", {"id": "c1", "createdAt": AT}),
            item("trial", {"id": "has space", "createdAt": AT}),
            item("trial", {"id": "x" * 65, "createdAt": AT}),
            item("trial", {"createdAt": AT}),
            item("trial", {"id": 7, "createdAt": AT}),
            item("range", {"id": "r1"}),
            item("range", {"id": "r2", "createdAt": "yesterday"}),
            item("range", {"id": "r3", "createdAt": 1757671200000}),
            item("session", {"id": "s1", "createdAt": AT, "note": "n" * 1_000_000}),
            item("phrase", {"id": "p1", "createdAt": AT, "phraseName": "a\u0000b"}),
            item("phrase", {"id": "p2", "createdAt": AT, "phraseName": "\ud800"}),
        ],
        "tombstones": [
            {"id": "d1", "createdAt": AT, "kind": "chord", "recordId": "c1"},
            {"id": ["d2"], "createdAt": AT, "kind": ["trial"], "recordId": "t1"},
            {"id": "bad id", "createdAt": AT, "kind": "trial", "recordId": "t1"},
            {"id": "d4", "createdAt": AT, "kind": "trial", "recordId": "bad id"},
            {"id": "d5", "createdAt": "soon", "kind": "trial", "recordId": "t1"},
        ],
    }
    # Plain json.dumps escapes the lone surrogate, which no UTF-8 encoder would accept.
    result = raw_sync(phone, json.dumps(body))
    assert result["rejected"] == [
        {"kind": "tombstone", "id": "d1", "reason": "unknown_kind"},
        {"kind": "tombstone", "id": None, "reason": "unknown_kind"},
        {"kind": "tombstone", "id": "bad id", "reason": "invalid_id"},
        {"kind": "tombstone", "id": "d4", "reason": "invalid_record_id"},
        {"kind": "tombstone", "id": "d5", "reason": "invalid_created_at"},
        {"kind": "chord", "id": "c1", "reason": "unknown_kind"},
        {"kind": "trial", "id": "has space", "reason": "invalid_id"},
        {"kind": "trial", "id": "x" * 65, "reason": "invalid_id"},
        {"kind": "trial", "id": None, "reason": "invalid_id"},
        {"kind": "trial", "id": None, "reason": "invalid_id"},
        {"kind": "range", "id": "r1", "reason": "invalid_created_at"},
        {"kind": "range", "id": "r2", "reason": "invalid_created_at"},
        {"kind": "range", "id": "r3", "reason": "invalid_created_at"},
        {"kind": "session", "id": "s1", "reason": "too_large"},
        {"kind": "phrase", "id": "p1", "reason": "invalid_json"},
        {"kind": "phrase", "id": "p2", "reason": "invalid_json"},
    ]
    assert (result["accepted"], result["cursor"]) == (1, 1)


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity", "1e400"])
def test_numbers_json_cannot_store_are_rejected(signed_in: SignIn, number: str) -> None:
    phone = signed_in(SINGER)
    record = f'{{"id":"t1","createdAt":"{AT}","selectedMidi":{number}}}'
    result = raw_sync(phone, f'{{"cursor":0,"records":[{{"kind":"trial","record":{record}}}]}}')
    assert result == {**NOTHING, "rejected": [{"kind": "trial", "id": "t1", "reason": "invalid_json"}], "cursor": 0}


@pytest.mark.parametrize(
    ("record_id", "created_at"),
    [
        ("a", "2026-09-12"),
        ("A-Z_a.z:0-9", "2026-09-12T10:00:00Z"),
        ("x" * 64, "2026-09-12T12:00:00+02:00"),
        ("t1", "2026-09-12T10:00:00.123456"),
    ],
)
def test_ids_and_timestamps_at_the_edges_are_accepted(signed_in: SignIn, record_id: str, created_at: str) -> None:
    phone = signed_in(SINGER)
    assert post_sync(phone, records=[item("trial", {"id": record_id, "createdAt": created_at})])["accepted"] == 1


def test_text_that_only_mentions_a_nul_escape_is_accepted(signed_in: SignIn) -> None:
    phone, laptop = signed_in(SINGER), signed_in(SINGER)
    record = sample("phrase", "p1", phraseName="\\u0000 is six characters")
    assert post_sync(phone, records=[item("phrase", record)])["accepted"] == 1
    assert post_sync(laptop)["records"] == [item("phrase", record)]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"cursor": -1},
        {"cursor": 2**63},
        {"cursor": "later"},
        {"cursor": 0, "records": [{"kind": "trial", "record": ["not", "an", "object"]}]},
        {"cursor": 0, "records": [{"kind": 3, "record": {}}]},
        {"cursor": 0, "tombstones": ["not an object"]},
        {"cursor": 0, "records": [item("session", sample("session", "s1"))] * 501},
        {"cursor": 0, "tombstones": [tombstone_for("session", "s1")] * 501},
    ],
)
def test_a_malformed_request_is_422_and_writes_nothing(signed_in: SignIn, body: dict[str, Any]) -> None:
    phone = signed_in(SINGER)
    assert phone.post("/api/sync", json=body).status_code == 422
    assert post_sync(phone) == {**NOTHING, "cursor": 0}


def test_accounts_are_isolated_even_when_client_ids_collide(signed_in: SignIn) -> None:
    alice, bob = signed_in("alice@example.com"), signed_in("bob@example.com")
    alices, bobs = sample("trial", "shared-1", effort=1), sample("trial", "shared-1", effort=5)
    assert post_sync(alice, records=[item("trial", alices)]) == {**NOTHING, "accepted": 1, "cursor": 1}
    assert post_sync(bob, records=[item("trial", bobs)]) == {**NOTHING, "accepted": 1, "cursor": 1}
    deletion = tombstone_for("trial", "shared-1")
    post_sync(bob, cursor=1, tombstones=[deletion])
    assert post_sync(signed_in("alice@example.com")) == {**NOTHING, "records": [item("trial", alices)], "cursor": 1}
    assert post_sync(signed_in("bob@example.com")) == {**NOTHING, "tombstones": [deletion], "cursor": 2}


def test_every_page_names_its_account_as_api_me_does(signed_in: SignIn) -> None:
    """The session cookie is every tab's, so the client applies a page only to the ledger of the account it names."""
    trial = item("trial", sample("trial", "t1"))
    user_ids = []
    for email in ("alice@example.com", "bob@example.com"):
        phone, laptop = signed_in(email), signed_in(email)
        pushed = phone.post("/api/sync", json={"cursor": 0, "records": [trial]}).json()
        pulled = laptop.post("/api/sync", json={"cursor": 0}).json()
        assert pulled["records"] == [trial]
        user_ids.append(laptop.get("/api/me").json()["user"]["id"])
        assert pushed["userId"] == pulled["userId"] == user_ids[-1]
    assert len(set(user_ids)) == 2


def test_each_sync_logs_one_completed_event(signed_in: SignIn, json_logs: Callable[[], list[dict[str, Any]]]) -> None:
    phone = signed_in(SINGER)
    body = json.dumps(
        {
            "cursor": 0,
            "records": [item("trial", sample("trial", "t1")), item("chord", {"id": "c1", "createdAt": AT})],
            "tombstones": [tombstone_for("phrase", "p1")],
        }
    )
    raw_sync(phone, body)
    (line,) = events(json_logs(), "sync.completed")
    counts = ("pushed", "accepted", "rejected", "tombstones_in", "pulled", "tombstones_out", "has_more", "request_bytes")
    assert {key: line[key] for key in counts} == {
        "pushed": 2,
        "accepted": 1,
        "rejected": 1,
        "tombstones_in": 1,
        "pulled": 0,
        "tombstones_out": 1,
        "has_more": False,
        "request_bytes": len(body.encode()),
    }
    assert line["severity"] == "INFO" and line["duration_ms"] >= 0 and line["userId"]


def test_concurrent_syncs_by_one_user_never_share_a_seq(
    make_app: Callable[..., FastAPI], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(middleware, "SYNC_BODIES_AT_ONCE", 4)  # all four at once, rather than some refused as busy
    # Every request shares an in-memory SQLite database's one connection, so this takes a file, or Postgres.
    app = make_app(**({} if TEST_DATABASE_URL else {"database_url": f"sqlite:///{tmp_path / 'vc.db'}"}))
    Base.metadata.create_all(app.state.engine)
    app.state.identity_provider = FakeProvider()
    devices = [TestClient(app) for _ in range(4)]
    for device in devices:
        sign_in(device, SINGER)

    def push(numbered: tuple[int, TestClient]) -> dict[str, Any]:
        number, device = numbered
        return post_sync(device, records=[item("trial", sample("trial", f"d{number}-{index}")) for index in range(100)])

    with ThreadPoolExecutor(len(devices)) as pool:
        results = list(pool.map(push, enumerate(devices)))
    assert sum(result["accepted"] for result in results) == 400
    with app.state.sessions() as session:
        assert sorted(session.scalars(sa.select(Trial.seq))) == list(range(1, 401))
        assert session.scalars(sa.select(User.sync_seq)).one() == 400
