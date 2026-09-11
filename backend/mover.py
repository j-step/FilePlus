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

from send2trash import send2trash as _send2trash_impl

import backend.config as _config
from backend import operations_log as ol
from backend.hasher import hash_file

logger = logging.getLogger(__name__)


class InvalidNameError(ValueError): ...
class InvalidPolicyError(ValueError): ...
class ConflictError(Exception): ...
class RefusedError(Exception): ...


_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_KEEP_BOTH = re.compile(r"^(.*) \((\d+)\)$")
FILE_ATTRIBUTE_HIDDEN = 0x2
SPACE_MARGIN = 100 * 1024 * 1024
HASH_VERIFY_LIMIT = 1024 ** 3

_POLICIES = ("fail", "skip", "keep-both", "replace")


def _validate_conflict_policy(on_conflict: str) -> None:
    if on_conflict not in _POLICIES:
        raise InvalidPolicyError(f"unknown on_conflict {on_conflict!r}")


def _send2trash(path: Path) -> None:  # indirection so tests can stub it
    _send2trash_impl(str(path))


def validate_name(name: str) -> None:
    if not name or name in (".", ".."):
        raise InvalidNameError("Name is empty or reserved.")
    if _BAD_CHARS.search(name):
        raise InvalidNameError('Name contains a character that Windows does not allow: \\ / : * ? " < > |')
    if name[-1] in ". ":
        raise InvalidNameError("Name may not end with a dot or a space.")
    if name.split(".")[0].upper() in _RESERVED:  # Win32 ignores the extension: CON.txt is still CON
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
    if os.name != "nt":
        return
    attrs = ctypes.windll.kernel32.GetFileAttributesW(str(path))
    if attrs in (-1, 0xFFFFFFFF):  # INVALID_FILE_ATTRIBUTES
        logger.warning("could not read attributes for %s; leaving it visible", path)
        return
    if not ctypes.windll.kernel32.SetFileAttributesW(str(path), attrs | FILE_ATTRIBUTE_HIDDEN):
        logger.warning("could not hide %s", path)


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


def _verify_file(src: Path, dest: Path) -> None:
    if src.stat().st_size != dest.stat().st_size:
        raise RefusedError(f"Copy verification failed: size mismatch (partial copy left at {dest}).")
    if src.stat().st_size <= HASH_VERIFY_LIMIT and hash_file(src) != hash_file(dest):
        raise RefusedError(f"Copy verification failed: hash mismatch (partial copy left at {dest}).")


def _verify_copy(src: Path, dest: Path) -> None:
    """Verify a copy before the source may be removed.

    Files: size must match, and content is hashed and compared for files up to
    HASH_VERIFY_LIMIT bytes; larger files are checked by size only (hashing a
    multi-gigabyte file twice would double the I/O cost of every large
    cross-volume move).

    Directories: the full sorted set of relative paths -- files AND
    subdirectories, including empty ones -- must match between src and dest,
    then every file entry is verified as above.
    """
    if src.is_file():
        _verify_file(src, dest)
        return
    s_entries = sorted(p.relative_to(src) for p in src.rglob("*"))
    d_entries = sorted(p.relative_to(dest) for p in dest.rglob("*"))
    if s_entries != d_entries:
        raise RefusedError(f"Copy verification failed: tree mismatch (partial copy left at {dest}).")
    for rel in s_entries:
        sp = src / rel
        if sp.is_file():
            _verify_file(sp, dest / rel)


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
    raise InvalidPolicyError(f"unknown on_conflict {on_conflict!r}")  # defence in depth; callers validate up front


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
    logger.info("%s: %s -> %s", op_type, src, dest)
    return _result(op_id, op_type, "done", src, dest, batch_id)


def _move_fn(src: Path, dest: Path):
    def run():
        if same_volume(src, dest):
            if dest.exists():  # conflict resolution ran earlier; this is the race window
                raise ConflictError(f"'{dest}' already exists.")
            os.replace(src, dest) if src.is_file() else os.rename(src, dest)
        else:
            if dest.exists():  # conflict resolution ran earlier; this is the race window
                raise ConflictError(f"'{dest}' already exists.")
            need = _tree_size(src)
            if _free_bytes(dest.parent) < need + SPACE_MARGIN:
                raise RefusedError("Not enough free space on the destination volume.")
            _copy_tree_or_file(src, dest)
            _verify_copy(src, dest)
            _remove_after_verified_copy(src)
    return run


