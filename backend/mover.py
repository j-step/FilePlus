"""FilePlus mover — every filesystem mutation, guarded and logged before it acts.

Protocol (never varies): path_guard(write) on every path involved ->
operations_log row (executed=0) -> perform in a thread -> mark_executed.
On exception: mark_error and re-raise.

Nothing is hard-deleted. "Delete" moves into a same-volume .FilePlusTrash
folder; empty_trash() hands those folders to the Windows Recycle Bin.
"""
from __future__ import annotations

import asyncio
import base64
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
from backend import operations_log as ol, stores, tagger, winshell
from backend.errors import RefusedError
from backend.hasher import hash_file

logger = logging.getLogger(__name__)


class InvalidNameError(ValueError): ...
class InvalidPolicyError(ValueError): ...
class ConflictError(Exception): ...
# RefusedError lives in backend.errors (imported above) and is re-exported
# here unchanged -- backend.winshell raises it too (an unparseable
# desktop.ini), and importing backend.mover itself from backend.winshell
# would be a cycle (mover already imports winshell).


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


def _volume_of(path: Path) -> str:
    """The drive letter the path itself lives on.

    A junction/symlink is NOT followed: os.rename moves the link, which lives
    on the link's own volume, not the target's -- resolving here would send a
    same-volume rename down the copy-then-delete cross-volume path (or the
    reverse) for every reparse point.
    """
    p = Path(path)
    if not _config.is_reparse_point(p):
        p = p.resolve()
    return os.path.splitdrive(str(p))[0].lower()


def same_volume(a: Path, b: Path) -> bool:
    return _volume_of(a) == _volume_of(b)


def trash_root_for(path: Path) -> Path:
    """The .FilePlusTrash root serving *path* -- the sandbox's, or the root of
    the volume *path* itself is on.

    Containment is judged on the path's own (lexical) spelling first: a
    junction inside the sandbox belongs to the sandbox trash even when it
    points somewhere else entirely, since it is the link that gets moved.
    """
    lexical = Path(os.path.normpath(str(path)))
    sandbox = _config.FILEPLUS_SANDBOX_PATH.resolve()
    if _config.is_under(lexical, sandbox) or _config.is_under(Path(path).resolve(), sandbox):
        return sandbox / _config.TRASH_DIRNAME
    drive = os.path.splitdrive(str(lexical))[0] + "\\"
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


def manifest_path_for(root: Path, batch_id: str) -> Path:
    """Where a trash batch's bookkeeping lives: <trash root>/<batch id>.manifest.json.

    Deliberately NOT inside the batch folder: everything in there is a file
    the user trashed, under its own name, so a file actually named
    manifest.json would land on the manifest's path and then be read back and
    rewritten as one (or abort the whole batch when it isn't JSON). The batch
    id is a fresh uuid4 hex, so this name can never collide with a trashed
    item.
    """
    return root / f"{batch_id}.manifest.json"


