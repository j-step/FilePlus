"""backend.watcher is a stub until Stage 3 (Sort) of the roadmap
(docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md, Stage 3):
"a file dropped in the Everything Folder appears in the Review Bin with a
proposal within seconds; approve moves it via mover.py".

This is also the automatic half of the safety rule "nothing moves without
approval": a watched file must be PROPOSED, never moved, until a user
approves it. strict xfail -- when the watcher is built this XPASSes and fails
the run on purpose; remove the marker then.
"""
import sqlite3
import time

import pytest

import backend.config as _config
from backend import watcher


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="watcher/approvals queue are a Stage 3 stub (roadmap Stage 3)")
def test_dropped_file_is_proposed_not_moved(sandbox, db, monkeypatch):
    inbox = sandbox / "Everything"
    inbox.mkdir()
    monkeypatch.setattr(_config, "FILEPLUS_EVERYTHING_PATH", inbox)
    watcher.start_watcher()
    try:
        dropped = inbox / "invoice-2026-09.pdf"
        dropped.write_bytes(b"%PDF-1.4\n")
        deadline = time.monotonic() + 2
        rows = []
        while time.monotonic() < deadline and not rows:
            with sqlite3.connect(db) as c:
                rows = c.execute("SELECT a.resolved FROM approvals a JOIN files f ON f.id = a.file_id "
                                 "WHERE f.path = ?", (str(dropped),)).fetchall()
            time.sleep(0.1)
        assert rows, "no approval row was queued for the dropped file"
        assert rows[0][0] == 0, "the proposal was resolved without a user"
        assert dropped.exists(), "the file moved before anyone approved it"
    finally:
        watcher.stop_watcher()
