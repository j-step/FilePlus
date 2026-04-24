# FilePlus — Claude Code Reference

**FilePlus** is a Windows desktop application: an AI-driven alternative to Windows Explorer.

---

## Tech Stack

- **Backend:** Python 3.11+ / FastAPI on `localhost:9876` / uvicorn
- **DB:** aiosqlite + SQLite (WAL mode) — filesystem is reality, DB adapts
- **Local LLM:** Ollama `llama3.1:8b` — first-pass classification
- **Cloud LLM:** Claude API — fallback for ambiguous cases, batched
- **File events:** watchdog
- **Hashing:** xxhash (xxh64)
- **Metadata:** Pillow / mutagen / python-magic-bin
- **Frontend:** Electron, plain HTML/CSS/JS (no framework, no React)

---

## Hard Safety Principle (non-negotiable)

- The app never moves, renames, or deletes a file without explicit user approval.
- Every file operation is logged to the `operations_log` table BEFORE it executes.
- `SAFETY_MODE` in `config.py` defaults to `True` during development and restricts all filesystem
  operations to a sandbox path via `path_guard()`, which raises on any out-of-sandbox target.
- `SAFETY_MODE` is flipped to `False` only after the scan/classify pipeline has been validated
  against the sandbox at least three times.

---

## Repo Layout

```
fileplus/
  backend/
    __init__.py        config.py           database.py
    indexer.py         hasher.py           tagger.py
    classifier.py      watcher.py          mover.py
    operations_log.py  snapshotter.py      api.py
  frontend/
    package.json       electron.js         preload.js
    index.html         tray/index.html
    src/app.js         src/actions.js      src/styles.css
  tests/
    __init__.py        test_indexer.py     test_tagger.py
    test_classifier.py test_mover.py
    test_operations_log.py                 test_snapshotter.py
  docs/
    design-tokens.md   design-brief.md     finalization-spec.md
  .gitignore  .env.example  requirements.txt  README.md
  CLAUDE.md   PLAN.md
```

---

## Coding Conventions

- **All paths from `backend/config.py`** — never hardcode a path anywhere.
- **Log before you act** — call `operations_log.log_operation()` BEFORE every file operation.
- **Never delete without approval** — move to staging or mark for review; never silently delete.
- **Enforce `path_guard()`** in every function that touches the filesystem.
- **Async everywhere** in the backend — use `async def`, `aiosqlite`, `aiohttp`.
- **Frontend uses `fetch()` only** — the Electron renderer never calls Node fs APIs directly.
- **Run Section 41 audit** (from `docs/design-tokens.md`) before declaring any UI phase complete.

---

## Current State

Phase 1 complete: hasher, indexer, database schema implemented and tested (18/18 passing).

---

## Next Task

Phase 2 per PLAN.md: tagger.py (metadata extraction via Pillow / mutagen / python-magic-bin).
