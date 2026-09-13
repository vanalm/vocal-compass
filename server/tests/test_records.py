"""The kind registry's tolerant extraction, and the models' behaviour against a real database."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi import FastAPI

from support import PHRASE, TRIAL
from vocal_compass.models import ExerciseSession, RangeMeasurement, Trial, User
from vocal_compass.records import KINDS, Kind

NOW = datetime(2026, 9, 12, 10, 0, tzinfo=UTC)


def test_trial_columns_come_from_the_client_record() -> None:
    assert KINDS["trial"].extract(TRIAL) == {
        "exercise_id": "degree-leap",
        "feedback_mode": "blind",
        "key_tonic_midi": 60,
        "target_midi": 67.0,
        "selected_midi": 67.0,
        "delay_ms": 1500,
        "load": "neutral",
        "scored": True,
        "destination_match": True,
        "target_error_cents": -12.5,
        "residual_cents": -12.5,
        "stability_cents": 8.25,
        "search_transitions": 1,
        "hint_level": 0,
        "lost_event": False,
        "final_error_kind": "success",
        "selection_latency_ms": 412.7,
        "recovery_time_ms": None,
        "confidence_before": 4,
        "effort": 2,
        "register": "chest",
        "detector_confidence": 0.93,
    }


def test_phrase_range_and_session_columns_come_from_their_records() -> None:
    assert KINDS["phrase"].extract(PHRASE) == {
        "phrase_id": "l1-arc-13531",
        "phrase_name": "Arc 1-3-5-3-1",
        "level": 1,
        "key_tonic_midi": 57,
        "bpm": 90.0,
        "role": "melody",
        "guide": "none",
        "verified": True,
        "hits": 4,
        "misses": 1,
        "extras": 0,
        "sequence_accuracy": 0.8,
        "mean_abs_onset_ms": 63.5,
        "landing_hit": True,
    }
    assert KINDS["range"].extract({"id": "r1", "lowMidi": 45.3, "highMidi": 69, "method": "guided-turns", "micLowCut": "80"}) == {
        "low_midi": 45.3,
        "high_midi": 69.0,
        "method": "guided-turns",
        "mic_low_cut": "80",
    }
    # Fields older clients never sent are simply NULL.
    assert KINDS["range"].extract({"id": "r0", "lowMidi": 45, "highMidi": 69})["method"] is None
    assert KINDS["session"].extract({"planId": "vfe", "stepsCompleted": 4}) == {"plan_id": "vfe", "steps_completed": 4}


@pytest.mark.parametrize(
    ("column", "field", "value", "expected"),
    [
        ("hint_level", "hintLevel", 2.0, 2),
        ("hint_level", "hintLevel", 2.5, None),
        ("hint_level", "hintLevel", True, None),
        ("hint_level", "hintLevel", "2", None),
        ("hint_level", "hintLevel", 2**31, None),
        ("hint_level", "hintLevel", -(2**31), -(2**31)),
        ("selected_midi", "selectedMidi", 10**400, None),
        ("selected_midi", "selectedMidi", float("inf"), None),
        ("selected_midi", "selectedMidi", float("nan"), None),
        ("selected_midi", "selectedMidi", False, None),
        ("selected_midi", "selectedMidi", "67", None),
        ("scored", "scored", 1, None),
        ("scored", "scored", False, False),
        ("feedback_mode", "feedbackMode", "x" * 32, "x" * 32),
        ("feedback_mode", "feedbackMode", "x" * 33, None),
        ("feedback_mode", "feedbackMode", ["blind"], None),
    ],
)
def test_ill_typed_fields_become_null(column: str, field: str, value: Any, expected: Any) -> None:
    extracted = KINDS["trial"].extract({**TRIAL, field: value})[column]
    assert extracted == expected and type(extracted) is type(expected)


@pytest.mark.parametrize("definition", ["not-an-object", None, [1, 2]])
def test_nested_paths_through_a_non_object_become_null(definition: Any) -> None:
    extracted = KINDS["trial"].extract({**TRIAL, "definition": definition})
    assert extracted["exercise_id"] is extracted["key_tonic_midi"] is extracted["delay_ms"] is None


def test_an_empty_record_extracts_all_nulls() -> None:
    for kind in KINDS.values():
        assert set(kind.extract({}).values()) == {None}


def test_a_kind_must_cover_exactly_its_tables_typed_columns() -> None:
    with pytest.raises(ValueError, match="steps_completed"):
        Kind("session", "sessions", ExerciseSession, {"plan_id": "planId"})
    with pytest.raises(ValueError, match="bogus"):
        Kind("session", "sessions", ExerciseSession, {"plan_id": "planId", "steps_completed": "stepsCompleted", "bogus": "x"})


def test_kinds_match_the_client_vocabulary() -> None:
    assert {kind.name: kind.export_key for kind in KINDS.values()} == {
        "trial": "trials",
        "range": "ranges",
        "session": "sessions",
        "phrase": "phrases",
    }


def test_records_round_trip_with_their_payload_and_utc_timestamps(app: FastAPI) -> None:
    kind = KINDS["trial"]
    created = datetime(2026, 9, 12, 3, 0, tzinfo=timezone(timedelta(hours=-7)))
    with app.state.sessions() as session:
        user = User(email="  Alto@Example.COM ")
        session.add(user)
        session.flush()
        user_id = user.id
        session.add(kind.model(user_id=user_id, id=TRIAL["id"], seq=1, created_at=created, payload=TRIAL, **kind.extract(TRIAL)))
        session.commit()
    with app.state.sessions() as session:
        row = session.get(Trial, (user_id, TRIAL["id"]))
        assert row is not None
        assert row.payload == TRIAL
        assert (row.target_midi, row.final_error_kind, row.deleted_at) == (67.0, "success", None)
        assert row.created_at == created and row.created_at.tzinfo is UTC
        assert row.recorded_at.tzinfo is UTC
        stored_user = session.get(User, user_id)
        assert stored_user is not None
        assert (stored_user.email, stored_user.sync_seq) == ("alto@example.com", 0)


def test_naive_timestamps_are_refused(app: FastAPI) -> None:
    with app.state.sessions() as session:
        user = User(email="naive@example.com")
        session.add(user)
        session.flush()
        session.add(RangeMeasurement(user_id=user.id, id="r1", seq=1, created_at=datetime(2026, 9, 12, 10, 0)))
        with pytest.raises(sa.exc.StatementError, match="naive datetime"):
            session.flush()


def test_seq_is_unique_per_user_not_globally(app: FastAPI) -> None:
    with app.state.sessions() as session:
        alice, bob = User(email="alice@example.com"), User(email="bob@example.com")
        session.add_all([alice, bob])
        session.flush()
        session.add_all(
            [
                ExerciseSession(user_id=alice.id, id="a1", seq=1, created_at=NOW),
                ExerciseSession(user_id=bob.id, id="b1", seq=1, created_at=NOW),
            ]
        )
        session.flush()
        session.add(ExerciseSession(user_id=alice.id, id="a2", seq=1, created_at=NOW))
        with pytest.raises(sa.exc.IntegrityError):
            session.flush()


def test_deleting_a_user_cascades_to_every_kind(app: FastAPI) -> None:
    with app.state.sessions() as session:
        user = User(email="leaving@example.com")
        session.add(user)
        session.flush()
        user_id = user.id
        for seq, kind in enumerate(KINDS.values(), start=1):
            session.add(kind.model(user_id=user_id, id=f"{kind.name}-1", seq=seq, created_at=NOW, payload={}))
        session.commit()
    with app.state.sessions() as session:
        session.execute(sa.delete(User).where(User.id == user_id))
        session.commit()
        for kind in KINDS.values():
            assert session.scalar(sa.select(sa.func.count()).select_from(kind.model)) == 0
