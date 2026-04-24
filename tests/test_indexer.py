"""Tests for backend.indexer and backend.hasher — Phase 1."""
import pytest
import aiosqlite
from pathlib import Path

import backend.config as _config
from backend.config import OutOfSandboxError
from backend.hasher import hash_file
from backend.indexer import scan_directory, index_file, remove_stale_entries


# ---------------------------------------------------------------------------
# hasher
# ---------------------------------------------------------------------------

def test_hash_file_returns_hex_string(tmp_path):
    f = tmp_path / "sample.txt"
    f.write_bytes(b"hello fileplus")
    result = hash_file(f)
    assert isinstance(result, str)
    assert len(result) == 16  # xxh64 hex digest is always 16 chars


def test_hash_file_is_deterministic(tmp_path):
    f = tmp_path / "sample.txt"
    f.write_bytes(b"deterministic content")
    assert hash_file(f) == hash_file(f)


def test_hash_file_differs_for_different_content(tmp_path):
    a = tmp_path / "a.txt"
    b = tmp_path / "b.txt"
    a.write_bytes(b"aaa")
    b.write_bytes(b"bbb")
    assert hash_file(a) != hash_file(b)


def test_hash_file_same_for_identical_content(tmp_path):
    a = tmp_path / "a.txt"
    b = tmp_path / "b.txt"
    a.write_bytes(b"identical")
    b.write_bytes(b"identical")
    assert hash_file(a) == hash_file(b)


# ---------------------------------------------------------------------------
# path_guard
# ---------------------------------------------------------------------------

def test_path_guard_allows_path_inside_sandbox(sandbox):
    inside = sandbox / "subdir" / "file.txt"
    result = _config.path_guard(inside)
    assert result == inside.resolve()


def test_path_guard_blocks_path_outside_sandbox(sandbox):
    outside = Path("C:/Windows/System32/ntdll.dll")
    with pytest.raises(OutOfSandboxError):
        _config.path_guard(outside)


def test_path_guard_no_op_when_safety_mode_false(sandbox, monkeypatch, tmp_path):
    monkeypatch.setattr(_config, "SAFETY_MODE", False)
    outside = Path("C:/Windows")
    # Should not raise
    result = _config.path_guard(outside)
    assert result == outside.resolve()


# ---------------------------------------------------------------------------
# scan_directory
# ---------------------------------------------------------------------------

async def test_scan_populates_files_table(db, sandbox):
    (sandbox / "report.pdf").write_bytes(b"%PDF-1.4 fake")
    (sandbox / "notes.txt").write_text("hello")

    count = await scan_directory(sandbox)

    assert count == 2
    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute("SELECT COUNT(*) FROM files")
        row = await cur.fetchone()
    assert row[0] == 2


async def test_scan_skips_hidden_files(db, sandbox):
    (sandbox / "visible.txt").write_text("show me")
    (sandbox / ".hidden").write_text("hide me")
    (sandbox / ".DS_Store").write_bytes(b"mac junk")

    count = await scan_directory(sandbox)

    assert count == 1


async def test_scan_skips_hidden_directories(db, sandbox):
    hidden_dir = sandbox / ".git"
    hidden_dir.mkdir()
    (hidden_dir / "config").write_text("git stuff")
    (sandbox / "readme.md").write_text("visible")

    count = await scan_directory(sandbox)

    assert count == 1


async def test_scan_skips_partial_downloads(db, sandbox):
    (sandbox / "file.txt").write_text("complete")
    (sandbox / "partial.crdownload").write_bytes(b"in progress")
    (sandbox / "downloading.part").write_bytes(b"in progress")
    (sandbox / "temp.tmp").write_bytes(b"temp")

    count = await scan_directory(sandbox)

    assert count == 1


async def test_scan_stores_correct_metadata(db, sandbox):
    content = b"test content for metadata"
    f = sandbox / "data.bin"
    f.write_bytes(content)

    await scan_directory(sandbox)

    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute(
            "SELECT filename, extension, size, hash, status FROM files WHERE path = ?",
            (str(f.resolve()),),
        )
        row = await cur.fetchone()

    assert row is not None
    filename, extension, size, file_hash, status = row
    assert filename == "data.bin"
    assert extension == ".bin"
    assert size == len(content)
    assert file_hash == hash_file(f)
    assert status == "indexed"


async def test_scan_updates_on_rescan(db, sandbox):
    f = sandbox / "evolving.txt"
    f.write_text("version 1")
    await scan_directory(sandbox)

    content_v2 = "version 2 -- longer content now"
    f.write_text(content_v2, encoding="utf-8")
    await scan_directory(sandbox)

    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute("SELECT COUNT(*) FROM files")
        count_row = await cur.fetchone()
        cur2 = await conn.execute("SELECT size FROM files WHERE path = ?", (str(f.resolve()),))
        size_row = await cur2.fetchone()

    assert count_row[0] == 1  # still one row, not two
    assert size_row[0] == len(content_v2.encode("utf-8"))


async def test_scan_recurses_into_subdirectories(db, sandbox):
    subdir = sandbox / "subdir" / "nested"
    subdir.mkdir(parents=True)
    (sandbox / "top.txt").write_text("top level")
    (subdir / "deep.txt").write_text("deep file")

    count = await scan_directory(sandbox)

    assert count == 2


async def test_scan_blocked_outside_sandbox(db, sandbox):
    outside = Path("C:/Windows")
    with pytest.raises(OutOfSandboxError):
        await scan_directory(outside)


# ---------------------------------------------------------------------------
# remove_stale_entries
# ---------------------------------------------------------------------------

async def test_remove_stale_deletes_missing_files(db, sandbox):
    f = sandbox / "will_be_deleted.txt"
    f.write_text("bye")
    await scan_directory(sandbox)

    f.unlink()
    removed = await remove_stale_entries()

    assert removed == 1
    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute("SELECT COUNT(*) FROM files")
        row = await cur.fetchone()
    assert row[0] == 0


async def test_remove_stale_keeps_existing_files(db, sandbox):
    (sandbox / "stays.txt").write_text("I remain")
    await scan_directory(sandbox)

    removed = await remove_stale_entries()

    assert removed == 0
    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute("SELECT COUNT(*) FROM files")
        row = await cur.fetchone()
    assert row[0] == 1


# ---------------------------------------------------------------------------
# Duplicate detection via hash
# ---------------------------------------------------------------------------

async def test_duplicate_files_share_hash(db, sandbox):
    content = b"exact same bytes"
    (sandbox / "original.txt").write_bytes(content)
    (sandbox / "copy.txt").write_bytes(content)

    await scan_directory(sandbox)

    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute("SELECT hash FROM files ORDER BY path")
        rows = await cur.fetchall()

    hashes = [r[0] for r in rows]
    assert len(hashes) == 2
    assert hashes[0] == hashes[1]
