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
