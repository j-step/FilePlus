"""Shared pytest fixtures for FilePlus tests."""
import pytest
from pathlib import Path

import backend.config as _config
from backend.database import init_db


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """Temporary sandbox directory wired into config.

    Patches FILEPLUS_SANDBOX_PATH, FILEPLUS_DB_PATH, WRITE_UNLOCKED,
    PROTECTED_WRITE_ROOTS, and SYSTEM_WRITE_ROOTS so every test runs in
    isolation with a real (but throwaway) filesystem and database. Both root
    lists are cleared here because tmp dirs can live under any root (e.g. a
    user profile under Program Files on some CI images, or the real
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
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [])
    return sandbox_dir


@pytest.fixture
async def db(sandbox, tmp_path):
    """Initialise the database outside the sandbox and return its path."""
    db_path = tmp_path / "test.db"
    await init_db(db_path)
    return db_path
