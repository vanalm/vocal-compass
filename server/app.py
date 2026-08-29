"""Vocal Compass sync server: magic-code auth + per-user record sync.

Records (trials, range measurements) are immutable and client-id'd, so sync
is a union merge: the client pushes what it has, the server keeps anything
new, and the response is the authoritative full set.

Codes are echoed in the /auth/request response only when echo_codes is on
(the local-first default — there is no mail infrastructure). Point a real
mailer at send_code() and disable echoing before exposing this publicly.
"""

import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, create_engine, delete, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

SESSION_TTL_DAYS = 90
ALLOWED_ORIGINS = ["http://localhost:5199", "http://localhost:5173"]


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)


class AuthCode(Base):
    __tablename__ = "auth_codes"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, index=True)
    code: Mapped[str] = mapped_column(String)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StoredRecord(Base):
    """One row per immutable client record; trials and ranges share the table."""

    __tablename__ = "records"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    kind: Mapped[str] = mapped_column(String, primary_key=True)  # "trial" | "range"
    record_id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[str] = mapped_column(String, index=True)
    payload: Mapped[dict] = mapped_column(JSON)


class AuthRequestBody(BaseModel):
    email: str


class AuthVerifyBody(BaseModel):
    email: str
    code: str


class SyncBody(BaseModel):
    trials: list[dict]
    ranges: list[dict]
    # Absent from pre-v3 clients; defaulting keeps them syncing.
    sessions: list[dict] = []


def now() -> datetime:
    # Naive UTC everywhere: SQLite strips tzinfo, so aware datetimes would
    # come back naive and comparisons would raise.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_app(
    db_url: str | None = None,
    echo_codes: bool | None = None,
    code_ttl_minutes: int | None = None,
) -> FastAPI:
    db_url = db_url or os.environ.get("VC_DB_URL", "sqlite:///vocal_compass.db")
    if echo_codes is None:
        echo_codes = os.environ.get("VC_ECHO_CODES", "1") == "1"
    if code_ttl_minutes is None:
        code_ttl_minutes = int(os.environ.get("VC_CODE_TTL_MIN", "15"))

    # StaticPool keeps in-memory SQLite shared across connections (tests).
    engine = create_engine(
        db_url,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool if db_url == "sqlite://" else None,
    )
    Base.metadata.create_all(engine)
    make_session = sessionmaker(engine, expire_on_commit=False)

    app = FastAPI(title="vocal-compass-sync")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def db() -> Session:  # FastAPI dependency
        session = make_session()
        try:
            yield session
        finally:
            session.close()

    def current_user(
        session: Session = Depends(db), authorization: str = Header(default="")
    ) -> User:
        token = authorization.removeprefix("Bearer ").strip()
        if not token:
            raise HTTPException(401, "Missing bearer token.")
        auth = session.get(AuthSession, token)
        if not auth or auth.expires_at < now():
            raise HTTPException(401, "Invalid or expired session.")
        return session.get(User, auth.user_id)

    @app.get("/")
    def health() -> dict:
        """Liveness probe: the bare base URL should say the server is up.

        dev_mode mirrors echo_codes so a deployment that is still handing out
        sign-in codes in its responses is visible at a glance.
        """
        return {"app": "vocal-compass-sync", "ok": True, "dev_mode": echo_codes, "docs": "/docs"}

    @app.post("/auth/request")
    def auth_request(body: AuthRequestBody, session: Session = Depends(db)) -> dict:
        email = body.email.strip().lower()
        if "@" not in email:
            raise HTTPException(422, "That does not look like an email address.")
        code = f"{secrets.randbelow(1_000_000):06d}"
        session.add(
            AuthCode(email=email, code=code, expires_at=now() + timedelta(minutes=code_ttl_minutes))
        )
        session.commit()
        response = {"sent": True}
        if echo_codes:
            response["dev_code"] = code
        return response

    @app.post("/auth/verify")
    def auth_verify(body: AuthVerifyBody, session: Session = Depends(db)) -> dict:
        email = body.email.strip().lower()
        row = session.scalars(
            select(AuthCode)
            .where(AuthCode.email == email, AuthCode.code == body.code, ~AuthCode.used)
            .order_by(AuthCode.id.desc())
        ).first()
        if not row or row.expires_at < now():
            raise HTTPException(401, "Wrong or expired code.")
        row.used = True
        user = session.scalars(select(User).where(User.email == email)).first()
        if not user:
            user = User(email=email)
            session.add(user)
            session.flush()
        token = secrets.token_urlsafe(32)
        session.add(
            AuthSession(token=token, user_id=user.id, expires_at=now() + timedelta(days=SESSION_TTL_DAYS))
        )
        session.commit()
        return {"token": token, "email": email}

    @app.get("/me")
    def me(user: User = Depends(current_user)) -> dict:
        return {"email": user.email}

    @app.post("/sync")
    def sync(
        body: SyncBody, user: User = Depends(current_user), session: Session = Depends(db)
    ) -> dict:
        for kind, records in (
            ("trial", body.trials),
            ("range", body.ranges),
            ("session", body.sessions),
        ):
            for payload in records:
                record_id = str(payload.get("id", ""))
                if not record_id:
                    continue
                exists = session.get(StoredRecord, (user.id, kind, record_id))
                if not exists:
                    session.add(
                        StoredRecord(
                            user_id=user.id,
                            kind=kind,
                            record_id=record_id,
                            created_at=str(payload.get("createdAt", "")),
                            payload=payload,
                        )
                    )
        session.commit()

        def all_of(kind: str) -> list[dict]:
            rows = session.scalars(
                select(StoredRecord)
                .where(StoredRecord.user_id == user.id, StoredRecord.kind == kind)
                .order_by(StoredRecord.created_at)
            ).all()
            return [r.payload for r in rows]

        return {"trials": all_of("trial"), "ranges": all_of("range"), "sessions": all_of("session")}

    @app.delete("/data")
    def delete_data(user: User = Depends(current_user), session: Session = Depends(db)) -> dict:
        result = session.execute(delete(StoredRecord).where(StoredRecord.user_id == user.id))
        session.commit()
        return {"deleted": result.rowcount}

    return app


app = create_app()
