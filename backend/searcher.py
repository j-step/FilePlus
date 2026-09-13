"""FilePlus live tree search — a budgeted os.scandir walk with name/type/tag
filters, for GET /fs/search ("search this folder" over the real filesystem,
right now, no index required).

search_tree walks breadth-first from an explicit deque of pending
directories (never recursion) so shallow hits surface before deep ones, and
stops as soon as either the entry cap (`limit`) or the wall-clock budget
(`budget_s`) is spent -- either way `truncated` comes back True. It is
synchronous; callers run it in `asyncio.to_thread` (see backend.api's
GET /fs/search) since a real drive walk is blocking I/O.

GET /search (the SQLite-backed index search) applies the same SearchFilters
shape but queries the `files` table instead of calling this module.
"""
from __future__ import annotations

import os
import re
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import backend.config as config
from backend import filetypes

_FILE_ATTRIBUTE_HIDDEN = 0x2
_FILE_ATTRIBUTE_REPARSE_POINT = 0x400


@dataclass
class SearchFilters:
    q: str = ""
    type: str | None = None          # search group or 'folder'
    ext: str | None = None           # single extension, no dot
    modified_after: float | None = None   # epoch seconds
    modified_before: float | None = None
    created_after: float | None = None
    created_before: float | None = None
    min_size: int | None = None
    max_size: int | None = None
    hidden: bool = False
    whole_word: bool = False
    tag_paths: set[str] | None = None     # pre-resolved by the route when tag= is given;
                                           # already normcase+normpath'd -- see normalize_path


def normalize_path(path: str) -> str:
    """Case/separator-fold *path* for membership comparisons against `tag_paths`.

    Windows filenames are case-preserving but case-insensitive: a file can be
    renamed to change only its case (`Doc.txt` -> `doc.txt`) without the
    files-table row (written once, at whatever case existed then) ever being
    updated. Both the set built by the route and the live path compared
    against it in `_match`/`GET /search` must go through this same
    normalisation or a case drift like that silently breaks the `tag=`
    filter.
    """
    return os.path.normcase(os.path.normpath(path))


def match_spans(name: str, words: list[str], whole_word: bool) -> list[tuple[int, int]] | None:
    """Case-insensitive span(s) of every word of *words* in *name*.

    Every word must occur (AND semantics) or this returns None. An empty
    *words* list always matches, with no spans (`[]`). *whole_word* requires
    each word to sit on a word boundary (so "doc" won't match inside
    "mydoc.txt", but will match "my doc.txt" or "Doc-01 Final.TXT").
    Overlapping/adjacent spans from different words are merged, and the
    result is sorted by start offset.
    """
    lname = name.lower()
    spans: list[tuple[int, int]] = []
    for word in words:
        lw = word.lower()
        if not lw:
            continue
        if whole_word:
            m = re.search(r"\b" + re.escape(lw) + r"\b", lname)
            if m is None:
                return None
            spans.append((m.start(), m.end()))
        else:
            idx = lname.find(lw)
            if idx == -1:
                return None
            spans.append((idx, idx + len(lw)))
    spans.sort()
    merged: list[tuple[int, int]] = []
    for start, end in spans:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _created_time(stat_result) -> float:
    """st_birthtime when the platform provides it, else st_ctime."""
    return getattr(stat_result, "st_birthtime", None) or stat_result.st_ctime


def _match(*, name: str, is_dir: bool, ext: str, size: int, modified: float,
          created: float, path_str: str, words: list[str],
          filters: SearchFilters) -> list[tuple[int, int]] | None:
    """Return this entry's match spans, or None if any filter rejects it."""
    if filters.type is not None and filetypes.type_group_for(ext, is_dir=is_dir) != filters.type:
        return None
    if filters.ext is not None and (is_dir or ext != filters.ext.lstrip(".").lower()):
        return None
    if filters.min_size is not None and size < filters.min_size:
        return None
    if filters.max_size is not None and size > filters.max_size:
        return None
    if filters.modified_after is not None and modified < filters.modified_after:
        return None
    if filters.modified_before is not None and modified > filters.modified_before:
        return None
    if filters.created_after is not None and created < filters.created_after:
        return None
    if filters.created_before is not None and created > filters.created_before:
        return None
    if filters.tag_paths is not None and normalize_path(path_str) not in filters.tag_paths:
        return None
    return match_spans(name, words, filters.whole_word)


