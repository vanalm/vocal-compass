"""The migrations build exactly the schema the models describe: on fresh SQLite always, on Postgres with TEST_DATABASE_URL."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from support import TEST_DATABASE_URL, alembic_config, empty_tables, postgres_only
from vocal_compass.models import Base, PhraseAttempt, RangeMeasurement, Trial, User
from vocal_compass.settings import Settings

def schema_diff(connection: sa.Connection) -> list[Any]:
    diff: list[Any] = compare_metadata(MigrationContext.configure(connection, opts={"compare_type": True}), Base.metadata)
    return diff


@pytest.fixture
def sqlite_file(tmp_path: Path) -> Iterator[sa.Engine]:
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    yield engine
    engine.dispose()


def test_upgrade_head_on_fresh_sqlite_matches_the_models(sqlite_file: sa.Engine) -> None:
    with sqlite_file.begin() as connection:
        command.upgrade(alembic_config(connection), "head")
    with sqlite_file.connect() as connection:
        assert schema_diff(connection) == []


def test_downgrade_to_base_removes_everything(sqlite_file: sa.Engine) -> None:
    with sqlite_file.begin() as connection:
        command.upgrade(alembic_config(connection), "head")
        command.downgrade(alembic_config(connection), "base")
    with sqlite_file.connect() as connection:
        assert sa.inspect(connection).get_table_names() == ["alembic_version"]


def test_alembic_reads_the_database_url_from_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    database = tmp_path / "from-environment.db"
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database}")
    command.upgrade(alembic_config(), "head")
    engine = sa.create_engine(f"sqlite:///{database}")
    try:
        with engine.connect() as connection:
            assert schema_diff(connection) == []
    finally:
        engine.dispose()


@postgres_only
def test_migrated_postgres_matches_the_models() -> None:
    engine = sa.create_engine(TEST_DATABASE_URL)
    try:
        with engine.connect() as connection:
            assert schema_diff(connection) == []
    finally:
        engine.dispose()


@postgres_only
def test_trace_frame_view_flattens_live_traces_and_tolerates_malformed_ones() -> None:
    now = sa.func.now()
    user_id = uuid.uuid4()

    def row(model: Any, record_id: str, seq: int, payload: dict[str, Any], deleted: bool = False) -> Any:
        return sa.insert(model).values(
            user_id=user_id, id=record_id, seq=seq, created_at=now, recorded_at=now, payload=payload,
            deleted_at=now if deleted else None,
        )

    engine = sa.create_engine(TEST_DATABASE_URL)
    try:
        with engine.begin() as connection:
            connection.execute(
                sa.insert(User).values(id=user_id, email="trace@example.com", sync_seq=0, created_at=now, last_seen_at=now)
            )
            connection.execute(
                row(Trial, "t1", 1, {"trace": [{"t": 0, "midi": 60.5, "clarity": 0.9, "rms": 0.1}, {"t": 70, "midi": "high", "clarity": 0.8}, "garbage", 5]})
            )
            connection.execute(row(Trial, "t2", 2, {"trace": [{"t": 0, "midi": 61, "clarity": 1, "rms": 0}]}, deleted=True))
            connection.execute(row(RangeMeasurement, "r1", 3, {"trace": "not-an-array"}))
            connection.execute(row(PhraseAttempt, "p1", 4, {"trace": [{"t": 1, "midi": 62, "clarity": 1, "rms": 0.2}]}))
            frames = connection.execute(
                sa.text(
                    "SELECT kind, record_id, t, midi, clarity, rms FROM trace_frame"
                    " WHERE user_id = :user_id ORDER BY kind, record_id, t"
                ),
                {"user_id": user_id},
            ).all()
        as_floats = [(kind, record_id, *(None if v is None else float(v) for v in values)) for kind, record_id, *values in frames]
        assert as_floats == [
            ("phrase", "p1", 1.0, 62.0, 1.0, 0.2),
            ("trial", "t1", 0.0, 60.5, 0.9, 0.1),
            ("trial", "t1", 70.0, None, 0.8, None),
        ]
    finally:
        empty_tables(engine)
        engine.dispose()
