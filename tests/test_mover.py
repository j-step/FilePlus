"""mover: every mutation is guarded, logged before acting, and reversible."""
import ctypes
import os
from pathlib import Path

import aiosqlite
import pytest

import backend.config as _config
from backend import mover, operations_log as ol
from backend.config import OutOfSandboxError


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


# ---- names / helpers -------------------------------------------------------

@pytest.mark.parametrize("bad", ["", "a/b", "a\\b", "con", "NUL", "COM1", "x.", "x ", "a:b", "a?b", ".", "..", "a\x00b", "con.txt", "NUL.txt"])
def test_validate_name_rejects(bad):
    with pytest.raises(mover.InvalidNameError):
        mover.validate_name(bad)


@pytest.mark.parametrize("ok", ["a.txt", "Résumé (final).docx", "no-ext", ".hidden"])
def test_validate_name_accepts(ok):
    mover.validate_name(ok)


def test_keep_both_name(sandbox):
    _mk(sandbox, "r.txt"); _mk(sandbox, "r (2).txt")
    assert mover.keep_both_name(sandbox / "r.txt").name == "r (3).txt"
    assert mover.keep_both_name(sandbox / "fresh.txt").name == "fresh.txt"


def test_trash_root_inside_sandbox(sandbox):
    assert mover.trash_root_for(sandbox / "deep" / "f.txt") == sandbox / _config.TRASH_DIRNAME


def test_trash_root_outside_sandbox_is_volume_root(sandbox, tmp_path):
    outside = tmp_path / "o" / "f.txt"
    drive = Path(os.path.splitdrive(str(outside.resolve()))[0] + "\\")
    assert mover.trash_root_for(outside) == drive / _config.TRASH_DIRNAME


# ---- move ------------------------------------------------------------------

async def test_move_logs_before_and_marks_after(conn, sandbox):
    src = _mk(sandbox, "a/one.txt", "1")
    dest_dir = sandbox / "b"; dest_dir.mkdir()
    r = await mover.move(conn, src, dest_dir)
    assert r["status"] == "done"
    assert not src.exists() and (dest_dir / "one.txt").read_text() == "1"
    row = await ol.get_operation(conn, r["op_id"])
    assert row["op_type"] == "move" and row["executed"] == 1
    assert row["source_path"] == str(src.resolve()) and row["dest_path"] == str((dest_dir / "one.txt").resolve())


async def test_move_directory(conn, sandbox):
    _mk(sandbox, "src/dir/inner.txt")
    (sandbox / "dst").mkdir()
    r = await mover.move(conn, sandbox / "src" / "dir", sandbox / "dst")
    assert r["status"] == "done" and (sandbox / "dst" / "dir" / "inner.txt").exists()


async def test_move_conflict_policies(conn, sandbox):
    _mk(sandbox, "a/f.txt", "new"); _mk(sandbox, "b/f.txt", "old")
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b")  # fail
    assert r["status"] == "conflict" and (sandbox / "a/f.txt").exists()
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="skip")
    assert r["status"] == "skipped"
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="keep-both")
    assert r["status"] == "done" and (sandbox / "b" / "f (2).txt").read_text() == "new"
    _mk(sandbox, "a/f.txt", "newer")
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="replace")
    assert r["status"] == "done" and (sandbox / "b/f.txt").read_text() == "newer"
    # the replaced file was trashed (logged), not deleted
    trashed = list((sandbox / _config.TRASH_DIRNAME).rglob("f.txt"))
    assert len(trashed) == 1 and trashed[0].read_text() == "old"


async def test_move_bad_on_conflict_raises_even_without_conflict(conn, sandbox):
    """on_conflict is validated up front, before any conflict-resolution logic
    runs -- so a bogus policy raises even for a clean, conflict-free move."""
    src = _mk(sandbox, "a/clean.txt", "1")
    (sandbox / "b").mkdir()
    with pytest.raises(ValueError):
        await mover.move(conn, src, sandbox / "b", on_conflict="bogus")
    assert src.exists()
    assert await ol.list_operations(conn) == []


async def test_move_into_self_refused(conn, sandbox):
    _mk(sandbox, "d/x.txt")
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, sandbox / "d", sandbox / "d")
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, sandbox / "d", sandbox / "d" / "sub")