def search_tree(root: Path, filters: SearchFilters, *, budget_s: float = 4.0,
                limit: int = 500, clock=time.monotonic) -> dict:
    """Budgeted breadth-first search of the tree rooted at *root*.

    Synchronous -- the caller (GET /fs/search) runs it in
    `asyncio.to_thread`. Stops as soon as *limit* results are collected or
    `clock() - start` exceeds *budget_s*; either way `truncated` comes back
    True (there is no cheap way to tell "hit the cap" apart from "there was
    truly nothing left" without finishing the walk, so both are reported the
    same way). The budget is checked both when a directory is dequeued
    *and* once per entry inside it -- a single huge directory (thousands of
    entries, no subdirectories to requeue) would otherwise never re-check
    the clock until it finished scanning that one directory, defeating the
    budget entirely.

    Skipped, always: `.FilePlusTrash`; any directory `config.is_protected_read`
    refuses (checked when the directory is dequeued for scanning, so a
    protected subdirectory discovered mid-walk is pruned just as much as a
    protected root); reparse points (`entry.is_symlink()` or the Windows
    FILE_ATTRIBUTE_REPARSE_POINT bit -- a junction/mount point is not a
    symlink by `is_symlink()`, hence checking both); and hidden entries
    (dot-prefixed name or the Windows FILE_ATTRIBUTE_HIDDEN bit) unless
    `filters.hidden`. A per-entry `stat()` failure just drops that entry
    (permission-denied children under real drive roots are common and must
    not abort the whole walk).

    Returns:
        {"results": [...], "truncated": bool, "elapsed_ms": int, "walked": int}
        Each result: {path, name, is_dir, size, modified, created, ext, match}.
        `walked` counts entries that passed the trash/reparse/hidden skip
        checks (i.e. were actually considered against the filters) -- not
        the (generally smaller) number that ended up in `results`.
    """
    start = clock()
    words = filters.q.split() if filters.q else []
    results: list[dict] = []
    walked = 0
    truncated = False
    queue: deque[Path] = deque([Path(root)])

    while queue:
        if clock() - start > budget_s:
            truncated = True
            break
        directory = queue.popleft()
        if config.is_protected_read(directory):
            continue
        try:
            scandir_ctx = os.scandir(directory)
        except OSError:
            continue
        with scandir_ctx as entries:
            for entry in entries:
                if clock() - start > budget_s:
                    truncated = True
                    break
                if entry.name == config.TRASH_DIRNAME:
                    continue
                is_hidden = entry.name.startswith(".")
                try:
                    is_reparse = entry.is_symlink()
                except OSError:
                    continue
                try:
                    st = entry.stat(follow_symlinks=False)
                except OSError:
                    continue
                if os.name == "nt":
                    attrs = getattr(st, "st_file_attributes", 0)
                    is_reparse = is_reparse or bool(attrs & _FILE_ATTRIBUTE_REPARSE_POINT)
                    is_hidden = is_hidden or bool(attrs & _FILE_ATTRIBUTE_HIDDEN)
                if is_reparse:
                    continue
                if is_hidden and not filters.hidden:
                    continue

                try:
                    is_dir = entry.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                ext = "" if is_dir else os.path.splitext(entry.name)[1].lstrip(".").lower()
                size = 0 if is_dir else st.st_size
                modified = st.st_mtime
                created = _created_time(st)
                path_str = entry.path
                walked += 1

                if is_dir:
                    queue.append(Path(path_str))

                spans = _match(
                    name=entry.name, is_dir=is_dir, ext=ext, size=size,
                    modified=modified, created=created, path_str=path_str,
                    words=words, filters=filters,
                )
                if spans is None:
                    continue
                results.append({
                    "path": path_str, "name": entry.name, "is_dir": is_dir,
                    "size": size, "modified": modified, "created": created,
                    "ext": ext, "match": spans,
                })
                if len(results) >= limit:
                    truncated = True
                    break
        if truncated:
            break

    elapsed_ms = int((clock() - start) * 1000)
    return {"results": results, "truncated": truncated, "elapsed_ms": elapsed_ms, "walked": walked}
