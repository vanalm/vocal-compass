"""The registry of synced record kinds: where each client kind is stored, and how its typed columns are read.

Extraction is tolerant by design. The payload is stored verbatim and is the
truth; typed columns are an analytics convenience, so a field that is missing,
mistyped, or outside its column's range becomes NULL instead of rejecting the
record. Coercion follows each column's SQL type, so the model stays the single
statement of what a column holds.
"""

from __future__ import annotations

import inspect
import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any

import sqlalchemy as sa

from .models import ExerciseSession, PhraseAttempt, RangeMeasurement, SyncedRecord, Trial

SHARED_COLUMNS = frozenset(inspect.get_annotations(SyncedRecord))
_INT32 = range(-(2**31), 2**31)


@dataclass(frozen=True)
class Kind:
    """One client record kind.

    `columns` maps every typed column of `model` to its dotted path in the
    client record; construction fails unless it covers exactly those columns.
    """

    name: str  # the client's SyncRecordKind
    export_key: str  # the list holding this kind in the client's ExportPayload
    model: type[SyncedRecord]
    columns: Mapping[str, str]

    def __post_init__(self) -> None:
        table = self.model.__table__  # type: ignore[attr-defined]
        typed = {column.name for column in table.columns} - SHARED_COLUMNS
        if mismatched := sorted(typed.symmetric_difference(self.columns)):
            raise ValueError(f"kind {self.name!r} and table {table.name!r} disagree on columns {mismatched}")
        for name in typed:
            column_type = table.c[name].type
            if not isinstance(column_type, (sa.Boolean, sa.Integer, sa.Float, sa.String)) or (
                isinstance(column_type, sa.String) and not column_type.length
            ):
                raise TypeError(f"{table.name}.{name}: typed columns must be Boolean, Integer, Float, or bounded String")

    def extract(self, record: Mapping[str, Any]) -> dict[str, Any]:
        """Typed column values for one client record; NULL wherever the record disagrees with the column."""
        table = self.model.__table__  # type: ignore[attr-defined]
        return {column: _coerce(_lookup(record, path), table.c[column].type) for column, path in self.columns.items()}


def _lookup(record: Mapping[str, Any], path: str) -> Any:
    value: Any = record
    for key in path.split("."):
        if not isinstance(value, Mapping):
            return None
        value = value.get(key)
    return value


def _coerce(value: Any, column_type: sa.types.TypeEngine[Any]) -> Any:
    # bool is an int subclass in Python but never a number in the client's JSON.
    if isinstance(column_type, sa.Boolean):
        return value if isinstance(value, bool) else None
    if isinstance(column_type, sa.Integer):
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        return value if type(value) is int and value in _INT32 else None
    if isinstance(column_type, sa.Float):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        try:
            number = float(value)
        except OverflowError:
            return None
        return number if math.isfinite(number) else None
    return value if isinstance(value, str) and len(value) <= column_type.length else None  # type: ignore[attr-defined]


def client_timestamp(moment: datetime) -> str:
    """A timestamp as the client writes one (JavaScript's toISOString), so string order stays time order."""
    return moment.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def tombstone(kind: str, record_id: str, deletion_id: str | None, deleted_at: datetime) -> dict[str, Any]:
    """A deleted row in the client's Tombstone shape: the deletion's own id and time, and the record it removed."""
    return {"id": deletion_id, "createdAt": client_timestamp(deleted_at), "kind": kind, "recordId": record_id}


KINDS: Mapping[str, Kind] = MappingProxyType(
    {
        kind.name: kind
        for kind in (
            Kind(
                "trial",
                "trials",
                Trial,
                {
                    "exercise_id": "definition.exerciseId",
                    "feedback_mode": "feedbackMode",
                    "key_tonic_midi": "definition.tonicMidi",
                    "target_midi": "definition.targetMidi",
                    "selected_midi": "selectedMidi",
                    "delay_ms": "definition.delayMs",
                    "load": "definition.load",
                    "scored": "scored",
                    "destination_match": "destinationMatch",
                    "target_error_cents": "targetErrorCents",
                    "residual_cents": "residualToSelectedCents",
                    "stability_cents": "stabilityCents",
                    "search_transitions": "searchTransitions",
                    "hint_level": "hintLevel",
                    "lost_event": "lostEvent",
                    "final_error_kind": "finalErrorKind",
                    "selection_latency_ms": "selectionLatencyMs",
                    "recovery_time_ms": "recoveryTimeMs",
                    "confidence_before": "confidenceBefore",
                    "effort": "effort",
                    "register": "register",
                    "detector_confidence": "detectorConfidence",
                },
            ),
            Kind(
                "range",
                "ranges",
                RangeMeasurement,
                {"low_midi": "lowMidi", "high_midi": "highMidi", "method": "method", "mic_low_cut": "micLowCut"},
            ),
            Kind(
                "session",
                "sessions",
                ExerciseSession,
                {"plan_id": "planId", "steps_completed": "stepsCompleted"},
            ),
            Kind(
                "phrase",
                "phrases",
                PhraseAttempt,
                {
                    "phrase_id": "phraseId",
                    "phrase_name": "phraseName",
                    "level": "level",
                    "key_tonic_midi": "keyTonicMidi",
                    "bpm": "bpm",
                    "role": "role",
                    "guide": "guide",
                    "verified": "verified",
                    "hits": "hits",
                    "misses": "misses",
                    "extras": "extras",
                    "sequence_accuracy": "sequenceAccuracy",
                    "mean_abs_onset_ms": "meanAbsOnsetMs",
                    "landing_hit": "landingHit",
                },
            ),
        )
    }
)
