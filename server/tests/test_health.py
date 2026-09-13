"""Liveness never touches the database; readiness reports whether it answers."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient


def unreachable(tmp_path: Path) -> str:
    return f"sqlite:///{tmp_path / 'no' / 'such' / 'dir' / 'vc.db'}"


def test_health_reports_the_release_without_touching_the_database(
    make_app: Callable[..., FastAPI], tmp_path: Path
) -> None:
    with TestClient(make_app(release="abc123", database_url=unreachable(tmp_path))) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "release": "abc123"}


def test_ready_when_the_database_answers(client: TestClient) -> None:
    response = client.get("/api/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_ready_is_503_when_the_database_is_unreachable(
    make_app: Callable[..., FastAPI], json_logs: Callable[[], list[dict[str, Any]]], tmp_path: Path
) -> None:
    with TestClient(make_app(database_url=unreachable(tmp_path))) as client:
        response = client.get("/api/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    (warning,) = [line for line in json_logs() if line["message"].startswith("Readiness check failed")]
    assert warning["severity"] == "WARNING"
    assert "unable to open database file" in warning["message"]