async def test_move_outside_sandbox_refused_and_not_logged(conn, sandbox, tmp_path):
    src = _mk(sandbox, "z.txt")
    outside = tmp_path / "out"; outside.mkdir()
    with pytest.raises(OutOfSandboxError):
        await mover.move(conn, src, outside)
    assert src.exists() and await ol.list_operations(conn) == []


async def test_cross_volume_move_copies_verifies_removes(conn, sandbox, monkeypatch):
    src = _mk(sandbox, "big.bin", "payload" * 1000)
    dest_dir = sandbox / "elsewhere"; dest_dir.mkdir()
    monkeypatch.setattr(mover, "same_volume", lambda a, b: False)
    r = await mover.move(conn, src, dest_dir)
    assert r["status"] == "done" and not src.exists()
    assert (dest_dir / "big.bin").read_text() == "payload" * 1000


async def test_disk_space_refusal(conn, sandbox, monkeypatch):
    src = _mk(sandbox, "s.txt", "abc")
    (sandbox / "t").mkdir()
    monkeypatch.setattr(mover, "same_volume", lambda a, b: False)
    monkeypatch.setattr(mover, "_free_bytes", lambda p: 0)
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, src, sandbox / "t")
    assert src.exists()


async def test_move_replace_shares_batch(conn, sandbox):
    _mk(sandbox, "a/f.txt", "new"); _mk(sandbox, "b/f.txt", "old")
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="replace")
    assert r["status"] == "done" and r["batch_id"]
    rows = await ol.list_batch(conn, r["batch_id"])
    assert len(rows) == 2
    assert {row["op_type"] for row in rows} == {"trash", "move"}


async def test_move_same_directory_refused(conn, sandbox):
    p = _mk(sandbox, "here/f.txt", "content")
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, p, sandbox / "here", on_conflict="replace")
    assert p.read_text() == "content"
    assert await ol.list_operations(conn) == []


async def test_replace_checks_space_before_trashing_target(conn, sandbox, monkeypatch):
    _mk(sandbox, "a/f.txt", "new"); _mk(sandbox, "b/f.txt", "old")
    monkeypatch.setattr(mover, "same_volume", lambda a, b: False)
    monkeypatch.setattr(mover, "_free_bytes", lambda p: 0)
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="replace")
    assert (sandbox / "b/f.txt").read_text() == "old"  # target untouched, not trashed
    assert await ol.list_operations(conn) == []


def test_move_fn_detects_race(sandbox):
    src = _mk(sandbox, "race_src.txt")
    dest = sandbox / "race_dest.txt"
    dest.write_text("already here")
    with pytest.raises(mover.ConflictError):
        mover._move_fn(src, dest)()


async def test_cross_volume_move_preserves_empty_dir(conn, sandbox, monkeypatch):
    _mk(sandbox, "tree/a.txt", "A")
    (sandbox / "tree" / "empty_sub").mkdir()
    (sandbox / "dst2").mkdir()
    monkeypatch.setattr(mover, "same_volume", lambda a, b: False)
    r = await mover.move(conn, sandbox / "tree", sandbox / "dst2")
    assert r["status"] == "done"
    assert (sandbox / "dst2" / "tree" / "empty_sub").is_dir()


def test_verify_copy_catches_missing_empty_dir(sandbox):
    src = sandbox / "vsrc"
    (src / "sub").mkdir(parents=True)
    (src / "f.txt").write_text("x")
    dest = sandbox / "vdst"
    dest.mkdir()
    (dest / "f.txt").write_text("x")  # dest is missing the empty "sub" directory
    with pytest.raises(mover.RefusedError):
        mover._verify_copy(src, dest)


# ---- rename / mkdir / touch / copy ----------------------------------------

async def test_rename(conn, sandbox):
    p = _mk(sandbox, "old.txt")
    r = await mover.rename(conn, p, "new.txt")
    assert r["status"] == "done" and (sandbox / "new.txt").exists() and not p.exists()
    with pytest.raises(mover.InvalidNameError):
        await mover.rename(conn, sandbox / "new.txt", "bad/name")
    _mk(sandbox, "taken.txt")
    with pytest.raises(mover.ConflictError):
        await mover.rename(conn, sandbox / "new.txt", "taken.txt")


