"""Initial schema: users, the four synced record kinds, and on Postgres the trace_frame view.

Revision ID: 0001
Revises:
Create Date: 2026-09-12
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LABEL = 32
NAME = 128
# Kinds whose client records carry a pitch trace, as (client kind, table).
TRACED_KINDS = (("trial", "trial"), ("range", "range_measurement"), ("phrase", "phrase_attempt"))
FRAME_FIELDS = ("t", "midi", "clarity", "rms")


def upgrade() -> None:
    op.create_table(
        "user",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workos_user_id", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("sync_seq", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user")),
        sa.UniqueConstraint("email", name=op.f("uq_user_email")),
        sa.UniqueConstraint("workos_user_id", name=op.f("uq_user_workos_user_id")),
    )
    _create_record_table(
        "trial",
        sa.Column("exercise_id", sa.String(NAME), nullable=True),
        sa.Column("feedback_mode", sa.String(LABEL), nullable=True),
        sa.Column("key_tonic_midi", sa.Integer(), nullable=True),
        sa.Column("target_midi", sa.Double(), nullable=True),
        sa.Column("selected_midi", sa.Double(), nullable=True),
        sa.Column("delay_ms", sa.Integer(), nullable=True),
        sa.Column("load", sa.String(LABEL), nullable=True),
        sa.Column("scored", sa.Boolean(), nullable=True),
        sa.Column("destination_match", sa.Boolean(), nullable=True),
        sa.Column("target_error_cents", sa.Double(), nullable=True),
        sa.Column("residual_cents", sa.Double(), nullable=True),
        sa.Column("stability_cents", sa.Double(), nullable=True),
        sa.Column("search_transitions", sa.Integer(), nullable=True),
        sa.Column("hint_level", sa.Integer(), nullable=True),
        sa.Column("lost_event", sa.Boolean(), nullable=True),
        sa.Column("final_error_kind", sa.String(LABEL), nullable=True),
        sa.Column("selection_latency_ms", sa.Double(), nullable=True),
        sa.Column("recovery_time_ms", sa.Double(), nullable=True),
        sa.Column("confidence_before", sa.Integer(), nullable=True),
        sa.Column("effort", sa.Integer(), nullable=True),
        sa.Column("register", sa.String(LABEL), nullable=True),
        sa.Column("detector_confidence", sa.Double(), nullable=True),
    )
    op.create_index(op.f("ix_trial_target_midi"), "trial", ["target_midi"])
    op.create_index(op.f("ix_trial_final_error_kind"), "trial", ["final_error_kind"])
    _create_record_table(
        "range_measurement",
        sa.Column("low_midi", sa.Double(), nullable=True),
        sa.Column("high_midi", sa.Double(), nullable=True),
        sa.Column("method", sa.String(LABEL), nullable=True),
        sa.Column("mic_low_cut", sa.String(LABEL), nullable=True),
    )
    _create_record_table(
        "exercise_session",
        sa.Column("plan_id", sa.String(NAME), nullable=True),
        sa.Column("steps_completed", sa.Integer(), nullable=True),
    )
    _create_record_table(
        "phrase_attempt",
        sa.Column("phrase_id", sa.String(NAME), nullable=True),
        sa.Column("phrase_name", sa.String(NAME), nullable=True),
        sa.Column("level", sa.Integer(), nullable=True),
        sa.Column("key_tonic_midi", sa.Integer(), nullable=True),
        sa.Column("bpm", sa.Double(), nullable=True),
        sa.Column("role", sa.String(LABEL), nullable=True),
        sa.Column("guide", sa.String(LABEL), nullable=True),
        sa.Column("verified", sa.Boolean(), nullable=True),
        sa.Column("hits", sa.Integer(), nullable=True),
        sa.Column("misses", sa.Integer(), nullable=True),
        sa.Column("extras", sa.Integer(), nullable=True),
        sa.Column("sequence_accuracy", sa.Double(), nullable=True),
        sa.Column("mean_abs_onset_ms", sa.Double(), nullable=True),
        sa.Column("landing_hit", sa.Boolean(), nullable=True),
    )
    op.create_index(op.f("ix_phrase_attempt_phrase_id"), "phrase_attempt", ["phrase_id"])
    op.create_index(op.f("ix_phrase_attempt_verified"), "phrase_attempt", ["verified"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute(_trace_frame_view())


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP VIEW trace_frame")
    for table in ("phrase_attempt", "exercise_session", "range_measurement", "trial", "user"):
        op.drop_table(table)


def _create_record_table(table: str, *typed_columns: sa.Column[Any]) -> None:
    """A kind table: the SyncedRecord columns and constraints as of this revision, then the kind's own columns."""
    op.create_table(
        table,
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deletion_id", sa.String(64), nullable=True),
        *typed_columns,
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], name=op.f(f"fk_{table}_user_id_user"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "id", name=op.f(f"pk_{table}")),
        sa.UniqueConstraint("user_id", "seq", name=op.f(f"uq_{table}_user_id_seq")),
    )
    op.create_index(op.f(f"ix_{table}_user_id_created_at"), table, ["user_id", "created_at"])


def _trace_frame_view() -> str:
    """One row per pitch frame of every live traced record, for frame-level SQL.

    Built on jsonb_array_elements with type guards rather than
    jsonb_to_recordset, which raises on a non-array trace, a non-object frame,
    or a non-numeric field: one malformed client record would then break the
    view for every query. Such input yields no rows or NULLs instead. Numeric,
    not double precision, because any JSON number casts to it without error.
    """
    fields = ", ".join(
        f"CASE WHEN jsonb_typeof(frame -> '{field}') = 'number' THEN (frame ->> '{field}')::numeric END AS {field}"
        for field in FRAME_FIELDS
    )
    selects = [
        f"""SELECT r.user_id, '{kind}'::text AS kind, r.id AS record_id, r.created_at, {fields}
FROM {table} AS r
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.payload -> 'trace') = 'array' THEN r.payload -> 'trace' ELSE '[]'::jsonb END
) AS frame
WHERE r.deleted_at IS NULL AND jsonb_typeof(frame) = 'object'"""
        for kind, table in TRACED_KINDS
    ]
    return "CREATE VIEW trace_frame AS\n" + "\nUNION ALL\n".join(selects)
