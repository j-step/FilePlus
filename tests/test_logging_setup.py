"""Phase 1 (dev harness): the backend writes a readable log file.

backend.log must carry every request, every error with its traceback, and
every file operation with source and destination, so a failure can be read
from a file instead of described.
"""
import logging

import pytest
from fastapi.testclient import TestClient

from backend import logging_setup


@pytest.fixture
def backend_log(tmp_path):
    """Install the real handlers into tmp_path, and remove them afterwards so
    no other test writes into this file."""
    root = logging.getLogger()
    before = list(root.handlers)
    level = root.level
    log_file = logging_setup.setup_logging(tmp_path / "logs", console=False)
    yield log_file
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()
    root.setLevel(level)


def _read(log_file):
    for h in logging.getLogger().handlers:
        h.flush()
    return log_file.read_text(encoding="utf-8")


def test_setup_logging_creates_file_and_is_idempotent(backend_log):
    assert backend_log.name == "backend.log" and backend_log.exists()
    n = len(logging.getLogger().handlers)
    assert logging_setup.setup_logging(backend_log.parent, console=False) == backend_log
    assert len(logging.getLogger().handlers) == n


def test_log_line_has_timestamp_level_and_module(backend_log):
    logging.getLogger("backend.example").info("hello harness")
    line = _read(backend_log).strip().splitlines()[-1]
    assert "INFO" in line and "backend.example" in line and "hello harness" in line
    assert line[:4].isdigit() and line[4] == "-"  # 2026-..


def test_requests_errors_and_file_operations_are_logged(backend_log, sandbox, db):
    from backend.api import app
    src = sandbox / "a.txt"
    src.write_text("a")
    (sandbox / "dest").mkdir()
    with TestClient(app) as client:
        assert client.post("/fs/move", json={"sources": [str(src)], "dest": str(sandbox / "dest")}).status_code == 200
        assert client.post("/fs/rename", json={"path": r"C:\Windows\win.ini", "new_name": "x.ini"}).status_code == 403
    text = _read(backend_log)
    assert "POST /fs/move -> 200" in text
    assert "POST /fs/rename -> 403" in text
    assert "refused (403)" in text
    assert f"move: {src} -> {sandbox / 'dest'}" in text  # source and destination of the file operation


def test_unhandled_error_is_logged_with_traceback(backend_log, sandbox, monkeypatch):
    from backend import api

    def boom(*_a, **_k):
        raise RuntimeError("deliberate harness failure")

    monkeypatch.setattr(api, "_listing_response", boom)
    with TestClient(api.app, raise_server_exceptions=False) as client:
        assert client.get("/fs/list", params={"path": str(sandbox)}).status_code == 500
    text = _read(backend_log)
    assert "GET /fs/list?path=" in text and "unhandled error" in text
    assert "Traceback (most recent call last)" in text and "deliberate harness failure" in text