async def test_mkdir_and_touch(conn, sandbox):
    r = await mover.mkdir(conn, sandbox, "Folder")
    assert (sandbox / "Folder").is_dir() and r["op_type"] == "mkdir"
    r = await mover.touch(conn, sandbox / "Folder", "note.txt")
    assert (sandbox / "Folder" / "note.txt").stat().st_size == 0 and r["op_type"] == "touch"
    with pytest.raises(mover.ConflictError):
        await mover.mkdir(conn, sandbox, "Folder")


async def test_copy_file_and_dir(conn, sandbox):
    _mk(sandbox, "c/a.txt", "A"); _mk(sandbox, "c/sub/b.txt", "B")
    (sandbox / "out").mkdir()
    r = await mover.copy(conn, sandbox / "c" / "a.txt", sandbox / "out")
    assert r["status"] == "done" and (sandbox / "out/a.txt").read_text() == "A" and (sandbox / "c/a.txt").exists()
    r = await mover.copy(conn, sandbox / "c", sandbox / "out")
    assert (sandbox / "out/c/sub/b.txt").read_text() == "B"


async def test_batch_move_skip_goes_to_skipped_not_ops(conn, sandbox):
    _mk(sandbox, "a/dup.txt", "new"); _mk(sandbox, "b/dup.txt", "old")
    res = await mover.batch_move(conn, [sandbox / "a/dup.txt"], sandbox / "b", on_conflict="skip")
    assert res["ops"] == [] and res["conflicts"] == [] and len(res["skipped"]) == 1
    assert (sandbox / "a/dup.txt").exists()  # untouched, truly skipped


# ---- trash / restore / empty ----------------------------------------------

async def test_trash_and_restore(conn, sandbox):
    p = _mk(sandbox, "docs/t.txt", "T")
    r = await mover.trash(conn, p)
    assert r["status"] == "done" and not p.exists()
    trashed = Path(r["dest"])
    assert trashed.exists() and _config.TRASH_DIRNAME in trashed.parts
    # The manifest lives beside the batch folder, never inside it (a trashed
    # file could itself be called manifest.json).
    assert mover.manifest_path_for(trashed.parent.parent, r["batch_id"]).exists()
    assert not (trashed.parent / "manifest.json").exists()
    r2 = await mover.restore(conn, trashed, p)
    assert r2["status"] == "done" and p.read_text() == "T" and not trashed.exists()


async def test_restore_conflict_keeps_both(conn, sandbox):
    p = _mk(sandbox, "k.txt", "first")
    r = await mover.trash(conn, p)
    _mk(sandbox, "k.txt", "second")
    r2 = await mover.restore(conn, Path(r["dest"]), p)
    assert r2["status"] == "done" and (sandbox / "k (2).txt").read_text() == "first"


async def test_batch_trash_and_empty(conn, sandbox, monkeypatch):
    a = _mk(sandbox, "e1.txt"); b = _mk(sandbox, "e2.txt")
    res = await mover.batch_trash(conn, [a, b])
    assert len(res["ops"]) == 2 and res["batch_id"]
    # not coupled to real drive letters: only the sandbox trash root is considered
    monkeypatch.setattr(mover, "_known_trash_roots", lambda: [sandbox / _config.TRASH_DIRNAME])
    sent = []
    monkeypatch.setattr(mover, "_send2trash", lambda p: sent.append(Path(p)))
    out = await mover.empty_trash(conn)
    # The batch folder and that batch's manifest both go to the Recycle Bin.
    assert out["batches"] == 1
    assert sorted(p.name for p in sent) == sorted([res["batch_id"], f"{res['batch_id']}.manifest.json"])
    rows = await ol.list_operations(conn)
    assert rows[0]["op_type"] == "trash-empty:final"


async def test_trash_root_is_hidden(conn, sandbox):
    p = _mk(sandbox, "h.txt")
    await mover.trash(conn, p)
    attrs = (sandbox / _config.TRASH_DIRNAME).stat().st_file_attributes
    assert attrs & 0x2


