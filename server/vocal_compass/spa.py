"""Serve the built SPA: real files from SPA_DIST_DIR, index.html for every other page route.

Installed as the router's fallback rather than as a catch-all route, it sees
only requests no API route matched, so it can never shadow /api; those, and
any non-GET request, get the JSON 404 instead. Cache headers follow Vite's
output: hashed /assets/* never change, while index.html must be revalidated
on every load so a deploy reaches users at once. A missing /assets/* file is
a 404, not index.html: a stale tab asking for an old bundle must not be
handed HTML and told it is JavaScript.
"""

from __future__ import annotations

import os
from pathlib import Path

from starlette.responses import FileResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .api import is_api_path

IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"
ONE_HOUR = "public, max-age=3600"


class SpaFiles:
    def __init__(self, dist_dir: Path, fallback: ASGIApp) -> None:
        self.root = dist_dir.resolve()
        self.fallback = fallback

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope["path"]
        if scope["type"] != "http" or scope["method"] not in ("GET", "HEAD") or is_api_path(path):
            await self.fallback(scope, receive, send)
            return
        file = self.resolve(path)
        if file is None and path.startswith("/assets/"):
            await self.fallback(scope, receive, send)
            return
        file = file or self.root / "index.html"
        await FileResponse(file, headers={"Cache-Control": self.cache_control(file)})(scope, receive, send)

    def resolve(self, url_path: str) -> Path | None:
        """The regular file under the dist dir that `url_path` names, or None.

        None covers missing files, directories, and anything that resolves
        outside the root: `..` segments, symlinks out, and names the OS rejects.
        """
        try:
            candidate = (self.root / url_path.lstrip("/")).resolve()
        except (OSError, ValueError):
            return None
        return candidate if candidate.is_relative_to(self.root) and os.path.isfile(candidate) else None

    def cache_control(self, file: Path) -> str:
        relative = file.relative_to(self.root)
        if relative.parts[0] == "assets":
            return IMMUTABLE
        return REVALIDATE if relative == Path("index.html") else ONE_HOUR
