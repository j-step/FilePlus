"""FilePlus mover — every filesystem mutation, guarded and logged before it acts.

Protocol (never varies): path_guard(write) on every path involved ->
operations_log row (executed=0) -> perform in a thread -> mark_executed.
On exception: mark_error and re-raise.

Nothing is hard-deleted. "Delete" moves into a same-volume .FilePlusTrash
folder; empty_trash() hands those folders to the Windows Recycle Bin.
"""
from __future__ import annotations

import asyncio
import ctypes
import json
import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from send2trash import send2trash as _send2trash_impl

import backend.config as _config
from backend import operations_log as ol
from backend.hasher import hash_file

logger = logging.getLogger(__name__)


class InvalidNameError(ValueError): ...
class ConflictError(Exception): ...
class RefusedError(Exception): ...


_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_KEEP_BOTH = re.compile(r"^(.*) \((\d+)\)$")
FILE_ATTRIBUTE_HIDDEN = 0x2
SPACE_MARGIN = 100 * 1024 * 1024
HASH_VERIFY_LIMIT = 1024 ** 3


def _send2trash(path: Path) -> None:  # indirection so tests can stub it
    _send2trash_impl(str(path))


def validate_name(name: str) -> None:
    if not name or name in (".", ".."):
        raise InvalidNameError("Name is empty or reserved.")
    if _BAD_CHARS.search(name):
        raise InvalidNameError('Name contains a character that Windows does not allow: \\ / : * ? " < > |')
    if name[-1] in ". ":
        raise InvalidNameError("Name may not end with a dot or a space.")
    if name.split(".")[0].upper() in _RESERVED and name.upper() in _RESERVED:
        raise InvalidNameError(f"'{name}' is a reserved device name.")


def keep_both_name(target: Path) -> Path:
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    m = _KEEP_BOTH.match(stem)
    base, n = (m.group(1), int(m.group(2)) + 1) if m else (stem, 2)
    while True:
        cand = target.with_name(f"{base} ({n}){suffix}")
        if not cand.exists():
            return cand
        n += 1


def same_volume(a: Path, b: Path) -> bool:
    return os.path.splitdrive(str(a.resolve()))[0].lower() == os.path.splitdrive(str(b.resolve()))[0].lower()


def trash_root_for(path: Path) -> Path:
    p = Path(path).resolve()
    if _config.is_under(p, _config.FILEPLUS_SANDBOX_PATH):
        return _config.FILEPLUS_SANDBOX_PATH.resolve() / _config.TRASH_DIRNAME
    drive = os.path.splitdrive(str(p))[0] + "\\"
    return Path(drive) / _config.TRASH_DIRNAME


def _free_bytes(path: Path) -> int:
    return shutil.disk_usage(str(path)).free


def _tree_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _hide(path: Path) -> None:
    if os.name == "nt":
        ctypes.windll.kernel32.SetFileAttributesW(str(path), FILE_ATTRIBUTE_HIDDEN)


def _ensure_trash_batch_dir(root: Path, batch_id: str) -> Path:
    if not root.exists():
        root.mkdir(parents=True)
        _hide(root)
    d = root / batch_id
    d.mkdir(exist_ok=True)
    return d