async def test_trash_guards_computed_batch_dir_before_acting(conn, sandbox, monkeypatch, tmp_path):
    p = _mk(sandbox, "g.txt")
    outside = tmp_path / "outside_trash_root"
    monkeypatch.setattr(mover, "trash_root_for", lambda path: outside)
    with pytest.raises(OutOfSandboxError):
        await mover.trash(conn, p)
    assert not outside.exists()  # guard ran before any directory was created
    assert await ol.list_operations(conn) == []
    assert p.exists()


async def test_trash_refuses_ancestor_of_trash_root(conn, sandbox):
    _mk(sandbox, "keep.txt")
    with pytest.raises(mover.RefusedError):
        await mover.trash(conn, sandbox)
    assert await ol.list_operations(conn) == []


async def test_empty_trash_skips_out_of_sandbox_roots(conn, sandbox, tmp_path, monkeypatch):
    p = _mk(sandbox, "z.txt")
    await mover.trash(conn, p)
    sandbox_root = mover.trash_root_for(sandbox / "z.txt")
    outside_root = tmp_path / "outside_trash"
    (outside_root / "batchX").mkdir(parents=True)
    monkeypatch.setattr(mover, "_known_trash_roots", lambda: [sandbox_root, outside_root])
    sent = []
    monkeypatch.setattr(mover, "_send2trash", lambda p: sent.append(Path(p)))
    out = await mover.empty_trash(conn)
    assert str(outside_root) in out["skipped_roots"]
    assert str(outside_root) not in out["roots"]
    # Only the sandbox root was emptied (its one batch folder + its manifest);
    # nothing under the refused root was touched.
    assert out["batches"] == 1
    assert all(_config.is_under(p, sandbox_root) for p in sent)
    assert not any(_config.is_under(p, outside_root) for p in sent)


def test_hide_preserves_existing_attributes(sandbox):
    d = sandbox / "preserve_me"
    d.mkdir()
    FILE_ATTRIBUTE_READONLY = 0x1
    ctypes.windll.kernel32.SetFileAttributesW(str(d), FILE_ATTRIBUTE_READONLY)
    mover._hide(d)
    attrs = d.stat().st_file_attributes
    assert attrs & FILE_ATTRIBUTE_READONLY and attrs & 0x2


def test_known_trash_roots_skips_oserror_drives(sandbox, monkeypatch):
    real_exists = Path.exists

    def flaky_exists(self):
        if str(self).upper().startswith("Z:\\"):
            raise OSError("bad netpath")
        return real_exists(self)

    monkeypatch.setattr(Path, "exists", flaky_exists)
    roots = mover._known_trash_roots()  # must not raise despite the flaky Z: drive
    assert isinstance(roots, list)


# ---- undo / redo -----------------------------------------------------------

async def test_undo_move_then_redo(conn, sandbox):
    src = _mk(sandbox, "u/a.txt", "A"); (sandbox / "v").mkdir()
    r = await mover.move(conn, src, sandbox / "v")
    inv = await mover.undo_operation(conn, r["op_id"])
    assert src.read_text() == "A" and not (sandbox / "v/a.txt").exists()
    assert (await ol.get_operation(conn, r["op_id"]))["undone"] == 1
    assert (await ol.get_operation(conn, inv["op_id"]))["undo_of"] == r["op_id"]
    redo = await mover.undo_operation(conn, inv["op_id"])          # redo = undo the inverse
    assert (sandbox / "v/a.txt").exists()
    assert (await ol.get_operation(conn, redo["op_id"]))["undo_of"] == inv["op_id"]


async def test_undo_rename_trash_copy_mkdir_touch(conn, sandbox):
    p = _mk(sandbox, "r1.txt", "R")
    r = await mover.rename(conn, p, "r2.txt")
    await mover.undo_operation(conn, r["op_id"]); assert p.exists()
    r = await mover.trash(conn, p)
    await mover.undo_operation(conn, r["op_id"]); assert p.read_text() == "R"
    (sandbox / "cp").mkdir()
    r = await mover.copy(conn, p, sandbox / "cp")
    await mover.undo_operation(conn, r["op_id"]); assert not (sandbox / "cp/r1.txt").exists()
    assert list((sandbox / _config.TRASH_DIRNAME).rglob("r1.txt"))      # the copy went to trash
    r = await mover.mkdir(conn, sandbox, "made")
    await mover.undo_operation(conn, r["op_id"]); assert not (sandbox / "made").exists()
    r = await mover.touch(conn, sandbox, "t.txt")
    await mover.undo_operation(conn, r["op_id"]); assert not (sandbox / "t.txt").exists()


