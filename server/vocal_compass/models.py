"""ORM models: users, and one table per synced record kind.

Each kind table stores the exact client record in `payload` (a pull returns it
verbatim) plus typed copies of the fields worth aggregating, which
records.KINDS extracts. Adding a kind is one model here, one registry entry,
and one migration.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column, validates

from .db import JSONDocument, UTCDateTime, utcnow

# Typed text columns are bounded, so a hostile client cannot bloat an index; longer values extract as NULL.
LABEL = 32  # a closed client vocabulary: modes, kinds, roles
NAME = 128  # free identifiers and display names


class Base(DeclarativeBase):
    # Deterministic constraint names, so later migrations can address what they alter.
    metadata = sa.MetaData(
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_N_name)s",
            "uq": "uq_%(table_name)s_%(column_0_N_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )
    type_annotation_map = {datetime: UTCDateTime(), float: sa.Double()}


class User(Base):
    __tablename__ = "user"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workos_user_id: Mapped[str | None] = mapped_column(unique=True)
    email: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str | None]
    # The last seq handed to any of this user's rows; bumped under the user row lock.
    sync_seq: Mapped[int] = mapped_column(sa.BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)

    @validates("email")
    def _normalise_email(self, _key: str, email: str) -> str:
        return email.strip().lower()


class SyncedRecord:
    """The columns and constraints every synced kind shares.

    `created_at` is the client's clock (when the singer did it); `recorded_at`
    is the server's. `seq` orders a user's rows for incremental pull. A deleted
    record keeps its row, payload nulled and `deleted_at` set, so no later push
    can resurrect it.
    """

    if TYPE_CHECKING:
        # What DeclarativeBase gives each mapped kind, declared for type checkers: the mixin itself is never mapped.
        def __init__(self, **kwargs: Any) -> None: ...

    user_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("user.id", ondelete="CASCADE"))
    id: Mapped[str] = mapped_column(sa.String(64))
    seq: Mapped[int] = mapped_column(sa.BigInteger)
    created_at: Mapped[datetime]
    recorded_at: Mapped[datetime] = mapped_column(default=utcnow)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONDocument)
    deleted_at: Mapped[datetime | None]
    deletion_id: Mapped[str | None] = mapped_column(sa.String(64))

    @declared_attr.directive
    def __table_args__(cls) -> tuple[Any, ...]:
        return (
            sa.PrimaryKeyConstraint("user_id", "id"),
            sa.UniqueConstraint("user_id", "seq"),
            sa.Index(f"ix_{cls.__tablename__}_user_id_created_at", "user_id", "created_at"),  # type: ignore[attr-defined]
        )


class Trial(SyncedRecord, Base):
    """One sung attempt at a destination note: the client's TrialRecord."""

    __tablename__ = "trial"

    exercise_id: Mapped[str | None] = mapped_column(sa.String(NAME))
    feedback_mode: Mapped[str | None] = mapped_column(sa.String(LABEL))
    key_tonic_midi: Mapped[int | None]
    target_midi: Mapped[float | None] = mapped_column(index=True)
    selected_midi: Mapped[float | None]
    delay_ms: Mapped[int | None]
    load: Mapped[str | None] = mapped_column(sa.String(LABEL))
    scored: Mapped[bool | None]
    destination_match: Mapped[bool | None]
    target_error_cents: Mapped[float | None]
    residual_cents: Mapped[float | None]
    stability_cents: Mapped[float | None]
    search_transitions: Mapped[int | None]
    hint_level: Mapped[int | None]
    lost_event: Mapped[bool | None]
    final_error_kind: Mapped[str | None] = mapped_column(sa.String(LABEL), index=True)
    selection_latency_ms: Mapped[float | None]
    recovery_time_ms: Mapped[float | None]
    confidence_before: Mapped[int | None]
    effort: Mapped[int | None]
    register: Mapped[str | None] = mapped_column(sa.String(LABEL))
    detector_confidence: Mapped[float | None]


class RangeMeasurement(SyncedRecord, Base):
    """One measured vocal range: the client's RangeMeasurement."""

    __tablename__ = "range_measurement"

    low_midi: Mapped[float | None]
    high_midi: Mapped[float | None]
    method: Mapped[str | None] = mapped_column(sa.String(LABEL))
    mic_low_cut: Mapped[str | None] = mapped_column(sa.String(LABEL))


class ExerciseSession(SyncedRecord, Base):
    """One completed guided exercise run: the client's ExerciseSession."""

    __tablename__ = "exercise_session"

    plan_id: Mapped[str | None] = mapped_column(sa.String(NAME))
    steps_completed: Mapped[int | None]


class PhraseAttempt(SyncedRecord, Base):
    """One scored phrase attempt: the client's PhraseRecord."""

    __tablename__ = "phrase_attempt"

    phrase_id: Mapped[str | None] = mapped_column(sa.String(NAME), index=True)
    phrase_name: Mapped[str | None] = mapped_column(sa.String(NAME))
    level: Mapped[int | None]
    key_tonic_midi: Mapped[int | None]
    bpm: Mapped[float | None]
    role: Mapped[str | None] = mapped_column(sa.String(LABEL))
    guide: Mapped[str | None] = mapped_column(sa.String(LABEL))
    verified: Mapped[bool | None] = mapped_column(index=True)
    hits: Mapped[int | None]
    misses: Mapped[int | None]
    extras: Mapped[int | None]
    sequence_accuracy: Mapped[float | None]
    mean_abs_onset_ms: Mapped[float | None]
    landing_hit: Mapped[bool | None]
