"""operations_log: log-before-act rows, marks, listing, crash reconciliation."""
import aiosqlite
import pytest

import backend.config as _config
from backend import operations_log as ol


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


async def test_log_then_mark_executed(conn):
    op_id = await ol.log_operation(conn, "move", "C:/a.txt", "C:/b/a.txt", batch_id="b1", reason="test")
    row = await ol.get_operation(conn, op_id)
    assert row["executed"] == 0 and row["undone"] == 0 and row["error"] is None
    assert row["batch_id"] == "b1" and row["reason"] == "test"
    await ol.mark_executed(conn, op_id)
    assert (await ol.get_operation(conn, op_id))["executed"] == 1


async def test_mark_error_and_undone(conn):
    op_id = await ol.log_operation(conn, "rename", "x", "y")
    await ol.mark_error(conn, op_id, "boom")
    assert (await ol.get_operation(conn, op_id))["error"] == "boom"
    await ol.mark_undone(conn, op_id)
    assert (await ol.get_operation(conn, op_id))["undone"] == 1


async def test_list_orders_newest_first_and_filters_by_path(conn):
    a = await ol.log_operation(conn, "move", "p1", "p2", batch_id="b")
    b = await ol.log_operation(conn, "move", "p3", "p1", batch_id="b")
    rows = await ol.list_operations(conn)
    assert [r["id"] for r in rows] == [b, a]
    rows = await ol.list_operations(conn, path="p3")
    assert [r["id"] for r in rows] == [b]
    batch = await ol.list_batch(conn, "b")
    assert [r["id"] for r in batch] == [b, a]


async def test_undo_of_link(conn):
    a = await ol.log_operation(conn, "move", "p1", "p2")
    inv = await ol.log_operation(conn, "move", "p2", "p1", undo_of=a)
    assert (await ol.get_operation(conn, inv))["undo_of"] == a


async def test_reconcile_pending(conn, sandbox):
    done_src, done_dst = sandbox / "done_src.txt", sandbox / "done_dst.txt"
    done_dst.write_text("moved")                      # dest exists, source gone => completed
    ns_src = sandbox / "ns.txt"
    ns_src.write_text("still here")                   # source exists, dest missing => not-started
    a = await ol.log_operation(conn, "move", str(done_src), str(done_dst))
    b = await ol.log_operation(conn, "move", str(ns_src), str(sandbox / "ns_dst.txt"))
    c = await ol.log_operation(conn, "move", str(sandbox / "gone1"), str(sandbox / "gone2"))  # neither => ambiguous
    d = await ol.log_operation(conn, "move", "q", "r")
    await ol.mark_executed(conn, d)                   # not pending
    result = await ol.reconcile_pending(conn)
    by_id = {r["id"]: r["resolution"] for r in result}
    assert by_id == {a: "completed", b: "not-started", c: "ambiguous"}
    assert (await ol.get_operation(conn, a))["executed"] == 1
    assert (await ol.get_operation(conn, b))["error"] == "not-started"
    assert (await ol.get_operation(conn, c))["error"] == "ambiguous"
    assert await ol.pending_operations(conn) == []
