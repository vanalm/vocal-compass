"""Runtime configuration, read once from the environment and validated up front.

Every rule lives here so a bad deploy fails at startup with a message naming
the variable, never with a traceback deep inside a request. Field names are
the environment variable names, lowercased. Anything that can carry a
credential is a SecretStr, so Settings can be logged or shown in a traceback
without leaking it.
"""

from __future__ import annotations

import base64
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    NonNegativeInt,
    SecretStr,
    ValidationError,
    field_validator,
    model_validator,
)
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

LOCAL_ENVIRONMENTS = frozenset({"development", "test"})
DEV_DATABASE_URL = "sqlite:///./dev.db"
# Public on purpose: it only signs dev-auth cookies, and dev auth is refused
# outside development/test.
DEV_SESSION_SECRET = "vocal-compass-dev-session-secret-not-for-production"
_LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


class ConfigError(ValueError):
    """The environment describes an invalid configuration; the message names the variables."""


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    environment: Literal["development", "test", "staging", "production"] = "development"
    app_base_url: str = "http://localhost:5199"
    database_url: SecretStr = SecretStr("")
    auth_mode: Literal["dev", "workos"] = "dev"
    workos_client_id: str = ""
    workos_api_key: SecretStr = SecretStr("")
    workos_cookie_password: SecretStr = SecretStr("")
    session_secret: SecretStr = SecretStr(DEV_SESSION_SECRET)
    auth_allowed_emails: tuple[str, ...] = ()
    log_format: Literal["text", "json"] = "text"
    log_level: str = "INFO"
    google_cloud_project: str = ""
    spa_dist_dir: Path | None = None
    release: str = "dev"
    # How many proxies in front of the app append to X-Forwarded-For: 0 trusts only the connection's peer,
    # 1 is Cloud Run on its run.app URL, 2 is the load balancer in front of Cloud Run (ratelimit.client_ip).
    trusted_proxy_hops: NonNegativeInt = 0
    # Only entrypoint.sh reads it, and only "1" migrates: checked here so any other spelling stops the server.
    run_migrations_on_start: Literal["0", "1"] = "0"

    @property
    def is_local(self) -> bool:
        """True for development and test: the only places dev auth and API docs are allowed."""
        return self.environment in LOCAL_ENVIRONMENTS

    @property
    def https(self) -> bool:
        """Whether browsers reach the app over https, which decides the Secure and __Host- cookie rules."""
        return urlsplit(self.app_base_url).scheme == "https"

    @property
    def origin(self) -> str:
        """APP_BASE_URL as a browser writes it in an Origin header: lowercase host, no default port."""
        parts = urlsplit(self.app_base_url)
        host = parts.hostname or ""
        port = "" if parts.port in (None, {"http": 80, "https": 443}[parts.scheme]) else f":{parts.port}"
        return f"{parts.scheme}://{f'[{host}]' if ':' in host else host}{port}"

    def email_allowed(self, email: str, *, verified: bool) -> bool:
        """Whether `email` may sign in: anyone when the list is empty, else a verified address the list names.

        `@domain` entries admit a whole domain. An unverified address proves
        nothing about who holds it, so it never passes a list.
        """
        if not self.auth_allowed_emails:
            return True
        email = email.strip().lower()
        listed = email in self.auth_allowed_emails or f"@{email.rpartition('@')[2]}" in self.auth_allowed_emails
        return verified and listed

    @model_validator(mode="before")
    @classmethod
    def _defaults_follow_environment(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        environment = data.get("environment", "development")
        defaults: dict[str, Any] = {
            "auth_mode": "dev" if environment in LOCAL_ENVIRONMENTS else "workos",
            "log_format": "text" if environment == "development" else "json",
        }
        if environment in LOCAL_ENVIRONMENTS:
            defaults["database_url"] = DEV_DATABASE_URL
        return {**defaults, **data}

    @field_validator("app_base_url")
    @classmethod
    def _bare_origin(cls, value: str) -> str:
        parts = urlsplit(value)
        _ = parts.port  # raises ValueError on a malformed port
        if (
            parts.scheme not in ("http", "https")
            or not parts.hostname
            or parts.username is not None
            or parts.path
            or parts.query
            or parts.fragment
        ):
            raise ValueError("must be a bare origin such as https://vocal.example.com (no path or trailing slash)")
        return value

    @field_validator("log_level", mode="before")
    @classmethod
    def _known_level(cls, value: Any) -> Any:
        level = str(value).upper()
        if level not in _LOG_LEVELS:
            raise ValueError(f"must be one of {', '.join(_LOG_LEVELS)}")
        return level

    @field_validator("auth_allowed_emails", mode="before")
    @classmethod
    def _allowlist(cls, value: Any) -> Any:
        if isinstance(value, str):
            value = value.split(",")
        entries = tuple(entry.strip().lower() for entry in value if entry.strip())
        for entry in entries:
            _, _, domain = entry.partition("@")
            if "@" not in entry or "@" in domain or not domain:
                raise ValueError(f"{entry!r} is neither an email address nor an @domain entry")
        return entries

    @field_validator("spa_dist_dir")
    @classmethod
    def _built_spa(cls, value: Path | None) -> Path | None:
        if value is not None and not (value / "index.html").is_file():
            raise ValueError(f"{value} has no index.html; build the SPA or leave SPA_DIST_DIR unset")
        return value

    @model_validator(mode="after")
    def _cross_field_rules(self) -> Settings:
        problems: list[str] = []
        url = self.database_url.get_secret_value()
        if not url:
            problems.append("DATABASE_URL is required when ENVIRONMENT is staging or production")
        elif not _supported_database(url):
            problems.append("DATABASE_URL must be a sqlite:// or postgresql+psycopg:// URL")
        if self.auth_mode == "dev" and not self.is_local:
            problems.append("AUTH_MODE=dev is refused when ENVIRONMENT is staging or production")
        if self.auth_mode == "workos":
            required = {
                "WORKOS_CLIENT_ID": self.workos_client_id,
                "WORKOS_API_KEY": self.workos_api_key.get_secret_value(),
                "WORKOS_COOKIE_PASSWORD": self.workos_cookie_password.get_secret_value(),
            }
            problems += [f"{name} is required when AUTH_MODE=workos" for name, value in required.items() if not value]
            if required["WORKOS_COOKIE_PASSWORD"] and not _fernet_key(required["WORKOS_COOKIE_PASSWORD"]):
                problems.append(
                    "WORKOS_COOKIE_PASSWORD must be a Fernet key: 32 random bytes, url-safe base64 (44 characters)"
                )
        if problems:
            raise ValueError("; ".join(problems))
        return self


def from_env(environ: Mapping[str, str] | None = None) -> Settings:
    """Build Settings from environment variables. Empty values count as unset.

    Raises ConfigError naming every offending variable. The message is built
    from the rule descriptions only: pydantic's own rendering would echo the
    raw input, secrets included.
    """
    source = os.environ if environ is None else environ
    raw = {
        name: source[name.upper()].strip()
        for name in Settings.model_fields
        if source.get(name.upper(), "").strip()
    }
    try:
        return Settings.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError("; ".join(_describe(error) for error in exc.errors())) from None


def _describe(error: Any) -> str:
    message = str(error["msg"]).removeprefix("Value error, ")
    variable = ".".join(str(part) for part in error["loc"]).upper()
    return f"{variable}: {message}" if variable else message


def _supported_database(url: str) -> bool:
    try:
        parsed = make_url(url)
    except ArgumentError:
        return False
    return parsed.get_backend_name() == "sqlite" or parsed.drivername == "postgresql+psycopg"


def _fernet_key(value: str) -> bool:
    """Whether the WorkOS SDK can seal sessions with `value`: it hands it to cryptography's Fernet, which decodes it just so."""
    try:
        return len(base64.urlsafe_b64decode(value)) == 32
    except ValueError:  # bad padding, or text that is not ASCII
        return False
