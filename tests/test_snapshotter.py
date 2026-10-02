"""backend.snapshotter is a stub until the Overhaul stage of the roadmap
(docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md): snapshots of
a tree that can be listed, viewed, compared and restored.

strict xfail: when create_snapshot() is implemented this test XPASSes, which
fails the run on purpose -- remove the marker and grow the real tests then.
"""
import aiosqlite
import pytest

from backend import snapshotter


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="snapshotter is a stub (roadmap: Overhaul stage)")
async def test_snapshot_is_created_and_listed(db):
    async with aiosqlite.connect(db) as conn:
        snap_id = await snapshotter.create_snapshot("before sort", "manual", conn)
        assert isinstance(snap_id, int)
        listed = await snapshotter.list_snapshots(conn)
        assert any(s["id"] == snap_id for s in listed)
