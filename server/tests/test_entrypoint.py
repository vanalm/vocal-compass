"""The container entrypoint: migrate when asked, refuse to start when that fails, then become the command."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import sqlalchemy as sa
from alembic.script import ScriptDirectory

from support import SERVER_DIR, alembic_config

ENTRYPOINT = SERVER_DIR / "entrypoint.sh"


def start(tmp_path: Path, command: list[str], **environ: str) -> tuple[subprocess.Popen[str], str, str]:
    """Run the entrypoint as the container does, with this interpreter's alembic first on PATH."""
    env = {"PATH": f"{Path(sys.executable).parent}{os.pathsep}{os.environ['PATH']}", "ENVIRONMENT": "test", **environ}
    process = subprocess.Popen(
        [str(ENTRYPOINT), *command], cwd=tmp_path, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    out, err = process.communicate(timeout=120)
    return process, out, err


def test_it_migrates_then_becomes_the_command(tmp_path: Path) -> None:
    database = tmp_path / "vc.db"
    command = [sys.executable, "-c", "import os; print(os.getpid())"]
    process, out, err = start(tmp_path, command, RUN_MIGRATIONS_ON_START="1", DATABASE_URL=f"sqlite:///{database}")
    assert process.returncode == 0, err
    # exec: the command is the entrypoint's own process, so the container's signals reach it.
    assert int(out.splitlines()[-1]) == process.pid
    engine = sa.create_engine(f"sqlite:///{database}")
    try:
        with engine.connect() as connection:
            version = connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()
    finally:
        engine.dispose()
    assert version == ScriptDirectory.from_config(alembic_config()).get_current_head()


def test_a_failed_migration_stops_the_server_starting(tmp_path: Path) -> None:
    unreachable = f"sqlite:///{tmp_path / 'missing' / 'vc.db'}"
    command = [sys.executable, "-c", "print('server started')"]
    process, out, err = start(tmp_path, command, RUN_MIGRATIONS_ON_START="1", DATABASE_URL=unreachable)
    assert process.returncode == 1
    assert "entrypoint: alembic upgrade head failed; not starting the server" in err
    assert "server started" not in out


def test_without_the_flag_it_only_runs_the_command(tmp_path: Path) -> None:
    database = tmp_path / "vc.db"
    command = [sys.executable, "-c", "print('server started'); raise SystemExit(3)"]
    process, out, _ = start(tmp_path, command, DATABASE_URL=f"sqlite:///{database}")
    assert (process.returncode, out.strip()) == (3, "server started")
    assert not database.exists()