def _append_manifest(root: Path, batch_id: str, original: Path, trashed: Path) -> None:
    mf = manifest_path_for(root, batch_id)
    data = json.loads(mf.read_text(encoding="utf-8")) if mf.exists() else {"items": []}
    data["items"].append({"original": str(original), "trashed": str(trashed), "ts": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    mf.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _append_manifest_safe(root: Path, batch_id: str, original: Path, trashed: Path) -> None:
    """_append_manifest, but never raising: the rename has already happened
    by the time this runs, and a bookkeeping failure must not turn a
    completed trash into an errored (and therefore un-undoable)
    operations_log row. The operations_log is the authoritative record; the
    manifest is a convenience for reading the trash folder without the
    database.
    """
    try:
        _append_manifest(root, batch_id, original, trashed)
    except (OSError, ValueError) as exc:  # ValueError covers json.JSONDecodeError
        logger.warning("could not update the trash manifest for batch %s: %s", batch_id, exc)


def exists_as_link_or_file(path: Path) -> bool:
    """True when *path* exists as an entry in its parent folder.

    os.path.lexists does not follow the final component, so a junction whose
    target has been deleted (which Path.exists() reports as gone) still counts
    -- otherwise a dangling junction could never be renamed or trashed
    through the app, which is exactly the state a mis-targeted delete used to
    leave behind.
    """
    return os.path.lexists(str(path))


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
    src = _config.guard_operand(src, "write")  # a junction moves as the link, not its target
    dest_dir = _config.path_guard(dest_dir, "write")
    if not exists_as_link_or_file(src):
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
    src = _config.guard_operand(path, "write")  # a junction is renamed as the link, not its target
    if not exists_as_link_or_file(src):
        raise RefusedError(f"Source does not exist: {src}")
    target = _config.path_guard(src.with_name(new_name), "write")
    if target.exists() and target != src:
        raise ConflictError(f"'{new_name}' already exists here.")
    return await _perform(conn, "rename", src, target, batch_id, reason, lambda: os.rename(src, target), undo_of=_undo_of)


async def copy(conn, src, dest_dir, *, batch_id=None, on_conflict="fail", reason=None) -> dict:
    _validate_conflict_policy(on_conflict)
    src = _config.guard_operand(src, "read")
    dest_dir = _config.path_guard(dest_dir, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    if src.is_dir() and _config.is_under(dest_dir, src):
        raise RefusedError("Cannot copy a folder into itself.")
    candidate = dest_dir / src.name
    if os.path.normcase(str(candidate)) == os.path.normcase(str(src)):
        # The same guard move() has, and for a sharper reason: without it,
        # on_conflict="replace" resolves the *source itself* as the target to
        # replace, trashes it, and then fails the copy with FileNotFoundError
        # -- a copy that deletes the file it was asked to duplicate.
        raise RefusedError("Source is already in the destination folder.")
    minted = batch_id is None
    batch_id = batch_id or ol.new_batch_id()
    target, action = _resolve_target(candidate, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, "copy", action, src, candidate, None if minted else batch_id)
    target = _config.path_guard(target, "write")
    need = await asyncio.to_thread(_tree_size, src)
    if await asyncio.to_thread(_free_bytes, dest_dir) < need + SPACE_MARGIN:
        raise RefusedError("Not enough free space on the destination volume.")
    if action == "replace":
        if os.path.normcase(str(target)) == os.path.normcase(str(src)):
            raise RefusedError("Source is already in the destination folder.")  # defence in depth
        await trash(conn, target, batch_id=batch_id, reason="replaced")

    def run():
        _copy_tree_or_file(src, target)
        _verify_copy(src, target)
    return await _perform(conn, "copy", src, target, batch_id, reason, run)


async def trash(conn, path, *, batch_id=None, reason=None, _undo_of=None) -> dict:
    src = _config.guard_operand(path, "write")  # a junction is trashed as the link, not its target
    if not exists_as_link_or_file(src):
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
        # exist_ok everywhere: run() executes on a worker thread, so two
        # concurrent /fs/trash requests genuinely race here and a
        # check-then-create would fail the loser with FileExistsError.
        root.mkdir(parents=True, exist_ok=True)
        _hide(root)  # idempotent, and logs+swallows its own failures
        batch_dir.mkdir(exist_ok=True)
        os.rename(src, target)
        _append_manifest_safe(root, batch_id, src, target)
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


async def _apply_attr_bits(conn, path: Path, target_bits: int, current_bits: int, batch_id: str, undo_of: int | None = None) -> dict:
    """Log+perform one attr-set: current_bits -> target_bits, in reason as {"before", "after"}.

    Shared by set_attributes (forward, already guarded there) and
    undo_operation's attr-set case (undo: called with before/after swapped,
    undo_of=<original id> -- so a further undo of that row swaps them back
    again, i.e. redo). path_guard runs here too -- not just in set_attributes
    -- so an undo/redo (which reaches this function directly from
    undo_operation with a path straight out of the operations_log row, never
    re-validated by any caller) can't write outside the sandbox: a
    since-relocated sandbox, or WRITE_UNLOCKED flipped off after the forward
    op ran, must refuse the undo with ProtectedPathError/OutOfSandboxError
    (-> 403) before anything is logged, exactly like move/rename/trash's own
    undo paths (which re-guard by calling move()/rename()/trash() again,
    every one of which guards internally).
    """
    path = _config.path_guard(path, "write")
    reason = json.dumps({"before": current_bits, "after": target_bits})
    return await _perform(conn, "attr-set", path, None, batch_id, reason,
                          lambda: winshell.set_attributes(path, target_bits), undo_of=undo_of)


async def set_attributes(conn, path: Path, *, read_only: bool | None = None, hidden: bool | None = None,
                         archive: bool | None = None, batch_id: str) -> dict:
    target = _config.path_guard(path, "write")
    if not target.exists():
        raise RefusedError(f"Source does not exist: {target}")
    before_bits = winshell.get_attributes(target)["bits"]
    after_bits = before_bits
    if read_only is not None:
        after_bits = (after_bits | winshell.FILE_ATTRIBUTE_READONLY) if read_only else (after_bits & ~winshell.FILE_ATTRIBUTE_READONLY)
    if hidden is not None:
        after_bits = (after_bits | winshell.FILE_ATTRIBUTE_HIDDEN) if hidden else (after_bits & ~winshell.FILE_ATTRIBUTE_HIDDEN)
    if archive is not None:
        after_bits = (after_bits | winshell.FILE_ATTRIBUTE_ARCHIVE) if archive else (after_bits & ~winshell.FILE_ATTRIBUTE_ARCHIVE)
    return await _apply_attr_bits(conn, target, after_bits, before_bits, batch_id)


async def _apply_folder_type(conn, target: Path, folder_type: str, batch_id: str, undo_of: int | None = None) -> dict:
    """Log+perform one folder-type-set: write *folder_type*'s desktop.ini,
    reason {"before_ini", "folder_bits_before", "after"}.

    *before_ini* and *folder_bits_before* are read synchronously here (both
    tiny/fast: a small file and one GetFileAttributesW call) so they can go
    into the log row before the write itself runs in a thread -- the same
    "read the current state up front" shape move/rename already use for
    their own pre-act existence/conflict checks. *folder_bits_before* is
    what restore_desktop_ini needs to undo write_folder_type's READONLY bit
    exactly, rather than assuming FilePlus is the only thing that could ever
    have set it.
    """
    ini_path = target / "desktop.ini"
    before_bytes = ini_path.read_bytes() if ini_path.exists() else None
    folder_bits_before = winshell.get_attributes(target)["bits"]
    reason = json.dumps({
        "before_ini": base64.b64encode(before_bytes).decode("ascii") if before_bytes is not None else None,
        "folder_bits_before": folder_bits_before,
        "after": folder_type,
    })
    return await _perform(conn, "folder-type-set", target, None, batch_id, reason,
                          lambda: winshell.write_folder_type(target, folder_type), undo_of=undo_of)


async def set_folder_type(conn, path: Path, folder_type: str, batch_id: str) -> dict:
    if folder_type not in winshell.FOLDER_TYPES:
        raise InvalidPolicyError(f"unknown folder type {folder_type!r}")
    target = _config.path_guard(path, "write")
    if not target.is_dir():
        raise RefusedError(f"Not a folder: {target}")
    return await _apply_folder_type(conn, target, folder_type, batch_id)


async def _undo_folder_type_set(conn, op_id: int, target: Path, before_bytes: bytes | None,
                                folder_bits_before: int, batch_id: str) -> dict:
    """Inverse of folder-type-set: restore *before_bytes*/*folder_bits_before*.

    path_guard here for the same reason _apply_attr_bits guards: this is
    reached directly from undo_operation with a path out of the
    operations_log row, never re-validated by any caller.

    Logged as a fresh folder-type-set row whose OWN before_ini/
    folder_bits_before are the *current* state (read here, before the
    restore runs) -- so a further undo of this row (redo) restores back to
    what this undo is about to replace, exactly like attr-set's before/after
    swap.
    """
    target = _config.path_guard(target, "write")
    ini_path = target / "desktop.ini"
    current_bytes = ini_path.read_bytes() if ini_path.exists() else None
    current_folder_bits = winshell.get_attributes(target)["bits"]
    reason = json.dumps({
        "before_ini": base64.b64encode(current_bytes).decode("ascii") if current_bytes is not None else None,
        "folder_bits_before": current_folder_bits,
        "after": winshell.folder_type_from_ini_bytes(before_bytes),
    })
    if before_bytes is None and current_bytes is not None:
        # There was no desktop.ini before the forward op, so undoing means
        # removing the one FilePlus wrote. "The app never hard-deletes"
        # (CLAUDE.md) applies here too: route it through trash() -- logged,
        # in this undo's own batch, recoverable from .FilePlusTrash -- rather
        # than letting winshell.restore_desktop_ini unlink whatever is on
        # disk now (Explorer may have rewritten it since).
        if os.name == "nt":
            try:
                winshell.set_attributes(ini_path, 0)  # clear hidden/system so the move isn't refused
            except OSError:
                pass
        await trash(conn, ini_path, batch_id=batch_id, reason=f"undo of #{op_id}: desktop.ini removed")
    return await _perform(conn, "folder-type-set", target, None, batch_id, reason,
                          lambda: winshell.restore_desktop_ini(target, before_bytes, folder_bits_before), undo_of=op_id)


async def _batch(conn, items, fn) -> dict:
    # One approval moves at most MAX_BATCH_SIZE items (config.py / .env.example).
    # Enforced here, the single funnel every batch_* helper goes through, so the
    # setting is a real ceiling rather than documentation.
    items = list(items)
    if len(items) > _config.MAX_BATCH_SIZE:
        raise RefusedError(
            f"Batch of {len(items)} items exceeds MAX_BATCH_SIZE ({_config.MAX_BATCH_SIZE})."
        )
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
    # <batch id>.manifest.json sits next to the batch folders (see
    # manifest_path_for), so emptying the trash has to take those too --
    # otherwise they accumulate in the trash root forever.
    manifests = [f for r in roots for f in r.glob("*.manifest.json") if f.is_file()]
    op_id = await ol.log_operation(conn, "trash-empty:final", None, None, reason=f"{len(batches)} batch folders -> Recycle Bin")

    def run():
        for d in batches + manifests:
            _send2trash(d)
    try:
        await asyncio.to_thread(run)
    except Exception as exc:
        await ol.mark_error(conn, op_id, str(exc)); raise
    await ol.mark_executed(conn, op_id)
    return {"batches": len(batches), "roots": [str(r) for r in roots], "skipped_roots": skipped_roots}


# ---------------------------------------------------------------------------
# Undo / redo -- DB-only ops (tags, favorites, pins)
#
# Same shape as the file-op inverses above: a fresh operations_log row with
# undo_of=<original id>, the original then marked undone=1 by the caller.
# Unlike move/rename/trash/etc. (backend.mover's own functions, which return
# the op_id they minted), tagger.remove_tag/apply_tags and the stores
# favorites/pins functions either don't return an op_id or are shared with
# idempotent public routes that shouldn't always take undo-only kwargs in
# their return shape -- so the freshly logged inverse row is looked up by
# its undo_of back-reference (ol.get_operation_by_undo_of) instead.
# ---------------------------------------------------------------------------

async def _undo_tag_add(conn, op_id: int, file_path: str | None, tag_name: str | None, batch_id: str) -> dict:
    """Inverse of tag-add: detach *tag_name* from the file at *file_path*.

    Only that one (file, tag) pairing is removed -- any other tag already on
    the file, added before or after, survives untouched (tagger.remove_tag
    only deletes the single file_tags row).
    """
    if not file_path or not tag_name:
        raise RefusedError("Malformed tag-add log entry; nothing to undo.")
    file_id = await tagger.file_id_for_path(conn, file_path)
    if file_id is None:
        raise RefusedError("The tagged file is no longer indexed.")
    tag_id = await tagger.tag_id_for_name(conn, tag_name)
    if tag_id is None:
        raise RefusedError("The tag no longer exists.")
    await tagger.remove_tag(conn, file_id, tag_id, batch_id=batch_id, reason=f"undo of #{op_id}", undo_of=op_id)
    inv = await ol.get_operation_by_undo_of(conn, op_id)
    if inv is None:  # the tag was already off the file: nothing was removed, nothing logged
        raise RefusedError("The tag is no longer on that file; nothing to undo.")
    return _result(inv["id"], "tag-remove", "done", file_path, tag_name, batch_id)


async def _undo_tag_remove(conn, op_id: int, file_path: str | None, tag_name: str | None, batch_id: str) -> dict:
    """Inverse of tag-remove: re-attach *tag_name* to the file at *file_path*.

    Recreates the tag definition if it no longer exists, matching
    apply_tags' normal (non-undo) behaviour.
    """
    if not file_path or not tag_name:
        raise RefusedError("Malformed tag-remove log entry; nothing to undo.")
    file_id = await tagger.file_id_for_path(conn, file_path)
    if file_id is None:
        raise RefusedError("The tagged file is no longer indexed.")
    await tagger.apply_tags(conn, file_id, [tag_name], batch_id=batch_id, reason=f"undo of #{op_id}", undo_of=op_id)
    inv = await ol.get_operation_by_undo_of(conn, op_id)
    return _result(inv["id"], "tag-add", "done", file_path, tag_name, batch_id)


async def _undo_favorite_add(conn, op_id: int, path: str | None, batch_id: str) -> dict:
    if not path:
        raise RefusedError("Malformed favorite-add log entry; nothing to undo.")
    await stores.favorites_remove(conn, path, batch_id=batch_id, reason=f"undo of #{op_id}", undo_of=op_id)
    inv = await ol.get_operation_by_undo_of(conn, op_id)
    if inv is None:  # not favorited any more: nothing was removed, nothing logged
        raise RefusedError("No longer favorited; nothing to undo.")
    return _result(inv["id"], "favorite-remove", "done", path, None, batch_id)


async def _undo_favorite_remove(conn, op_id: int, path: str | None, batch_id: str) -> dict:
    if not path:
        raise RefusedError("Malformed favorite-remove log entry; nothing to undo.")
    await stores.favorites_add(conn, path, batch_id=batch_id, reason=f"undo of #{op_id}", undo_of=op_id)
    inv = await ol.get_operation_by_undo_of(conn, op_id)
    if inv is None:
        raise RefusedError("Already favorited; nothing to restore.")
    return _result(inv["id"], "favorite-add", "done", path, None, batch_id)


async def _undo_pin_add(conn, op_id: int, path: str | None, batch_id: str) -> dict:
    if not path:
        raise RefusedError("Malformed pin-add log entry; nothing to undo.")
    cur = await conn.execute("SELECT id FROM pinned_folders WHERE path = ?", (path,))
    row = await cur.fetchone()
    if row is None:
        raise RefusedError("The pin no longer exists.")
    await stores.pins_remove(conn, row[0], batch_id=batch_id, reason=f"undo of #{op_id}", undo_of=op_id)
    inv = await ol.get_operation_by_undo_of(conn, op_id)
    if inv is None:  # the pin vanished between the lookup and the delete
        raise RefusedError("The pin no longer exists.")
    return _result(inv["id"], "pin-remove", "done", path, None, batch_id)


async def _undo_pin_remove(conn, op_id: int, path: str | None, batch_id: str) -> dict:
    if not path:
        raise RefusedError("Malformed pin-remove log entry; nothing to undo.")
    await stores.pins_add(conn, path, batch_id=batch_id, reason=f"undo of #{op_id}", undo_of=op_id)
    inv = await ol.get_operation_by_undo_of(conn, op_id)
    if inv is None:
        raise RefusedError("Already pinned; nothing to restore.")
    return _result(inv["id"], "pin-add", "done", path, None, batch_id)


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
    elif t == "tag-add":
        result = await _undo_tag_add(conn, op_id, src, dest, batch_id)
    elif t == "tag-remove":
        result = await _undo_tag_remove(conn, op_id, src, dest, batch_id)
    elif t == "favorite-add":
        result = await _undo_favorite_add(conn, op_id, src, batch_id)
    elif t == "favorite-remove":
        result = await _undo_favorite_remove(conn, op_id, src, batch_id)
    elif t == "pin-add":
        result = await _undo_pin_add(conn, op_id, src, batch_id)
    elif t == "pin-remove":
        result = await _undo_pin_remove(conn, op_id, src, batch_id)
    elif t == "attr-set":
        if not src or not Path(src).exists():
            raise RefusedError("The file is no longer where the log left it.")
        data = json.loads(row["reason"] or "{}")
        before_bits, after_bits = data.get("before"), data.get("after")
        if before_bits is None or after_bits is None:
            raise RefusedError("Malformed attr-set log entry; nothing to undo.")
        result = await _apply_attr_bits(conn, Path(src), before_bits, after_bits, batch_id, undo_of=op_id)
    elif t == "folder-type-set":
        if not src or not Path(src).exists():
            raise RefusedError("The folder is no longer where the log left it.")
        data = json.loads(row["reason"] or "{}")
        folder_bits_before = data.get("folder_bits_before")
        if folder_bits_before is None:
            raise RefusedError("Malformed folder-type-set log entry; nothing to undo.")
        before_ini_b64 = data.get("before_ini")
        # "" is a *zero-byte* desktop.ini that existed, not "no file": test for
        # None, or undo deletes the user's empty file instead of restoring it.
        before_bytes = base64.b64decode(before_ini_b64) if before_ini_b64 is not None else None
        result = await _undo_folder_type_set(conn, op_id, Path(src), before_bytes, folder_bits_before, batch_id)
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
