"""Settings: defaults, environment-dependent rules, and fail-fast messages that name the variable."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr, ValidationError

from support import FERNET_KEY
from vocal_compass.settings import ConfigError, Settings, from_env

WORKOS = {
    "WORKOS_CLIENT_ID": "client_test",
    "WORKOS_API_KEY": "sk_test_placeholder",
    "WORKOS_COOKIE_PASSWORD": FERNET_KEY,
}
DEPLOYED = {
    "ENVIRONMENT": "production",
    "APP_BASE_URL": "https://vocal.example.com",
    "DATABASE_URL": "postgresql+psycopg://vocal:hunter2@/vocal?host=/cloudsql/proj:us-west1:vc",
    **WORKOS,
}


def without(env: dict[str, str], name: str) -> dict[str, str]:
    return {key: value for key, value in env.items() if key != name}


def test_development_defaults() -> None:
    settings = from_env({})
    assert settings.environment == "development"
    assert settings.app_base_url == "http://localhost:5199"
    assert settings.database_url.get_secret_value() == "sqlite:///./dev.db"
    assert settings.auth_mode == "dev"
    assert settings.log_format == "text"
    assert settings.log_level == "INFO"
    assert settings.auth_allowed_emails == ()
    assert settings.spa_dist_dir is None
    assert settings.release == "dev"
    assert settings.trusted_proxy_hops == 0
    assert settings.run_migrations_on_start == "0"
    assert settings.is_local


def test_test_environment_logs_json_but_keeps_local_defaults() -> None:
    settings = from_env({"ENVIRONMENT": "test"})
    assert settings.log_format == "json"
    assert settings.auth_mode == "dev"
    assert settings.database_url.get_secret_value() == "sqlite:///./dev.db"


def test_a_complete_production_configuration_loads() -> None:
    settings = from_env({**DEPLOYED, "RUN_MIGRATIONS_ON_START": "1", "TRUSTED_PROXY_HOPS": "2"})
    assert settings.auth_mode == "workos"
    assert settings.log_format == "json"
    assert settings.run_migrations_on_start == "1"
    assert settings.trusted_proxy_hops == 2
    assert not settings.is_local


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_deployed_environments_require_a_database_url(environment: str) -> None:
    with pytest.raises(ConfigError, match="DATABASE_URL is required"):
        from_env({**without(DEPLOYED, "DATABASE_URL"), "ENVIRONMENT": environment})


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_dev_auth_is_refused_when_deployed(environment: str) -> None:
    with pytest.raises(ConfigError, match="AUTH_MODE=dev is refused"):
        from_env({**DEPLOYED, "ENVIRONMENT": environment, "AUTH_MODE": "dev"})


@pytest.mark.parametrize("variable", sorted(WORKOS))
def test_workos_mode_requires_its_credentials(variable: str) -> None:
    with pytest.raises(ConfigError, match=f"{variable} is required when AUTH_MODE=workos"):
        from_env(without(DEPLOYED, variable))


def test_workos_mode_can_be_chosen_locally() -> None:
    assert from_env({"AUTH_MODE": "workos", **WORKOS}).auth_mode == "workos"
    with pytest.raises(ConfigError, match="WORKOS_API_KEY is required"):
        from_env({"AUTH_MODE": "workos", **without(WORKOS, "WORKOS_API_KEY")})


def fernet_accepts(key: str) -> bool:
    try:
        Fernet(key)
    except ValueError:
        return False
    return True


@pytest.mark.parametrize(
    ("password", "valid"),
    [
        (FERNET_KEY, True),
        # Standard base64 with + and / (what Terraform's random_bytes emits) decodes the same way.
        (base64.b64encode(b"\xfb\xef\xbe" * 10 + b"\xff\xff").decode(), True),
        ("p" * 31, False),
        ("p" * 44, False),
        (base64.urlsafe_b64encode(bytes(31)).decode(), False),
        (base64.urlsafe_b64encode(bytes(33)).decode(), False),
        (FERNET_KEY.rstrip("="), False),
        ("ü" * 44, False),
    ],
)
def test_cookie_password_must_be_a_key_fernet_accepts(password: str, valid: bool) -> None:
    """The WorkOS SDK seals sessions with Fernet, so the rule is checked against Fernet itself."""
    assert fernet_accepts(password) is valid
    if valid:
        assert from_env({**DEPLOYED, "WORKOS_COOKIE_PASSWORD": password}).auth_mode == "workos"
    else:
        with pytest.raises(ConfigError, match="WORKOS_COOKIE_PASSWORD must be a Fernet key"):
            from_env({**DEPLOYED, "WORKOS_COOKIE_PASSWORD": password})


def test_every_problem_is_reported_at_once() -> None:
    with pytest.raises(ConfigError) as caught:
        from_env(without(without(DEPLOYED, "DATABASE_URL"), "WORKOS_API_KEY"))
    assert "DATABASE_URL is required" in str(caught.value)
    assert "WORKOS_API_KEY is required" in str(caught.value)


@pytest.mark.parametrize(
    "url",
    [
        "localhost:5199",
        "http://localhost:5199/",
        "https://vocal.example.com/app",
        "ftp://vocal.example.com",
        "https://",
        "https://vocal.example.com?next=/",
        "https://user:pw@vocal.example.com",
        "https://vocal.example.com:port",
    ],
)
def test_app_base_url_must_be_a_bare_origin(url: str) -> None:
    with pytest.raises(ConfigError, match="APP_BASE_URL"):
        from_env({"APP_BASE_URL": url})


@pytest.mark.parametrize(
    ("url", "origin"),
    [
        ("http://localhost:5199", "http://localhost:5199"),
        ("https://Vocal.Example.com:443", "https://vocal.example.com"),
        ("http://vocal.example.com:80", "http://vocal.example.com"),
        ("https://vocal.example.com:8443", "https://vocal.example.com:8443"),
        ("http://[::1]:8799", "http://[::1]:8799"),
    ],
)
def test_origin_is_the_base_url_as_a_browser_sends_it(url: str, origin: str) -> None:
    assert from_env({"APP_BASE_URL": url}).origin == origin


@pytest.mark.parametrize(
    ("variable", "value"),
    [
        ("ENVIRONMENT", "prod"),
        ("AUTH_MODE", "magic-code"),
        ("LOG_FORMAT", "xml"),
        ("LOG_LEVEL", "LOUD"),
        ("TRUSTED_PROXY_HOPS", "-1"),
        ("TRUSTED_PROXY_HOPS", "lb"),
        ("RUN_MIGRATIONS_ON_START", "maybe"),
        # entrypoint.sh migrates only on "1", so a spelling it would skip must not start the server either.
        ("RUN_MIGRATIONS_ON_START", "true"),
    ],
)
def test_invalid_values_name_their_variable(variable: str, value: str) -> None:
    with pytest.raises(ConfigError, match=variable):
        from_env({variable: value})


def test_log_level_is_case_insensitive() -> None:
    assert from_env({"LOG_LEVEL": "debug"}).log_level == "DEBUG"


@pytest.mark.parametrize("url", ["postgresql://vocal@db/vocal", "mysql://vocal@db/vocal", "not a url"])
def test_database_url_must_use_a_supported_driver(url: str) -> None:
    with pytest.raises(ConfigError, match="DATABASE_URL must be a sqlite:// or postgresql\\+psycopg:// URL"):
        from_env({"DATABASE_URL": url})


def test_errors_and_repr_never_echo_secret_values() -> None:
    with pytest.raises(ConfigError) as caught:
        from_env({**DEPLOYED, "DATABASE_URL": "mysql://vocal:hunter2@db/vocal", "WORKOS_COOKIE_PASSWORD": "short-secret"})
    assert "hunter2" not in str(caught.value)
    assert "short-secret" not in str(caught.value)
    assert "hunter2" not in repr(from_env(DEPLOYED))
    assert WORKOS["WORKOS_API_KEY"] not in repr(from_env(DEPLOYED))


def test_empty_values_count_as_unset() -> None:
    settings = from_env({"DATABASE_URL": "", "SPA_DIST_DIR": "  ", "AUTH_ALLOWED_EMAILS": "", "LOG_LEVEL": ""})
    assert settings == from_env({})


def test_spa_dist_dir_must_hold_a_build(tmp_path: Path, spa_dist: Path) -> None:
    assert from_env({"SPA_DIST_DIR": str(spa_dist)}).spa_dist_dir == spa_dist
    with pytest.raises(ConfigError, match="SPA_DIST_DIR: .* has no index.html"):
        from_env({"SPA_DIST_DIR": str(tmp_path / "missing")})


def test_allowed_emails_parse_and_match() -> None:
    settings = from_env({"AUTH_ALLOWED_EMAILS": " Alto@Example.com, @School.edu ,"})
    assert settings.auth_allowed_emails == ("alto@example.com", "@school.edu")
    assert settings.email_allowed("ALTO@example.com", verified=True)
    assert settings.email_allowed("anyone@school.edu", verified=True)
    assert not settings.email_allowed("other@example.com", verified=True)
    assert not settings.email_allowed("someone@sub.school.edu", verified=True)
    assert not settings.email_allowed("someone@notschool.edu", verified=True)
    # An unverified address could be anyone's.
    assert not settings.email_allowed("alto@example.com", verified=False)


def test_an_empty_allowlist_means_open_signup() -> None:
    assert from_env({}).email_allowed("anyone@anywhere.example", verified=False)


@pytest.mark.parametrize("entry", ["alto", "alto@", "a@b@c"])
def test_allowlist_entries_must_be_emails_or_domains(entry: str) -> None:
    with pytest.raises(ConfigError, match="AUTH_ALLOWED_EMAILS"):
        from_env({"AUTH_ALLOWED_EMAILS": entry})


def test_direct_construction_applies_the_same_rules() -> None:
    with pytest.raises(ValidationError, match="DATABASE_URL is required"):
        Settings(
            environment="production",
            auth_mode="workos",
            workos_client_id=WORKOS["WORKOS_CLIENT_ID"],
            workos_api_key=SecretStr(WORKOS["WORKOS_API_KEY"]),
            workos_cookie_password=SecretStr(WORKOS["WORKOS_COOKIE_PASSWORD"]),
        )


def test_settings_are_immutable() -> None:
    settings = from_env({})
    with pytest.raises(ValidationError):
        settings.release = "changed"
