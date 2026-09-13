"""Application factory: one process serves the built SPA and /api.

Run with `uvicorn --factory vocal_compass.app:create_app`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from sqlalchemy.orm import sessionmaker

from .api import account, health, sync, telemetry
from .auth import routes as auth_routes
from .auth.providers import make_provider
from .auth.session import SessionCookieMiddleware
from .db import make_engine, migrate
from .logs import configure_logging
from .middleware import (
    BodyLimitMiddleware,
    OriginCheckMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
    not_found,
    validation_failed,
)
from .ratelimit import RateLimiter, RateLimitMiddleware
from .settings import ConfigError, Settings, from_env
from .spa import SpaFiles


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        try:
            settings = from_env()
        except ConfigError as exc:
            # The message alone: a traceback would bury the variable name.
            raise SystemExit(f"Invalid configuration: {exc}") from None
    configure_logging(settings)
    engine = make_engine(settings)
    if settings.environment == "development":
        # A fresh checkout's server creates its database itself. Containers migrate in entrypoint.sh
        # instead, before the server starts, so a failed migration leaves the old revision serving.
        migrate(engine)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        engine.dispose()

    app = FastAPI(
        title="Vocal Compass",
        version=settings.release,
        lifespan=lifespan,
        exception_handlers={RequestValidationError: validation_failed},
        docs_url="/docs" if settings.is_local else None,
        redoc_url="/redoc" if settings.is_local else None,
        openapi_url="/openapi.json" if settings.is_local else None,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessions = sessionmaker(engine, expire_on_commit=False)
    app.state.identity_provider = make_provider(settings)
    app.state.rate_limiter = RateLimiter()

    for router in (health.router, auth_routes.router, sync.router, account.router, telemetry.router):
        app.include_router(router)
    # The fallback runs only when no route matched, so a wrong method on a real route still gets 405.
    app.router.default = SpaFiles(settings.spa_dist_dir, not_found) if settings.spa_dist_dir else not_found

    # Starlette runs the last-added middleware first, so requests pass these bottom to top: security
    # headers around every response, a 500 included; the session cookie the request settled on, on that
    # response too; request context around the rest; then the refusals, each cheaper than what it guards.
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(OriginCheckMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(SessionCookieMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    return app