async def move(conn, src, dest_dir, *, batch_id=None, on_conflict="fail", reason=None, _op_type="move", _undo_of=None) -> dict:
    _validate_conflict_policy(on_conflict)
    src = _config.path_guard(src, "write")
    dest_dir = _config.path_guard(dest_dir, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    if src.is_dir() and _config.is_under(dest_dir, src):
        raise RefusedError("Cannot move a folder into itself.")
    if not dest_dir.is_dir():
        raise RefusedError(f"Destination folder does not exist: {dest_dir}")
    candidate = dest_dir / src.name
    if os.path.normcase(str(candidate)) == os.path.normcase(str(src)):
        raise RefusedError("Source is already in the destination folder.")
    minted = batch_id is None
    batch_id = batch_id or ol.new_batch_id()
    target, action = _resolve_target(candidate, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, _op_type, action, src, candidate, None if minted else batch_id)
    target = _config.path_guard(target, "write")
    if not same_volume(src, target):
        need = await asyncio.to_thread(_tree_size, src)
        if await asyncio.to_thread(_free_bytes, dest_dir) < need + SPACE_MARGIN:
            raise RefusedError("Not enough free space on the destination volume.")
    if action == "replace":
        await trash(conn, target, batch_id=batch_id, reason="replaced")
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
    _validate_conflict_policy(on_conflict)
    src = _config.path_guard(src, "read")
    dest_dir = _config.path_guard(dest_dir, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    if src.is_dir() and _config.is_under(dest_dir, src):
        raise RefusedError("Cannot copy a folder into itself.")
    minted = batch_id is None
    batch_id = batch_id or ol.new_batch_id()
    target, action = _resolve_target(dest_dir / src.name, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, "copy", action, src, dest_dir / src.name, None if minted else batch_id)
    target = _config.path_guard(target, "write")
    need = await asyncio.to_thread(_tree_size, src)
    if await asyncio.to_thread(_free_bytes, dest_dir) < need + SPACE_MARGIN:
        raise RefusedError("Not enough free space on the destination volume.")
    if action == "replace":
        await trash(conn, target, batch_id=batch_id, reason="replaced")

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
    if src.is_dir() and _config.is_under(root, src):
        raise RefusedError("Cannot trash a folder that contains the FilePlus trash.")
    batch_dir = _config.path_guard(root / batch_id, "write")  # guard the computed path before anything touches disk
    target = _config.path_guard(keep_both_name(batch_dir / src.name), "write")

    def run():
        if not root.exists():
            root.mkdir(parents=True)
            _hide(root)
        batch_dir.mkdir(exist_ok=True)
        os.rename(src, target)
        _append_manifest(batch_dir, src, target)
    return await _perform(conn, "trash", src, target, batch_id, reason, run, undo_of=_undo_of)


async def restore(conn, trashed_path, original_path, *, batch_id=None, on_conflict="keep-both", reason=None, _undo_of=None) -> dict:
    _validate_conflict_policy(on_conflict)
    src = _config.path_guard(trashed_path, "write")
    original = _config.path_guard(original_path, "write")
    if not src.exists():
        raise RefusedError(f"Trashed item no longer exists: {src}")
    minted = batch_id is None
    batch_id = batch_id or ol.new_batch_id()
    target, action = _resolve_target(original, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, "restore", action, src, original, None if minted else batch_id)
    target = _config.path_guard(target, "write")
    if action == "replace":
        await trash(conn, target, batch_id=batch_id, reason="replaced by restore")

    def run():
        original.parent.mkdir(parents=True, exist_ok=True)
        os.rename(src, target)
    return await _perform(conn, "restore", src, target, batch_id, reason, run, undo_of=_undo_of)


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
    out = {"batch_id": batch_id, "ops": [], "conflicts": [], "skipped": [], "errors": []}
    for item in items:
        try:
            r = await fn(item, batch_id)
        except (InvalidNameError, ConflictError, RefusedError, _config.OutOfSandboxError, _config.ProtectedPathError, OSError) as exc:
            out["errors"].append({"src": str(item), "error": f"{type(exc).__name__}: {exc}"})
            continue
        if r["status"] == "conflict":
            out["conflicts"].append(r)
        elif r["status"] == "skipped":
            out["skipped"].append(r)
        else:
            out["ops"].append(r)
    return out


async def batch_move(conn, sources, dest_dir, on_conflict="fail") -> dict:
    return await _batch(conn, sources, lambda s, b: move(conn, s, dest_dir, batch_id=b, on_conflict=on_conflict))


async def batch_copy(conn, sources, dest_dir, on_conflict="fail") -> dict:
    return await _batch(conn, sources, lambda s, b: copy(conn, s, dest_dir, batch_id=b, on_conflict=on_conflict))


async def batch_trash(conn, paths) -> dict:
    return await _batch(conn, paths, lambda p, b: trash(conn, p, batch_id=b))


def _known_trash_roots() -> list[Path]:
    sandbox_root = _config.FILEPLUS_SANDBOX_PATH.resolve() / _config.TRASH_DIRNAME
    candidates = [sandbox_root] + [Path(f"{letter}:\\") / _config.TRASH_DIRNAME for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ"]
    roots = []
    for cand in candidates:
        try:
            found = cand.exists()
        except OSError:  # stale/unreachable network drive (e.g. ERROR_BAD_NETPATH)
            logger.warning("could not probe %s for a trash folder; skipping", cand)
            continue
        if found:
            roots.append(cand)
    return roots


async def empty_trash(conn) -> dict:
    candidates = _known_trash_roots()
    roots, skipped_roots = [], []
    for r in candidates:
        try:
            roots.append(_config.path_guard(r, "write"))
        except (_config.OutOfSandboxError, _config.ProtectedPathError) as exc:
            logger.warning("skipping trash root %s: %s", r, exc)
            skipped_roots.append(str(r))
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
    return {"batches": len(batches), "roots": [str(r) for r in roots], "skipped_roots": skipped_roots}


# ---------------------------------------------------------------------------
# Undo / redo
# ---------------------------------------------------------------------------

async def undo_operation(conn, op_id: int, *, batch_id: str | None = None) -> dict:
    row = await ol.get_operation(conn, op_id)
    if row is None:
        raise RefusedError(f"Operation {op_id} not found.")
    if row["op_type"].endswith(":final"):
        raise RefusedError("This operation cannot be undone.")
    if not row["executed"] or row["error"]:
        raise RefusedError("Operation did not complete; nothing to undo.")
    if row["undone"]:
        raise RefusedError("Operation is already undone.")
    src, dest = row["source_path"], row["dest_path"]
    t = row["op_type"]
    batch_id = batch_id or ol.new_batch_id()
    if t in ("move", "rename"):
        if not dest or not Path(dest).exists():
            raise RefusedError("The moved item is no longer where the log left it.")
        if t == "move":
            result = await move(conn, dest, Path(src).parent, batch_id=batch_id, on_conflict="keep-both",
                                reason=f"undo of #{op_id}", _undo_of=op_id)
            if result["status"] == "done" and Path(result["dest"]).name != Path(src).name:
                # the move landed under a keep-both name (either the forward op used
                # keep-both, or the original name is occupied again); try to restore
                # the original name, but a failure here must not fail the undo -- the
                # item is already safely back in its original folder either way.
                try:
                    result = await rename(conn, result["dest"], Path(src).name, batch_id=batch_id,
                                          reason=f"undo of #{op_id}", _undo_of=op_id)
                except (ConflictError, OSError, InvalidNameError) as exc:
                    logger.warning("undo #%s: could not restore original name %r (%s); leaving '%s'",
                                   op_id, Path(src).name, exc, result["dest"])
        else:
            result = await rename(conn, dest, Path(src).name, batch_id=batch_id, reason=f"undo of #{op_id}", _undo_of=op_id)
    elif t == "trash":
        if not dest or not Path(dest).exists():
            raise RefusedError("The trashed item is gone (trash emptied?).")
        result = await restore(conn, dest, src, batch_id=batch_id, reason=f"undo of #{op_id}", _undo_of=op_id)
    elif t == "restore":
        if not dest or not Path(dest).exists():
            raise RefusedError("The restored item is no longer where the log left it.")
        result = await trash(conn, dest, batch_id=batch_id, reason=f"undo of #{op_id}", _undo_of=op_id)
    elif t in ("copy", "mkdir", "touch"):
        if not dest or not Path(dest).exists():
            raise RefusedError("The created item is no longer where the log left it.")
        result = await trash(conn, dest, batch_id=batch_id, reason=f"undo of #{op_id}", _undo_of=op_id)
    else:
        raise RefusedError(f"Operation type '{t}' has no inverse.")
    if result["status"] != "done":
        raise RefusedError(f"Undo could not complete: {result['status']}.")
    await ol.mark_undone(conn, op_id)
    return result


async def undo_batch(conn, batch_id: str) -> dict:
    rows = [r for r in await ol.list_batch(conn, batch_id) if r["executed"] and not r["undone"] and not r["error"]]
    new_batch_id = ol.new_batch_id() if rows else None
    out = {"batch_id": new_batch_id, "ops": [], "errors": []}
    for r in rows:
        try:
            res = await undo_operation(conn, r["id"], batch_id=new_batch_id)
            out["ops"].append(res)
        except (InvalidNameError, RefusedError, ConflictError, _config.OutOfSandboxError, _config.ProtectedPathError, OSError) as exc:
            out["errors"].append({"op_id": r["id"], "error": f"{type(exc).__name__}: {exc}"})
    return out
