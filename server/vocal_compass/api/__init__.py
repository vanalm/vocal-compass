"""JSON API routers. Everything under PREFIX is API: the SPA never answers there."""

PREFIX = "/api"


def is_api_path(path: str) -> bool:
    return path == PREFIX or path.startswith(f"{PREFIX}/")
