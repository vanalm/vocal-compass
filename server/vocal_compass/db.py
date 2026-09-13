"""Database engine, sessions, migrations, and the column types that behave alike on SQLite and Postgres.

Production runs Postgres; tests and laptops may run SQLite. The two differ
where it hurts: SQLite drops timezone offsets, has no JSONB, ignores foreign
keys unless asked, and locks nothing until a transaction first writes.
Everything here closes exactly those gaps, so models, migrations and the sync
handler's locking are written once.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from fastapi import Request
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from .settings import Settings

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"
# none_as_null: a Python None stores SQL NULL (a tombstone has no payload), not the JSON text 'null'.
JSONDocument = sa.JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(sa.TypeDecorator[datetime]):
    """A timestamptz that always binds and returns timezone-aware UTC.

    SQLite stores no offset and hands back naive values; normalising both ways
    keeps comparisons identical across backends. Naive input is refused rather
    than guessed at.
    """

    impl = sa.DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: sa.Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError(f"naive datetime {value!r}; pass a timezone-aware one")
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: sa.Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def make_engine(settings: Settings) -> sa.Engine:
    """The engine DATABASE_URL names.

    Its errors never quote a statement's bound values, so a failed statement
    cannot carry an email or a record payload into an ERROR log line.
    """
    url = sa.make_url(settings.database_url.get_secret_value())
    if url.get_backend_name() == "sqlite":
        # An in-memory database lives only as long as its connection, so every session must share one.
        pool: dict[str, Any] = {"poolclass": StaticPool} if url.database in (None, "", ":memory:") else {}
        engine = sa.create_engine(url, connect_args={"check_same_thread": False}, hide_parameters=True, **pool)
        sa.event.listen(engine, "connect", _configure_sqlite)
        sa.event.listen(engine, "begin", _begin_immediate)
        return engine
    # db-f1-micro allows ~25 connections: 3 instances x (4 + 2 overflow) = 18 leaves room for
    # migrations and an operator's psql. A dead database should fail readiness fast, not hang it.
    return sa.create_engine(
        url,
        pool_size=4,
        max_overflow=2,
        pool_pre_ping=True,
        pool_recycle=1800,
        hide_parameters=True,
        connect_args={"connect_timeout": 5},
    )


def migrate(engine: sa.Engine) -> None:
    """Upgrade the database to the newest migration as `alembic upgrade head` does: through migrations/env.py, under its lock."""
    config = Config(str(ALEMBIC_INI))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def _configure_sqlite(dbapi_connection: Any, _record: Any) -> None:
    # SQLite honours ON DELETE CASCADE only when enabled, per connection.
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
    # The driver would begin a transaction only at its first write; _begin_immediate begins every one instead.
    dbapi_connection.isolation_level = None


def _begin_immediate(connection: sa.Connection) -> None:
    """Begin each SQLite transaction holding the database's write lock.

    SQLite ignores FOR UPDATE, so otherwise two syncs by one user could both
    read the same sync_seq before either writes. Locking at the first statement
    queues them instead, as the user row lock does on Postgres. A laptop's
    database loses nothing by running one transaction at a time.
    """
    connection.exec_driver_sql("BEGIN IMMEDIATE")


def get_session(request: Request) -> Iterator[Session]:
    """FastAPI dependency: one session per request, rolled back unless the handler commits."""
    with request.app.state.sessions() as session:
        yield session
