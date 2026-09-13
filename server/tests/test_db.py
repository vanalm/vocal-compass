"""Engine construction per backend, and the per-request session dependency."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from pathlib import Path

import pytest
import sqlalchemy as sa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlalchemy.pool import QueuePool, StaticPool

from support import make_settings
from vocal_compass.db import get_session, make_engine
from vocal_compass.models import User


def test_postgres_engines_fit_the_cloud_sql_connection_budget() -> None:
    engine = make_engine(make_settings(database_url="postgresql+psycopg://vocal:pw@/vocal?host=/cloudsql/p:r:i"))
    try:
        assert isinstance(engine.pool, QueuePool)
        assert engine.pool.size() == 4
        assert (engine.pool._max_overflow, engine.pool._pre_ping, engine.pool._recycle) == (2, True, 1800)
        assert engine.hide_parameters
    finally:
        engine.dispose()


def test_sqlite_engines_enforce_foreign_keys_and_memory_shares_one_connection(tmp_path: Path) -> None:
    memory = make_engine(make_settings(database_url="sqlite://"))
    file = make_engine(make_settings(database_url=f"sqlite:///{tmp_path / 'vc.db'}"))
    try:
        assert isinstance(memory.pool, StaticPool)
        assert not isinstance(file.pool, StaticPool)
        for engine in (memory, file):
            assert engine.hide_parameters
            with engine.connect() as connection:
                assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
    finally:
        memory.dispose()
        file.dispose()


def test_a_sqlite_transaction_holds_the_write_lock_from_its_first_statement(tmp_path: Path) -> None:
    """SQLite ignores FOR UPDATE; this is what stops two syncs by one user reading the same sync_seq."""
    path = tmp_path / "vc.db"
    engine = make_engine(make_settings(database_url=f"sqlite:///{path}"))
    other = sqlite3.connect(path, timeout=0, isolation_level=None)
    try:
        with engine.connect() as reader:
            reader.exec_driver_sql("SELECT 1")
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                other.execute("BEGIN IMMEDIATE")
        other.execute("BEGIN IMMEDIATE")  # released once the reader's transaction ends
        other.execute("ROLLBACK")
    finally:
        other.close()
        engine.dispose()


def test_each_request_gets_a_session_that_rolls_back_unless_committed(make_app: Callable[..., FastAPI]) -> None:
    app = make_app()

    def add_user(email: str, commit: bool = False, session: Session = Depends(get_session)) -> dict[str, str]:
        session.add(User(email=email))
        session.flush()
        if commit:
            session.commit()
        return {}

    def count_users(session: Session = Depends(get_session)) -> dict[str, int]:
        return {"users": session.scalar(sa.select(sa.func.count()).select_from(User)) or 0}

    app.add_api_route("/api/users", add_user, methods=["POST"])
    app.add_api_route("/api/users", count_users, methods=["GET"])
    with TestClient(app) as client:
        client.post("/api/users", params={"email": "dropped@example.com"})
        assert client.get("/api/users").json() == {"users": 0}
        client.post("/api/users", params={"email": "kept@example.com", "commit": True})
        assert client.get("/api/users").json() == {"users": 1}
