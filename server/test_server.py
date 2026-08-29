"""Server contract tests: magic-code auth, per-user sync, isolation."""

import pytest
from fastapi.testclient import TestClient

from app import create_app


@pytest.fixture()
def client():
    app = create_app(db_url="sqlite://", echo_codes=True)
    with TestClient(app) as c:
        yield c


def sign_in(client, email="alto@example.com"):
    requested = client.post("/auth/request", json={"email": email})
    assert requested.status_code == 200
    code = requested.json()["dev_code"]
    verified = client.post("/auth/verify", json={"email": email, "code": code})
    assert verified.status_code == 200
    return {"Authorization": f"Bearer {verified.json()['token']}"}


def trial(record_id, created="2026-08-20T10:00:00.000Z"):
    return {"id": record_id, "createdAt": created, "finalErrorKind": "success"}


def rng(record_id, created="2026-08-20T10:00:00.000Z"):
    return {"id": record_id, "createdAt": created, "lowMidi": 45.0, "highMidi": 69.0}


class TestAuth:
    def test_request_verify_me_flow(self, client):
        headers = sign_in(client)
        me = client.get("/me", headers=headers)
        assert me.status_code == 200
        assert me.json()["email"] == "alto@example.com"

    def test_wrong_code_rejected(self, client):
        client.post("/auth/request", json={"email": "a@b.c"})
        bad = client.post("/auth/verify", json={"email": "a@b.c", "code": "000000"})
        assert bad.status_code == 401

    def test_code_is_single_use(self, client):
        requested = client.post("/auth/request", json={"email": "a@b.c"})
        code = requested.json()["dev_code"]
        assert client.post("/auth/verify", json={"email": "a@b.c", "code": code}).status_code == 200
        again = client.post("/auth/verify", json={"email": "a@b.c", "code": code})
        assert again.status_code == 401

    def test_expired_code_rejected(self):
        app = create_app(db_url="sqlite://", echo_codes=True, code_ttl_minutes=0)
        with TestClient(app) as client:
            requested = client.post("/auth/request", json={"email": "a@b.c"})
            code = requested.json()["dev_code"]
            expired = client.post("/auth/verify", json={"email": "a@b.c", "code": code})
            assert expired.status_code == 401

    def test_email_case_insensitive(self, client):
        requested = client.post("/auth/request", json={"email": "Alto@Example.com"})
        code = requested.json()["dev_code"]
        verified = client.post("/auth/verify", json={"email": "alto@example.com", "code": code})
        assert verified.status_code == 200


class TestSync:
    def test_sync_requires_auth(self, client):
        assert client.post("/sync", json={"trials": [], "ranges": []}).status_code in (401, 403)

    def test_push_then_pull_from_second_device(self, client):
        device_a = sign_in(client)
        pushed = client.post(
            "/sync", json={"trials": [trial("t1")], "ranges": [rng("r1")]}, headers=device_a
        )
        assert pushed.status_code == 200

        device_b = sign_in(client)  # same email, fresh token
        pulled = client.post("/sync", json={"trials": [], "ranges": []}, headers=device_b)
        body = pulled.json()
        assert [t["id"] for t in body["trials"]] == ["t1"]
        assert [r["id"] for r in body["ranges"]] == ["r1"]

    def test_repush_is_idempotent(self, client):
        headers = sign_in(client)
        for _ in range(2):
            client.post("/sync", json={"trials": [trial("t1")], "ranges": []}, headers=headers)
        body = client.post("/sync", json={"trials": [], "ranges": []}, headers=headers).json()
        assert len(body["trials"]) == 1

    def test_users_are_isolated(self, client):
        alice = sign_in(client, "alice@example.com")
        bob = sign_in(client, "bob@example.com")
        client.post("/sync", json={"trials": [trial("t-alice")], "ranges": []}, headers=alice)
        body = client.post("/sync", json={"trials": [], "ranges": []}, headers=bob).json()
        assert body["trials"] == []

    def test_records_sorted_by_created_at(self, client):
        headers = sign_in(client)
        client.post(
            "/sync",
            json={
                "trials": [trial("t2", "2026-08-21T10:00:00.000Z"), trial("t1", "2026-08-20T10:00:00.000Z")],
                "ranges": [],
            },
            headers=headers,
        )
        body = client.post("/sync", json={"trials": [], "ranges": []}, headers=headers).json()
        assert [t["id"] for t in body["trials"]] == ["t1", "t2"]

    def test_delete_data_clears_only_this_user(self, client):
        alice = sign_in(client, "alice@example.com")
        bob = sign_in(client, "bob@example.com")
        client.post("/sync", json={"trials": [trial("ta")], "ranges": [rng("ra")]}, headers=alice)
        client.post("/sync", json={"trials": [trial("tb")], "ranges": []}, headers=bob)

        deleted = client.delete("/data", headers=alice)
        assert deleted.status_code == 200
        assert deleted.json()["deleted"] == 2

        assert client.post("/sync", json={"trials": [], "ranges": []}, headers=alice).json()["trials"] == []
        assert [t["id"] for t in client.post("/sync", json={"trials": [], "ranges": []}, headers=bob).json()["trials"]] == ["tb"]