async def test_undo_refusals(conn, sandbox):
    p = _mk(sandbox, "x.txt"); (sandbox / "y").mkdir()
    r = await mover.move(conn, p, sandbox / "y")
    await mover.undo_operation(conn, r["op_id"])
    with pytest.raises(mover.RefusedError):
        await mover.undo_operation(conn, r["op_id"])        # already undone
    (sandbox / "x.txt").unlink()                             # dest of the inverse gone
    inv = (await ol.list_operations(conn))[0]
    with pytest.raises(mover.RefusedError):
        await mover.undo_operation(conn, inv["id"])
    op_id = await ol.log_operation(conn, "trash-empty:final", None, None); await ol.mark_executed(conn, op_id)
    with pytest.raises(mover.RefusedError):
        await mover.undo_operation(conn, op_id)


async def test_undo_batch(conn, sandbox):
    a = _mk(sandbox, "ba.txt"); b = _mk(sandbox, "bb.txt"); (sandbox / "dst").mkdir()
    res = await mover.batch_move(conn, [a, b], sandbox / "dst")
    out = await mover.undo_batch(conn, res["batch_id"])
    assert len(out["ops"]) == 2 and out["errors"] == [] and a.exists() and b.exists()
    assert all(r["undone"] == 1 for r in await ol.list_batch(conn, res["batch_id"]))


# ---- residual audit minors --------------------------------------------------

async def test_move_conflict_no_batch_id_when_minted(conn, sandbox):
    _mk(sandbox, "a/f.txt", "new"); _mk(sandbox, "b/f.txt", "old")
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b")  # fail policy, no batch_id passed in
    assert r["status"] == "conflict" and r["batch_id"] is None
    assert await ol.list_operations(conn) == []


async def test_undo_move_keep_both_restores_original_name(conn, sandbox):
    src = _mk(sandbox, "u/a.txt", "A")
    dst = sandbox / "v"; dst.mkdir()
    _mk(sandbox, "v/a.txt", "already here")  # forces keep-both on the forward move
    r = await mover.move(conn, src, dst, on_conflict="keep-both")
    landed = Path(r["dest"])
    assert r["status"] == "done" and landed.name == "a (2).txt"
    inv = await mover.undo_operation(conn, r["op_id"])
    assert inv["status"] == "done"
    assert (sandbox / "u" / "a.txt").exists() and (sandbox / "u" / "a.txt").read_text() == "A"
    assert not landed.exists()


async def test_undo_move_keep_both_survives_failed_corrective_rename(conn, sandbox):
    src = _mk(sandbox, "u/a.txt", "A")
    dst = sandbox / "v"; dst.mkdir()
    _mk(sandbox, "v/a.txt", "already here")  # forces keep-both on the forward move
    r = await mover.move(conn, src, dst, on_conflict="keep-both")
    assert r["status"] == "done" and Path(r["dest"]).name == "a (2).txt"
    _mk(sandbox, "u/a.txt", "blocker")  # occupies the original name before undo runs
    inv = await mover.undo_operation(conn, r["op_id"])
    assert inv["status"] == "done"
    assert (sandbox / "u" / "a (2).txt").exists()
    assert (sandbox / "u" / "a (2).txt").read_text() == "A"
    assert (sandbox / "u" / "a.txt").read_text() == "blocker"  # blocker left untouched
    assert (await ol.get_operation(conn, r["op_id"]))["undone"] == 1


async def test_undo_batch_catches_invalid_name_error(conn, sandbox, monkeypatch):
    a = _mk(sandbox, "ia.txt"); (sandbox / "dst2").mkdir()
    res = await mover.batch_move(conn, [a], sandbox / "dst2")
    op_id = res["ops"][0]["op_id"]

    async def _boom(*args, **kwargs):
        raise mover.InvalidNameError("bad name")
    monkeypatch.setattr(mover, "undo_operation", _boom)
    out = await mover.undo_batch(conn, res["batch_id"])
    assert out["ops"] == [] and len(out["errors"]) == 1
    assert "InvalidNameError" in out["errors"][0]["error"]
