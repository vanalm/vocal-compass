"""Shared fixtures.

By default every app gets its own in-memory SQLite database with the schema
created from the models; test_migrations.py proves the migrations build the
same schema. Set TEST_DATABASE_URL (Postgres 16 in CI) to run the whole suite
there instead: that database is migrated to head once per session and emptied
after every test.
"""

from __future__ import annotations

import io
import json
import logging
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from support import (
    LOG_PROJECT,
    MEMORY_DATABASE_URL,
    TEST_DATABASE_URL,
    FakeProvider,
    empty_tables,
    make_settings,
    sign_in,
)
from vocal_compass.app import create_app
from vocal_compass.db import migrate
from vocal_compass.logs import JsonFormatter
from vocal_compass.models import Base


@pytest.fixture(scope="session", autouse=True)
def _migrate_test_database() -> None:
    if not TEST_DATABASE_URL:
        return
    engine = sa.create_engine(TEST_DATABASE_URL)
    try:
        migrate(engine)
    finally:
        engine.dispose()


@pytest.fixture
def make_app() -> Iterator[Callable[..., FastAPI]]:
    """Build apps from Settings overrides, schema ready; their databases are cleaned up after the test."""
    apps: list[FastAPI] = []

    def build(**overrides: Any) -> FastAPI:
        app = create_app(make_settings(**overrides))
        if app.state.settings.database_url.get_secret_value() == MEMORY_DATABASE_URL:
            Base.metadata.create_all(app.state.engine)
        apps.append(app)
        return app

    yield build
    for app in apps:
        if TEST_DATABASE_URL and app.state.settings.database_url.get_secret_value() == TEST_DATABASE_URL:
            empty_tables(app.state.engine)
        app.state.engine.dispose()


@pytest.fixture
def app(make_app: Callable[..., FastAPI]) -> FastAPI:
    return make_app()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def provider(app: FastAPI) -> FakeProvider:
    """Installs a FakeProvider on `app`, so tests can sign in as any email."""
    fake = FakeProvider()
    app.state.identity_provider = fake
    return fake


@pytest.fixture
def signed_in(app: FastAPI, provider: FakeProvider) -> Iterator[Callable[[str], TestClient]]:
    """A client signed in to `app` as the given email: one device, with its own cookie jar, per call."""
    devices: list[TestClient] = []

    def sign_in_as(email: str) -> TestClient:
        # Not entered with `with`: leaving a TestClient's lifespan disposes the engine, and an in-memory database with it.
        device = TestClient(app)
        devices.append(device)
        assert sign_in(device, email).headers["location"] == "/"
        return device

    yield sign_in_as
    for device in devices:
        device.close()


@pytest.fixture
def spa_dist(tmp_path: Path) -> Path:
    """A minimal Vite-shaped build: index.html, one hashed asset, one root file."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Vocal Compass</title>")
    (dist / "assets" / "index-3f2a9c1b.js").write_text("console.log('vocal compass')")
    (dist / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    return dist


@pytest.fixture
def json_logs() -> Iterator[Callable[[], list[dict[str, Any]]]]:
    """Every log line of the test, at DEBUG, parsed from exactly what production would print."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter(release="test", environment="test", project=LOG_PROJECT))
    root = logging.getLogger()
    level = root.level
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    try:
        yield lambda: [json.loads(line) for line in stream.getvalue().splitlines()]
    finally:
        root.removeHandler(handler)
        root.setLevel(level)
