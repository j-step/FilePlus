"""Task 8a item (6): undo/redo inverses for the DB-only ops (tags,
favorites, pins). Before this, backend.mover.undo_operation fell through to
"Operation type '...' has no inverse." (RefusedError -> 409) for every one
of these op_types; now each has a real inverse, logged the same way file-op
undo already is: a fresh row with undo_of=<original id>, the original
marked undone=1.
"""
import aiosqlite
import pytest

from backend import mover, operations_log as ol, stores, tagger
from backend.indexer import index_file


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


def _mk(sandbox, rel, content="x"):
    p = sandbox / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return p


async def _only(conn, op_type):
    rows = [r for r in await ol.list_operations(conn) if r["op_type"] == op_type]
    assert len(rows) == 1, f"expected exactly one {op_type!r} row, found {len(rows)}"
    return rows[0]


# ---- tag-add / tag-remove ---------------------------------------------------

async def test_undo_tag_add_removes_only_that_tag_and_preserves_others(conn, sandbox):
    p = _mk(sandbox, "doc.txt")
    fid = await index_file(p, conn); await conn.commit()
    await tagger.apply_tags(conn, fid, ["existing"])
    await tagger.apply_tags(conn, fid, ["fresh"])
    add_op = [r for r in await ol.list_operations(conn) if r["op_type"] == "tag-add" and r["dest_path"] == "fresh"][0]

    inv = await mover.undo_operation(conn, add_op["id"])

    assert inv["op_type"] == "tag-remove" and inv["status"] == "done"
    names = {t["name"] for t in await tagger.get_tags(conn, fid)}
    assert names == {"existing"}, "the unrelated pre-existing tag must survive"
    assert (await ol.get_operation(conn, add_op["id"]))["undone"] == 1
    assert (await ol.get_operation(conn, inv["op_id"]))["undo_of"] == add_op["id"]


async def test_undo_tag_remove_readds_the_tag(conn, sandbox):
    p = _mk(sandbox, "doc2.txt")
    fid = await index_file(p, conn); await conn.commit()
    ids = await tagger.apply_tags(conn, fid, ["work"])
    await tagger.remove_tag(conn, fid, ids[0])
    remove_op = await _only(conn, "tag-remove")

    inv = await mover.undo_operation(conn, remove_op["id"])

    assert inv["op_type"] == "tag-add" and inv["status"] == "done"
    assert {t["name"] for t in await tagger.get_tags(conn, fid)} == {"work"}
    assert (await ol.get_operation(conn, remove_op["id"]))["undone"] == 1


async def test_undo_tag_add_then_redo(conn, sandbox):
    p = _mk(sandbox, "doc3.txt")
    fid = await index_file(p, conn); await conn.commit()
    await tagger.apply_tags(conn, fid, ["work"])
    add_op = await _only(conn, "tag-add")

    inv = await mover.undo_operation(conn, add_op["id"])
    assert await tagger.get_tags(conn, fid) == []

    redo = await mover.undo_operation(conn, inv["op_id"])  # undo of the undo == redo
    assert redo["op_type"] == "tag-add" and redo["status"] == "done"
    assert {t["name"] for t in await tagger.get_tags(conn, fid)} == {"work"}
    assert (await ol.get_operation(conn, redo["op_id"]))["undo_of"] == inv["op_id"]
    assert (await ol.get_operation(conn, inv["op_id"]))["undone"] == 1


async def test_undo_tag_add_refused_when_file_no_longer_indexed(conn, sandbox):
    p = _mk(sandbox, "gone.txt")
    fid = await index_file(p, conn); await conn.commit()
    await tagger.apply_tags(conn, fid, ["work"])
    add_op = await _only(conn, "tag-add")
    await conn.execute("DELETE FROM files WHERE id = ?", (fid,)); await conn.commit()

    with pytest.raises(mover.RefusedError):
        await mover.undo_operation(conn, add_op["id"])


# ---- favorite-add / favorite-remove ----------------------------------------

async def test_undo_favorite_add_and_redo_roundtrip(conn, sandbox):
    p = str(_mk(sandbox, "fav.txt"))
    await stores.favorites_add(conn, p)
    add_op = await _only(conn, "favorite-add")

    inv = await mover.undo_operation(conn, add_op["id"])
    assert inv["op_type"] == "favorite-remove" and inv["status"] == "done"
    assert (await stores.favorites_list(conn))["files"] == []
    assert (await ol.get_operation(conn, add_op["id"]))["undone"] == 1

    redo = await mover.undo_operation(conn, inv["op_id"])
    assert redo["op_type"] == "favorite-add" and redo["status"] == "done"
    assert [f["path"] for f in (await stores.favorites_list(conn))["files"]] == [p]


async def test_undo_favorite_remove_readds_it(conn, sandbox):
    p = str(_mk(sandbox, "fav2.txt"))
    await stores.favorites_add(conn, p)
    await stores.favorites_remove(conn, p)
    remove_op = await _only(conn, "favorite-remove")

    inv = await mover.undo_operation(conn, remove_op["id"])
    assert inv["op_type"] == "favorite-add" and inv["status"] == "done"
    assert [f["path"] for f in (await stores.favorites_list(conn))["files"]] == [p]


# ---- pin-add / pin-remove ---------------------------------------------------

async def test_undo_pin_add_and_redo_roundtrip(conn, sandbox):
    d = sandbox / "Projects"; d.mkdir()
    p = str(d)
    await stores.pins_add(conn, p, "My Projects")
    add_op = await _only(conn, "pin-add")

    inv = await mover.undo_operation(conn, add_op["id"])
    assert inv["op_type"] == "pin-remove" and inv["status"] == "done"
    assert await stores.pins_list(conn) == []
    assert (await ol.get_operation(conn, add_op["id"]))["undone"] == 1

    redo = await mover.undo_operation(conn, inv["op_id"])
    assert redo["op_type"] == "pin-add" and redo["status"] == "done"
    pins = await stores.pins_list(conn)
    assert len(pins) == 1 and pins[0]["path"] == p


async def test_undo_pin_remove_readds_it(conn, sandbox):
    d = sandbox / "Docs"; d.mkdir()
    p = str(d)
    await stores.pins_add(conn, p)
    pins = await stores.pins_list(conn)
    await stores.pins_remove(conn, pins[0]["id"])
    remove_op = await _only(conn, "pin-remove")

    inv = await mover.undo_operation(conn, remove_op["id"])
    assert inv["op_type"] == "pin-add" and inv["status"] == "done"
    pins = await stores.pins_list(conn)
    assert len(pins) == 1 and pins[0]["path"] == p


# ---- unknown / unsupported op types keep raising ---------------------------

async def test_undo_config_change_still_has_no_inverse(conn, sandbox):
    await stores.config_set(conn, "ui.theme", "dark")
    op = await _only(conn, "config-change")
    with pytest.raises(mover.RefusedError):
        await mover.undo_operation(conn, op["id"])
