"""SPA serving: files, fallback, cache headers, traversal, and /api never shadowed."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from vocal_compass.middleware import not_found
from vocal_compass.spa import IMMUTABLE, ONE_HOUR, REVALIDATE, SpaFiles

ASSET = "/assets/index-3f2a9c1b.js"
INDEX_TEXT = "<!doctype html><title>Vocal Compass</title>"


@pytest.fixture
def spa_client(make_app: Callable[..., FastAPI], spa_dist: Path) -> Iterator[TestClient]:
    with TestClient(make_app(spa_dist_dir=spa_dist)) as client:
        yield client


@pytest.mark.parametrize("path", ["/", "/index.html", "/range", "/quest/level-2", "/assets"])
def test_index_and_page_routes_serve_index_revalidated(spa_client: TestClient, path: str) -> None:
    response = spa_client.get(path)
    assert response.status_code == 200
    assert response.text == INDEX_TEXT
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == REVALIDATE


def test_hashed_assets_are_immutable(spa_client: TestClient) -> None:
    response = spa_client.get(ASSET)
    assert response.status_code == 200
    assert response.text == "console.log('vocal compass')"
    assert "javascript" in response.headers["content-type"]
    assert response.headers["cache-control"] == IMMUTABLE


def test_a_missing_asset_is_404_not_index(spa_client: TestClient) -> None:
    response = spa_client.get("/assets/index-00000000.js")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not found"}


def test_other_root_files_cache_for_an_hour(spa_client: TestClient) -> None:
    response = spa_client.get("/favicon.svg")
    assert response.status_code == 200
    assert response.headers["cache-control"] == ONE_HOUR


def test_head_is_served_without_a_body(spa_client: TestClient) -> None:
    response = spa_client.head(ASSET)
    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["cache-control"] == IMMUTABLE


def test_other_methods_do_not_fall_back_to_index(spa_client: TestClient) -> None:
    response = spa_client.post("/range")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not found"}


def test_api_is_never_shadowed(make_app: Callable[..., FastAPI], spa_dist: Path) -> None:
    (spa_dist / "api").mkdir()
    (spa_dist / "api" / "health").write_text("shadow")
    (spa_dist / "api" / "nope").write_text("shadow")
    with TestClient(make_app(spa_dist_dir=spa_dist)) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        for path in ("/api/nope", "/api", "/api/"):
            response = client.get(path)
            assert response.status_code == 404, path
            assert response.json() == {"detail": "Not found"}


@pytest.mark.parametrize(
    "path",
    ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2fsecret.txt"],
)
def test_traversal_cannot_escape_the_dist_dir(spa_client: TestClient, spa_dist: Path, path: str) -> None:
    (spa_dist.parent / "secret.txt").write_text("TOP SECRET")
    assert "TOP SECRET" not in spa_client.get(path).text


def test_resolve_refuses_anything_outside_the_root(spa_dist: Path) -> None:
    (spa_dist.parent / "secret.txt").write_text("TOP SECRET")
    (spa_dist / "escape.txt").symlink_to(spa_dist.parent / "secret.txt")
    files = SpaFiles(spa_dist, not_found)
    for path in ("/../secret.txt", "/assets/../../secret.txt", "/escape.txt", "/bad\x00name", "/" + "a" * 5000, "/assets", "/"):
        assert files.resolve(path) is None, path
    assert files.resolve("/favicon.svg") == spa_dist.resolve() / "favicon.svg"
    assert files.resolve("/assets/../favicon.svg") == spa_dist.resolve() / "favicon.svg"
