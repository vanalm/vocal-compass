"""The factory: environment loading, fail-fast exit, and docs only where they belong."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from support import FERNET_KEY, MEMORY_DATABASE_URL
from vocal_compass.app import create_app
from vocal_compass.models import Base
from vocal_compass.settings import Settings

WORKOS = {"workos_client_id": "client_test", "workos_api_key": "sk_test_placeholder", "workos_cookie_password": FERNET_KEY}
DEPLOYED_DATABASE = "postgresql+psycopg://vocal@/vocal?host=/cloudsql/proj:us-west1:vc"


@pytest.fixture
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    return monkeypatch


@pytest.mark.parametrize("environment", ["development", "test"])
def test_api_docs_are_served_locally(make_app: Callable[..., FastAPI], environment: str) -> None:
    with TestClient(make_app(environment=environment)) as client:
        assert client.get("/docs").status_code == 200
        assert client.get("/redoc").status_code == 200
        assert client.get("/openapi.json").json()["info"]["title"] == "Vocal Compass"


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_api_docs_are_hidden_when_deployed(make_app: Callable[..., FastAPI], environment: str) -> None:
    app = make_app(environment=environment, app_base_url="https://vocal.example.com", **WORKOS)
    with TestClient(app) as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            response = client.get(path)
            assert response.status_code == 404, path
            assert response.json() == {"detail": "Not found"}


@pytest.mark.parametrize("environment", ["development", "test"])
def test_only_development_migrates_its_own_database(
    make_app: Callable[..., FastAPI], tmp_path: Path, environment: str
) -> None:
    """A fresh checkout's dev server needs no separate step; containers migrate in entrypoint.sh before serving."""
    database = f"sqlite:///{tmp_path / 'vc.db'}"
    make_app(environment=environment, database_url=database)
    engine = sa.create_engine(database)
    try:
        with engine.connect() as connection:
            tables = set(sa.inspect(connection).get_table_names())
    finally:
        engine.dispose()
    assert tables == ({"alembic_version", *Base.metadata.tables} if environment == "development" else set())


def test_the_factory_reads_the_environment(clean_environment: pytest.MonkeyPatch) -> None:
    clean_environment.setenv("ENVIRONMENT", "test")
    clean_environment.setenv("DATABASE_URL", MEMORY_DATABASE_URL)
    clean_environment.setenv("RELEASE", "0123abc")
    with TestClient(create_app()) as client:
        assert client.get("/api/health").json() == {"status": "ok", "release": "0123abc"}


@pytest.mark.parametrize(
    ("environ", "problems"),
    [
        ({"ENVIRONMENT": "production"}, ["DATABASE_URL is required"]),
        (
            {"ENVIRONMENT": "production", "DATABASE_URL": DEPLOYED_DATABASE},
            ["WORKOS_CLIENT_ID is required", "WORKOS_API_KEY is required", "WORKOS_COOKIE_PASSWORD is required"],
        ),
        ({"ENVIRONMENT": "staging", "DATABASE_URL": DEPLOYED_DATABASE, "AUTH_MODE": "dev"}, ["AUTH_MODE=dev is refused"]),
    ],
)
def test_invalid_configuration_exits_naming_the_variable(
    clean_environment: pytest.MonkeyPatch, environ: dict[str, str], problems: list[str]
) -> None:
    for name, value in environ.items():
        clean_environment.setenv(name, value)
    with pytest.raises(SystemExit) as exited:
        create_app()
    assert str(exited.value).startswith("Invalid configuration: ")
    for problem in problems:
        assert problem in str(exited.value)
