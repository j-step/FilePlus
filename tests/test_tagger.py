"""Tests for backend.tagger."""
import aiosqlite
import pytest
from backend import tagger
from backend.indexer import index_file


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


async def test_apply_get_remove(conn, sandbox):
    p = sandbox / "a.txt"; p.write_text("a")
    fid = await index_file(p, conn); await conn.commit()
    ids = await tagger.apply_tags(conn, fid, ["work", "work", "docs"])
    assert len(ids) == 2
    assert {t["name"] for t in await tagger.get_tags(conn, fid)} == {"work", "docs"}
    await tagger.remove_tag(conn, fid, ids[0])
    assert len(await tagger.get_tags(conn, fid)) == 1
    assert [t["name"] for t in await tagger.search_tags(conn, "do")] == ["docs"]


async def test_apply_and_remove_tag_log_before_act_and_mark_executed(conn, sandbox):
    from backend import operations_log as ol

    p = sandbox / "b.txt"; p.write_text("b")
    fid = await index_file(p, conn); await conn.commit()
    ids = await tagger.apply_tags(conn, fid, ["work", "docs"])
    await tagger.remove_tag(conn, fid, ids[0])

    cur = await conn.execute("SELECT op_type, executed FROM operations_log WHERE op_type LIKE 'tag-%'")
    rows = await cur.fetchall()
    assert len(rows) == 3
    assert all(r["executed"] == 1 for r in rows)
    assert await ol.pending_operations(conn) == []


async def test_paths_for_tag(conn, sandbox):
    p1 = sandbox / "one.txt"; p1.write_text("1")
    p2 = sandbox / "two.txt"; p2.write_text("2")
    fid1 = await index_file(p1, conn)
    fid2 = await index_file(p2, conn)
    await conn.commit()
    await tagger.apply_tags(conn, fid1, ["keep"])
    await tagger.apply_tags(conn, fid2, ["other"])

    assert await tagger.paths_for_tag(conn, "keep") == {str(p1)}
    assert await tagger.paths_for_tag(conn, "nonexistent-tag") == set()
