"""The account as a whole: download everything it holds, or delete it.

The download is the client's own backup format, ExportPayload version 5, so
it imports straight into any device. It streams, payloads spliced in as the
database's JSON text, so a long history costs a few chunks of memory rather
than the whole account.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable, Iterator
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth.session import SIGN_IN_REQUIRED, current_user, identity_provider, session_cookie, write_session_cookie
from ..db import get_session, utcnow
from ..logs import event
from ..models import User
from ..records import KINDS, tombstone
from . import PREFIX

router = APIRouter(prefix=PREFIX, tags=["account"])

EXPORT_APP = "vocal-compass"
EXPORT_VERSION = 5
_STREAM_ROWS = 100
_CHUNK_CHARS = 64_000


@router.get("/account/export", responses={401: {"description": SIGN_IN_REQUIRED}})
def export_account(user: User = Depends(current_user), session: Session = Depends(get_session)) -> StreamingResponse:
    # The body streams after this returns; FastAPI closes the request's session only once it is sent.
    filename = f"vocal-compass-account-{utcnow().date().isoformat()}.json"
    return StreamingResponse(
        _chunks(_export(session, user.id)),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/account", responses={401: {"description": SIGN_IN_REQUIRED}})
def delete_account(
    request: Request, user: User = Depends(current_user), session: Session = Depends(get_session)
) -> dict[str, Any]:
    sealed = request.cookies[session_cookie(request.app.state.settings).name]
    logout_url = identity_provider(request).logout_url(sealed)
    # Every record row goes with the user: each kind table's foreign key cascades.
    session.execute(sa.delete(User).where(User.id == user.id))
    session.commit()
    write_session_cookie(request, None)
    event("account.deleted")
    return {"deleted": True, "logoutUrl": logout_url}


def _export(session: Session, user_id: uuid.UUID) -> Iterator[str]:
    """The ExportPayload in pieces: each kind's live payloads in createdAt order, then every tombstone."""
    counts: dict[str, int] = {}
    yield f'{{"app":"{EXPORT_APP}","version":{EXPORT_VERSION}'
    for kind in KINDS.values():
        model = kind.model
        live = (
            sa.select(sa.cast(model.payload, sa.Text))
            .where(model.user_id == user_id, model.deleted_at.is_(None))
            .order_by(model.created_at, model.id)
        )
        count = 0
        yield f',"{kind.export_key}":['
        for payload in session.scalars(live, execution_options={"yield_per": _STREAM_ROWS}):
            yield f",{payload}" if count else payload
            count += 1
        yield "]"
        counts[kind.export_key] = count

    deleted = sa.union_all(
        *(
            sa.select(
                sa.literal(kind.name).label("kind"), kind.model.id, kind.model.deletion_id, kind.model.deleted_at
            ).where(kind.model.user_id == user_id, kind.model.deleted_at.is_not(None))
            for kind in KINDS.values()
        )
    ).order_by("deleted_at", "id")
    count = 0
    yield ',"tombstones":['
    for kind_name, record_id, deletion_id, deleted_at in session.execute(
        deleted, execution_options={"yield_per": _STREAM_ROWS}
    ):
        stone = json.dumps(tombstone(kind_name, record_id, deletion_id, deleted_at), separators=(",", ":"))
        yield f",{stone}" if count else stone
        count += 1
    yield "]}"
    event("account.exported", **counts, tombstones=count)


def _chunks(pieces: Iterable[str]) -> Iterator[bytes]:
    """Coalesce small pieces into writes of about 64 KB: each write costs a thread hop and an ASGI send."""
    buffer: list[str] = []
    size = 0
    for piece in pieces:
        buffer.append(piece)
        size += len(piece)
        if size >= _CHUNK_CHARS:
            yield "".join(buffer).encode()
            buffer, size = [], 0
    if buffer:
        yield "".join(buffer).encode()