class TestCodeEcho:
    def test_codes_not_echoed_when_disabled(self):
        app = create_app(db_url="sqlite://", echo_codes=False)
        with TestClient(app) as client:
            requested = client.post("/auth/request", json={"email": "a@b.c"})
            assert requested.status_code == 200
            assert "dev_code" not in requested.json()


class TestHealth:
    def test_root_reports_alive_without_auth(self, client):
        response = client.get("/")
        assert response.status_code == 200
        body = response.json()
        assert body["app"] == "vocal-compass-sync"
        assert body["ok"] is True

    def test_root_leaks_no_secrets(self, client):
        client.post("/auth/request", json={"email": "a@b.c"})
        assert "code" not in client.get("/").text.lower()


class TestSessionSync:
    def test_sessions_round_trip(self, client):
        headers = sign_in(client)
        pushed = client.post(
            "/sync",
            json={"trials": [], "ranges": [], "sessions": [
                {"id": "x1", "createdAt": "2026-09-01T10:00:00.000Z", "planId": "vfe", "stepsCompleted": 4}
            ]},
            headers=headers,
        )
        assert pushed.status_code == 200
        assert [s["id"] for s in pushed.json()["sessions"]] == ["x1"]

    def test_old_clients_without_sessions_field_still_sync(self, client):
        headers = sign_in(client)
        response = client.post("/sync", json={"trials": [trial("t1")], "ranges": []}, headers=headers)
        assert response.status_code == 200
        assert response.json()["sessions"] == []


def stone(record_id, stone_id="st1"):
    return {"id": stone_id, "createdAt": "2026-09-02T00:00:00.000Z", "kind": "trial", "recordId": record_id}


class TestTombstones:
    def test_tombstone_deletes_the_record_serverside(self, client):
        headers = sign_in(client)
        client.post("/sync", json={"trials": [trial("t1"), trial("t2")], "ranges": []}, headers=headers)
        body = client.post(
            "/sync", json={"trials": [], "ranges": [], "tombstones": [stone("t1")]}, headers=headers
        ).json()
        assert [t["id"] for t in body["trials"]] == ["t2"]
        assert [s["recordId"] for s in body["tombstones"]] == ["t1"]

    def test_dead_record_cannot_be_repushed(self, client):
        headers = sign_in(client)
        client.post("/sync", json={"trials": [], "ranges": [], "tombstones": [stone("t1")]}, headers=headers)
        body = client.post("/sync", json={"trials": [trial("t1")], "ranges": []}, headers=headers).json()
        assert body["trials"] == []

    def test_second_device_receives_the_tombstone(self, client):
        device_a = sign_in(client)
        client.post("/sync", json={"trials": [trial("t1")], "ranges": []}, headers=device_a)
        client.post("/sync", json={"trials": [], "ranges": [], "tombstones": [stone("t1")]}, headers=device_a)
        device_b = sign_in(client)
        body = client.post("/sync", json={"trials": [], "ranges": []}, headers=device_b).json()
        assert body["trials"] == []
        assert [s["recordId"] for s in body["tombstones"]] == ["t1"]

    def test_tombstones_are_user_scoped(self, client):
        alice = sign_in(client, "alice@example.com")
        bob = sign_in(client, "bob@example.com")
        client.post("/sync", json={"trials": [trial("t1")], "ranges": []}, headers=bob)
        client.post("/sync", json={"trials": [], "ranges": [], "tombstones": [stone("t1")]}, headers=alice)
        body = client.post("/sync", json={"trials": [], "ranges": []}, headers=bob).json()
        assert [t["id"] for t in body["trials"]] == ["t1"]
