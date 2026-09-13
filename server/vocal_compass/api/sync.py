"""POST /api/sync: push new records and deletions, pull every change this device has not seen.

Records are immutable and deletions are forever, so sync is a union merge
with nothing to resolve. A push inserts the ids the account lacks; a
tombstone retires its target, leaving a stub row when the account never had
it, so no later push can bring it back; a pull pages through every row
written since the device's cursor. Each written row takes the next number in
the user's own sequence, allocated while holding the user row lock, so a
cursor is exact: a page covering seq N has seen every row at or below N.

Pulled payloads are spliced into the response as the database's JSON text,
never parsed, and a page also ends at a size budget, so a page of long pitch
traces costs one string per record rather than a Python object per frame.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, TypeGuard

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth.session import SIGN_IN_REQUIRED, current_user
from ..db import get_session, utcnow
from ..logs import event
from ..models import User
from ..ratelimit import TOO_MANY_REQUESTS, limit_per_user
from ..records import KINDS, Kind, tombstone
from . import PREFIX

router = APIRouter(prefix=PREFIX, tags=["sync"])

MAX_PUSH = 500  # records, and separately tombstones, per request
PAGE_SIZE = 500
MAX_RECORD_BYTES = 1_000_000
# A page also ends once its record JSON passes this (a single larger record still goes alone),
# so a pull stays within memory and Cloud Run's response limit however long the traces grow.
PAGE_BUDGET = 4_000_000
RECORD_ID = re.compile(r"[A-Za-z0-9_.:-]{1,64}")
# A JSON NUL escape (backslash, u0000) that is not itself an escaped backslash: Postgres can store U+0000 in neither jsonb nor text.
_NUL_ESCAPE = re.compile(r"(?<!\\)(?:\\\\)*\\u0000")
_STREAM_ROWS = 50


class PushedRecord(BaseModel):
    kind: str
    record: dict[str, Any]


class SyncRequest(BaseModel):
    cursor: int = Field(ge=0, le=2**63 - 1)
    records: list[PushedRecord] = Field(default_factory=list, max_length=MAX_PUSH)
    # Checked one by one like records, so one malformed tombstone is rejected rather than failing the request.
    tombstones: list[dict[str, Any]] = Field(default_factory=list, max_length=MAX_PUSH)


@dataclass(frozen=True, slots=True)
class _Deletion:
    kind: Kind
    record_id: str
    deletion_id: str
    deleted_at: datetime


@dataclass(frozen=True, slots=True)
class _NewRecord:
    kind: Kind
    record_id: str
    created_at: datetime
    payload: dict[str, Any]


@dataclass(slots=True)
class _Page:
    cursor: int
    records: list[str] = field(default_factory=list)  # {"kind","record"} objects as JSON text
    tombstones: list[dict[str, Any]] = field(default_factory=list)
    has_more: bool = False


@router.post(
    "/sync",
    dependencies=[Depends(limit_per_user)],
    responses={401: {"description": SIGN_IN_REQUIRED}, 429: {"description": TOO_MANY_REQUESTS}},
)
def sync(
    body: SyncRequest,
    request: Request,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> Response:
    started = time.perf_counter()
    rejected: list[dict[str, Any]] = []
    deletions: list[_Deletion] = []
    for stone in body.tombstones:
        deletion = _read_tombstone(stone)
        if isinstance(deletion, str):
            rejected.append({"kind": "tombstone", "id": _echo(stone.get("id")), "reason": deletion})
        else:
            deletions.append(deletion)
    records: list[_NewRecord] = []
    for pushed in body.records:
        record = _read_record(pushed)
        if isinstance(record, str):
            rejected.append({"kind": pushed.kind, "id": _echo(pushed.record.get("id")), "reason": record})
        else:
            records.append(record)

    # Serialises this user's syncs, so seq allocation and the pull below see one consistent account.
    locked = session.scalar(
        sa.select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True)
    )
    if locked is None:  # the account was deleted after this request signed in
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, SIGN_IN_REQUIRED)
    head = locked.sync_seq
    accepted = _apply_push(session, locked, deletions, records)
    pushed_ids = {(item.kind, record_id) for item in body.records if isinstance(record_id := item.record.get("id"), str)}
    cursor = body.cursor
    if cursor > head:
        # No row was ever numbered this high: the database was restored to an earlier point, and rows written
        # since reuse seqs at or below the cursor, where this device would never look. It pulls everything again.
        event("sync.cursor_ahead", severity=logging.WARNING, cursor=cursor, head=head)
        cursor = 0
    page = _pull(session, locked.id, cursor, pushed_ids)
    locked.last_seen_at = utcnow()
    session.commit()

    event(
        "sync.completed",
        pushed=len(body.records),
        accepted=accepted,
        rejected=len(rejected),
        tombstones_in=len(body.tombstones),
        pulled=len(page.records),
        tombstones_out=len(page.tombstones),
        has_more=page.has_more,
        request_bytes=_content_length(request),
        duration_ms=round((time.perf_counter() - started) * 1000, 1),
    )
    return Response(_render(locked.id, accepted, rejected, page), media_type="application/json")


def parse_timestamp(value: object) -> datetime | None:
    """An ISO-8601 string as an aware UTC datetime (no offset means UTC), or None."""
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value)
        return (moment if moment.tzinfo else moment.replace(tzinfo=UTC)).astimezone(UTC)
    except (ValueError, OverflowError):
        return None


def _read_tombstone(stone: dict[str, Any]) -> _Deletion | str:
    """The deletion a pushed tombstone asks for, or why it is rejected."""
    kind, deletion_id, record_id = stone.get("kind"), stone.get("id"), stone.get("recordId")
    if not isinstance(kind, str) or kind not in KINDS:
        return "unknown_kind"
    if not _valid_id(deletion_id):
        return "invalid_id"
    if not _valid_id(record_id):
        return "invalid_record_id"
    deleted_at = parse_timestamp(stone.get("createdAt"))
    if deleted_at is None:
        return "invalid_created_at"
    return _Deletion(KINDS[kind], record_id, deletion_id, deleted_at)


def _read_record(pushed: PushedRecord) -> _NewRecord | str:
    """The row a pushed record would become, or why it is rejected."""
    record_id = pushed.record.get("id")
    if pushed.kind not in KINDS:
        return "unknown_kind"
    if not _valid_id(record_id):
        return "invalid_id"
    created_at = parse_timestamp(pushed.record.get("createdAt"))
    if created_at is None:
        return "invalid_created_at"
    size = _json_size(pushed.record)
    if size is None:
        return "invalid_json"
    if size > MAX_RECORD_BYTES:
        return "too_large"
    return _NewRecord(KINDS[pushed.kind], record_id, created_at, pushed.record)


def _valid_id(value: object) -> TypeGuard[str]:
    return isinstance(value, str) and RECORD_ID.fullmatch(value) is not None


def _json_size(record: dict[str, Any]) -> int | None:
    """The record's size as UTF-8 JSON, or None when Postgres could not store it.

    That means NaN or Infinity, a lone surrogate, or U+0000: any of them would
    fail the whole transaction at insert rather than just this record.
    """
    try:
        text = json.dumps(record, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        size = len(text.encode())
    except (ValueError, RecursionError):
        return None
    return None if _NUL_ESCAPE.search(text) else size


def _echo(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _apply_push(session: Session, user: User, deletions: list[_Deletion], records: list[_NewRecord]) -> int:
    """Write deletions, then new records, each written row taking the next seq; returns how many records were new."""
    now = utcnow()
    held = _held(session, user.id, [*deletions, *records])
    inserts: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    updates: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)

    def next_seq() -> int:
        user.sync_seq += 1
        return user.sync_seq

    for deletion in deletions:
        key = (deletion.kind.name, deletion.record_id)
        if held.get(key):
            continue  # already deleted
        # The typed columns are copies of the payload, so they go with it.
        row = {
            "user_id": user.id,
            "id": deletion.record_id,
            "seq": next_seq(),
            "payload": None,
            "deleted_at": deletion.deleted_at,
            "deletion_id": deletion.deletion_id,
            **dict.fromkeys(deletion.kind.columns),
        }
        if key in held:
            updates[deletion.kind.name].append(row)
        else:
            inserts[deletion.kind.name].append({**row, "created_at": deletion.deleted_at, "recorded_at": now})
        held[key] = True

    accepted = 0
    for record in records:
        key = (record.kind.name, record.record_id)
        if key in held:
            continue  # records are immutable, and a deleted one stays deleted
        inserts[record.kind.name].append(
            {
                "user_id": user.id,
                "id": record.record_id,
                "seq": next_seq(),
                "payload": record.payload,
                "deleted_at": None,
                "deletion_id": None,
                "created_at": record.created_at,
                "recorded_at": now,
                **record.kind.extract(record.payload),
            }
        )
        held[key] = False
        accepted += 1

    for name, rows in updates.items():
        session.execute(sa.update(KINDS[name].model), rows)
    for name, rows in inserts.items():
        session.execute(sa.insert(KINDS[name].model), rows)
    return accepted


def _held(session: Session, user_id: uuid.UUID, items: Iterable[_Deletion | _NewRecord]) -> dict[tuple[str, str], bool]:
    """For every (kind, id) the push names that the account already holds: whether that row is deleted."""
    ids: defaultdict[str, set[str]] = defaultdict(set)
    for item in items:
        ids[item.kind.name].add(item.record_id)
    held: dict[tuple[str, str], bool] = {}
    for name, record_ids in ids.items():
        model = KINDS[name].model
        rows = session.execute(
            sa.select(model.id, model.deleted_at).where(model.user_id == user_id, model.id.in_(sorted(record_ids)))
        )
        held.update({(name, record_id): deleted_at is not None for record_id, deleted_at in rows})
    return held


def _pull(session: Session, user_id: uuid.UUID, cursor: int, pushed: set[tuple[str, str]]) -> _Page:
    """One page of the rows above `cursor`, in seq order across every kind table.

    Each table contributes only its lowest PAGE_SIZE + 1 rows to the merge, so
    a page never reads, casts or sorts the rows beyond it. Records pushed in
    this request advance the cursor but are not sent back: the device already
    has them.
    """
    changed = (
        sa.union_all(
            *(
                sa.select(
                    sa.literal(kind.name).label("kind"),
                    kind.model.id,
                    kind.model.seq,
                    kind.model.deleted_at,
                    kind.model.deletion_id,
                    sa.cast(kind.model.payload, sa.Text).label("payload"),
                )
                .where(kind.model.user_id == user_id, kind.model.seq > cursor)
                .order_by(kind.model.seq)
                .limit(PAGE_SIZE + 1)
                .subquery()
                .select()
                for kind in KINDS.values()
            )
        )
        .order_by("seq")
        .limit(PAGE_SIZE + 1)
    )
    page = _Page(cursor)
    size = 0
    result = session.execute(changed, execution_options={"yield_per": _STREAM_ROWS})
    try:
        for count, (kind, record_id, seq, deleted_at, deletion_id, payload) in enumerate(result):
            echoed = (kind, record_id) in pushed
            weight = 0 if deleted_at is not None or echoed else len(payload)
            if count == PAGE_SIZE or (size and size + weight > PAGE_BUDGET):
                page.has_more = True
                break
            page.cursor = seq
            if deleted_at is not None:
                page.tombstones.append(tombstone(kind, record_id, deletion_id, deleted_at))
            elif not echoed:
                page.records.append(f'{{"kind":"{kind}","record":{payload}}}')
                size += weight
    finally:
        result.close()
    return page


def _render(user_id: uuid.UUID, accepted: int, rejected: list[dict[str, Any]], page: _Page) -> bytes:
    # userId is /api/me's user.id: the session cookie is every tab's, so a client applies a page only to that account's ledger.
    # json.dumps escapes non-ASCII in what the client sent, so an echoed lone surrogate still encodes.
    head = json.dumps({"userId": str(user_id), "accepted": accepted, "rejected": rejected}, separators=(",", ":"))
    tail = json.dumps(
        {"tombstones": page.tombstones, "cursor": page.cursor, "hasMore": page.has_more}, separators=(",", ":")
    )
    return f'{head[:-1]},"records":[{",".join(page.records)}],{tail[1:]}'.encode()


def _content_length(request: Request) -> int | None:
    try:
        return int(request.headers.get("content-length", ""))
    except ValueError:
        return None
