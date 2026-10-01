"""Shared pytest fixtures for FilePlus tests."""
import pytest
from pathlib import Path

import backend.config as _config
from backend.database import init_db


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """Temporary sandbox directory wired into config.

    Patches FILEPLUS_SANDBOX_PATH, FILEPLUS_DB_PATH, WRITE_UNLOCKED, FILEPLUS_ENV,
    PROTECTED_WRITE_ROOTS, SYSTEM_WRITE_ROOTS, and FILEPLUS_API_TOKEN (cleared
    to "") so every test runs in isolation with a real (but throwaway)
    filesystem and database, and without auth gating unrelated requests. Both
    root lists are cleared here because tmp dirs can live under any root (e.g.
    a user profile under Program Files on some CI images, or the real
    %SystemRoot%); tests that need a protected root set their own via
    monkeypatch.

    The sandbox is a *subdirectory* of tmp_path so that test.db (at tmp_path
    root) is never inside the scanned directory and won't show up in counts.
    """
    sandbox_dir = tmp_path / "sandbox"
    sandbox_dir.mkdir()
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(_config, "FILEPLUS_SANDBOX_PATH", sandbox_dir)
    monkeypatch.setattr(_config, "FILEPLUS_DB_PATH", db_path)
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", False)
    # Dev harness phase 2: every test runs in the test environment, where the
    # guard refuses any write outside the root whatever WRITE_UNLOCKED says.
    # A test that exercises the unlocked path sets FILEPLUS_ENV="prod" too.
    monkeypatch.setattr(_config, "FILEPLUS_ENV", "test")
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [])
    # Never let a real FILEPLUS_API_TOKEN in the dev's environment (e.g. left
    # over from a verify.ps1 run) gate unrelated tests; test_api_auth.py sets
    # its own value per test via monkeypatch.
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "")
    # The API's lifespan calls ensure_api_token(), which in a real backend
    # mints and persists a token when none is configured. Under test that
    # would both gate every other suite's requests and write a token file
    # into the repo, so it is stubbed to hand back whatever the test has set
    # FILEPLUS_API_TOKEN to (""), and the token file is pointed at tmp_path.
    # tests/test_api_auth.py restores the real function where it is the
    # subject of the test.
    monkeypatch.setattr(_config, "FILEPLUS_TOKEN_FILE", tmp_path / ".fileplus-token")
    monkeypatch.setattr(_config, "ensure_api_token", lambda: _config.FILEPLUS_API_TOKEN)
    return sandbox_dir


@pytest.fixture
async def db(sandbox, tmp_path):
    """Initialise the database outside the sandbox and return its path."""
    db_path = tmp_path / "test.db"
    await init_db(db_path)
    return db_path