def _append_manifest(batch_dir: Path, original: Path, trashed: Path) -> None:
    mf = batch_dir / "manifest.json"
    data = json.loads(mf.read_text(encoding="utf-8")) if mf.exists() else {"items": []}
    data["items"].append({"original": str(original), "trashed": str(trashed), "ts": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    mf.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _copy_tree_or_file(src: Path, dest: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dest, symlinks=True)
    else:
        shutil.copy2(src, dest)


def _verify_copy(src: Path, dest: Path) -> None:
    if src.is_file():
        if src.stat().st_size != dest.stat().st_size:
            raise RefusedError("Copy verification failed: size mismatch.")
        if src.stat().st_size <= HASH_VERIFY_LIMIT and hash_file(src) != hash_file(dest):
            raise RefusedError("Copy verification failed: hash mismatch.")
        return
    s = sorted((p.relative_to(src), p.stat().st_size) for p in src.rglob("*") if p.is_file())
    d = sorted((p.relative_to(dest), p.stat().st_size) for p in dest.rglob("*") if p.is_file())
    if s != d:
        raise RefusedError("Copy verification failed: tree mismatch.")


def _remove_after_verified_copy(src: Path) -> None:
    """The only place the mover removes bytes: the source of a verified cross-volume move."""
    if src.is_dir():
        shutil.rmtree(src)
    else:
        os.remove(src)


def _resolve_target(target: Path, on_conflict: str) -> tuple[Path | None, str]:
    """Return (target, action) with action in done|conflict|skipped|replace."""
    if not target.exists():
        return target, "done"
    if on_conflict == "fail":
        return None, "conflict"
    if on_conflict == "skip":
        return None, "skipped"
    if on_conflict == "keep-both":
        return keep_both_name(target), "done"
    if on_conflict == "replace":
        return target, "replace"
    raise ValueError(f"unknown on_conflict {on_conflict!r}")


def _result(op_id, op_type, status, src, dest, batch_id) -> dict:
    return {"op_id": op_id, "op_type": op_type, "status": status, "src": str(src) if src else None,
            "dest": str(dest) if dest else None, "batch_id": batch_id}


async def _perform(conn, op_type, src, dest, batch_id, reason, fn, undo_of=None) -> dict:
    """The protocol: log -> act (thread) -> mark. Shared by every mutation."""
    op_id = await ol.log_operation(conn, op_type, str(src) if src else None, str(dest) if dest else None,
                                   batch_id=batch_id, reason=reason, undo_of=undo_of)
    try:
        await asyncio.to_thread(fn)
    except Exception as exc:
        await ol.mark_error(conn, op_id, f"{type(exc).__name__}: {exc}")
        raise
    await ol.mark_executed(conn, op_id)
    return _result(op_id, op_type, "done", src, dest, batch_id)


def _move_fn(src: Path, dest: Path):
    def run():
        if same_volume(src, dest):
            os.replace(src, dest) if src.is_file() else os.rename(src, dest)
        else:
            need = _tree_size(src)
            if _free_bytes(dest.parent) < need + SPACE_MARGIN:
                raise RefusedError("Not enough free space on the destination volume.")
            _copy_tree_or_file(src, dest)
            _verify_copy(src, dest)
            _remove_after_verified_copy(src)
    return run


async def move(conn, src, dest_dir, *, batch_id=None, on_conflict="fail", reason=None, _op_type="move", _undo_of=None) -> dict:
    src = _config.path_guard(src, "write")
    dest_dir = _config.path_guard(dest_dir, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    if src.is_dir() and _config.is_under(dest_dir, src):
        raise RefusedError("Cannot move a folder into itself.")
    if not dest_dir.is_dir():
        raise RefusedError(f"Destination folder does not exist: {dest_dir}")
    target, action = _resolve_target(dest_dir / src.name, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, _op_type, action, src, dest_dir / src.name, batch_id)
    if action == "replace":
        await trash(conn, target, batch_id=batch_id, reason="replaced")
    if not same_volume(src, target):
        need = await asyncio.to_thread(_tree_size, src)
        if await asyncio.to_thread(_free_bytes, dest_dir) < need + SPACE_MARGIN:
            raise RefusedError("Not enough free space on the destination volume.")
    return await _perform(conn, _op_type, src, target, batch_id, reason, _move_fn(src, target), undo_of=_undo_of)


async def rename(conn, path, new_name, *, batch_id=None, reason=None, _undo_of=None) -> dict:
    validate_name(new_name)
    src = _config.path_guard(path, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    target = _config.path_guard(src.with_name(new_name), "write")
    if target.exists() and target != src:
        raise ConflictError(f"'{new_name}' already exists here.")
    return await _perform(conn, "rename", src, target, batch_id, reason, lambda: os.rename(src, target), undo_of=_undo_of)


async def copy(conn, src, dest_dir, *, batch_id=None, on_conflict="fail", reason=None) -> dict:
    src = _config.path_guard(src, "read")
    dest_dir = _config.path_guard(dest_dir, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    if src.is_dir() and _config.is_under(dest_dir, src):
        raise RefusedError("Cannot copy a folder into itself.")
    target, action = _resolve_target(dest_dir / src.name, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, "copy", action, src, dest_dir / src.name, batch_id)
    if action == "replace":
        await trash(conn, target, batch_id=batch_id, reason="replaced")
    need = await asyncio.to_thread(_tree_size, src)
    if await asyncio.to_thread(_free_bytes, dest_dir) < need + SPACE_MARGIN:
        raise RefusedError("Not enough free space on the destination volume.")

    def run():
        _copy_tree_or_file(src, target)
        _verify_copy(src, target)
    return await _perform(conn, "copy", src, target, batch_id, reason, run)


async def trash(conn, path, *, batch_id=None, reason=None, _undo_of=None) -> dict:
    src = _config.path_guard(path, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    batch_id = batch_id or ol.new_batch_id()
    root = trash_root_for(src)
    if _config.is_under(src, root):
        raise RefusedError("Already in the FilePlus trash.")
    batch_dir = await asyncio.to_thread(_ensure_trash_batch_dir, root, batch_id)
    target = keep_both_name(batch_dir / src.name)

    def run():
        os.rename(src, target)
        _append_manifest(batch_dir, src, target)
    return await _perform(conn, "trash", src, target, batch_id, reason, run, undo_of=_undo_of)


async def restore(conn, trashed_path, original_path, *, batch_id=None, on_conflict="keep-both", reason=None, _undo_of=None) -> dict:
    src = _config.path_guard(trashed_path, "write")
    original = _config.path_guard(original_path, "write")
    if not src.exists():
        raise RefusedError(f"Trashed item no longer exists: {src}")
    original.parent.mkdir(parents=True, exist_ok=True)
    target, action = _resolve_target(original, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, "restore", action, src, original, batch_id)
    if action == "replace":
        await trash(conn, target, batch_id=batch_id, reason="replaced by restore")
    return await _perform(conn, "restore", src, target, batch_id, reason, lambda: os.rename(src, target), undo_of=_undo_of)


async def mkdir(conn, parent, name, *, batch_id=None, reason=None) -> dict:
    validate_name(name)
    target = _config.path_guard(Path(parent) / name, "write")
    if target.exists():
        raise ConflictError(f"'{name}' already exists here.")
    return await _perform(conn, "mkdir", None, target, batch_id, reason, lambda: target.mkdir())


async def touch(conn, parent, name, *, batch_id=None, reason=None) -> dict:
    validate_name(name)
    target = _config.path_guard(Path(parent) / name, "write")
    if target.exists():
        raise ConflictError(f"'{name}' already exists here.")
    return await _perform(conn, "touch", None, target, batch_id, reason, lambda: target.touch(exist_ok=False))


async def _batch(conn, items, fn) -> dict:
    batch_id = ol.new_batch_id()
    out = {"batch_id": batch_id, "ops": [], "conflicts": [], "errors": []}
    for item in items:
        try:
            r = await fn(item, batch_id)
        except (InvalidNameError, ConflictError, RefusedError, _config.OutOfSandboxError, _config.ProtectedPathError, OSError) as exc:
            out["errors"].append({"src": str(item), "error": f"{type(exc).__name__}: {exc}"})
            continue
        (out["conflicts"] if r["status"] == "conflict" else out["ops"]).append(r)
    return out


async def batch_move(conn, sources, dest_dir, on_conflict="fail") -> dict:
    return await _batch(conn, sources, lambda s, b: move(conn, s, dest_dir, batch_id=b, on_conflict=on_conflict))


async def batch_copy(conn, sources, dest_dir, on_conflict="fail") -> dict:
    return await _batch(conn, sources, lambda s, b: copy(conn, s, dest_dir, batch_id=b, on_conflict=on_conflict))


async def batch_trash(conn, paths) -> dict:
    return await _batch(conn, paths, lambda p, b: trash(conn, p, batch_id=b))


def _known_trash_roots() -> list[Path]:
    roots = [_config.FILEPLUS_SANDBOX_PATH.resolve() / _config.TRASH_DIRNAME]
    for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
        cand = Path(f"{letter}:\\") / _config.TRASH_DIRNAME
        if cand.exists():
            roots.append(cand)
    return [r for r in roots if r.exists()]


async def empty_trash(conn) -> dict:
    roots = _known_trash_roots()
    batches = [d for r in roots for d in r.iterdir() if d.is_dir()]
    op_id = await ol.log_operation(conn, "trash-empty:final", None, None, reason=f"{len(batches)} batch folders -> Recycle Bin")

    def run():
        for d in batches:
            _send2trash(d)
    try:
        await asyncio.to_thread(run)
    except Exception as exc:
        await ol.mark_error(conn, op_id, str(exc)); raise
    await ol.mark_executed(conn, op_id)
    return {"batches": len(batches), "roots": [str(r) for r in roots]}
