# Stage 0 — Reset and Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clean, committed tree with one canonical doc per concern and a single `verify` command (backend tests + API tests + Electron smoke test with screenshots) that every later autonomous run can use to self-certify.

**Architecture:** No feature work. Land the uncommitted April 27 cleanup, add a pytest layer for every API route, a deterministic sandbox generator, a Playwright-for-Electron smoke test that visits every screen and screenshots it, and a PowerShell driver that runs all of it. Then archive superseded docs and rewrite `CLAUDE.md` for the autonomous-run working mode.

**Tech Stack:** Python 3.14 via the `py -3` launcher (pytest, pytest-asyncio auto mode, FastAPI `TestClient`), Node 24, Electron 41, `@playwright/test` (Electron driver), PowerShell 5.1.

**Spec:** `docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md` — §5 "Stage 0", §6 "Working protocol", §8 "Docs consolidation".

## Global Constraints

- Python is invoked as `py -3` (the bare `python` on PATH is an MSYS build without pytest).
- Run pytest from the repo root: `py -3 -m pytest -q`. `pytest.ini` sets `asyncio_mode = auto`.
- Frontend commands run from `frontend/`. No framework, no build step, plain HTML/CSS/JS (spec D9).
- Never touch `backend/*.py` except the one 403 guard in Task 2. No schema changes, no new endpoints, no restyle (spec Stage 0 "Scope out").
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Line endings: the repo is LF in git and the working copy warns about CRLF. Commit with `git -c core.safecrlf=false commit` to silence the warning; do not change `core.autocrlf`.
- The sandbox at `FilePlusTestSandbox/` (1,251 files, gitignored) is the author's hand-built fixture. Never write into its `C_Drive` / `D_Drive`; the generator writes only to `FilePlusTestSandbox/_gen/` or a path passed with `--out`.
- Branch: this stage runs on `stage/0-reset-harness` **in the main checkout, not a worktree**, because Task 1 must absorb the dirty working tree. Later stages use worktrees per spec §6.
- `verify` must be green before every commit from Task 5 onward. Before Task 5, run the parts that exist (`py -3 -m pytest -q`).

---

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| (dirty tree: 9 modified + 2 new frontend/docs files) | April 27 cleanup, landed as one commit | 1 |
| `tests/test_api.py` | Contract tests for every route in `backend/api.py` | 2 |
| `backend/api.py` (one hunk) | `POST /scan` returns 403 instead of 500 on out-of-sandbox path | 2 |
| `scripts/__init__.py`, `scripts/gen_sandbox.py` | Deterministic sandbox fixture generator (CLI + importable `build()`) | 3 |
| `tests/test_gen_sandbox.py` | Generator determinism, counts, duplicates, hidden attribute | 3 |
| `frontend/package.json`, `frontend/playwright.config.js`, `frontend/test/smoke.spec.js` | Electron smoke test: every screen renders, no console errors, screenshots | 4 |
| `.gitignore` | ignore `artifacts/` | 4 |
| `scripts/verify.ps1` | One command: pytest → start backend → smoke test → stop backend | 5 |
| `docs/archive/**`, `docs/archive/README.md`, `README.md`, `docs/UI-SPEC.md` (header note) | Docs consolidation per spec §8 | 6 |
| `CLAUDE.md` | Rewritten, ≤100 lines, points at the roadmap and `verify` | 7 |
| `docs/superpowers/runs/2026-09-10-stage-0.md` | Run summary per spec §6 step 5 | 8 |

---

### Task 1: Land the uncommitted April 27 work on the stage branch

**Files:**
- Modify (already modified on disk): `CLAUDE.md`, `docs/backend-integration.md`, `frontend/index.html`, `frontend/main.js`, `frontend/setup/index.html`, `frontend/src/actions.js`, `frontend/src/app.js`, `frontend/src/styles.css`, `frontend/tray/index.html`
- Add (untracked): `frontend/setup/setup.js`, `frontend/tray/tray.js`, `docs/superpowers/plans/2026-04-27-fileplus-code-cleanup.md`
- Already staged rename: `fileplus-feature-list.md -> docs/fileplus-feature-list.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean `git status`; the branch `stage/0-reset-harness` that every later task commits to.

- [ ] **Step 1: Create the stage branch in place**

Run: `git switch -c stage/0-reset-harness`
Expected: `Switched to a new branch 'stage/0-reset-harness'`; `git status --short` still lists the 9 modified, 1 renamed, 3 untracked entries.

- [ ] **Step 2: Confirm the cleanup plan's outcomes are present**

Run:
```bash
grep -c "/api/" frontend/src/actions.js frontend/index.html
grep -c "ipcMain" frontend/main.js
grep -n "clearInterval(_backendPollId)" frontend/src/app.js
grep -n "<script" frontend/tray/index.html frontend/setup/index.html
```
Expected: both `/api/` counts are `0`; `ipcMain` count is `9` (one import + eight handlers, no duplicate import); one `clearInterval` line; tray and setup each have exactly one `<script src="...js"></script>` and no inline script.

- [ ] **Step 3: Confirm the backend tests still pass**

Run: `py -3 -m pytest -q`
Expected: `30 passed`.

- [ ] **Step 4: Stage and commit as one commit**

The diff mixes the cleanup-plan tasks with Screen 2 polish leftovers inside the same `index.html` hunks, so a clean split is not practical (spec Stage 0: "split into logical commits if practical").

```bash
git add -A
git -c core.safecrlf=false commit -m "chore: land April 27 cleanup pass and Screen 2 polish leftovers

Executes docs/superpowers/plans/2026-04-27-fileplus-code-cleanup.md:
- drop /api prefix from stub endpoint strings and INTEGRATION comments
- move tray and setup inline scripts to tray.js / setup.js (CSP script-src 'self')
- remove duplicate ipcMain import; clear backend poll interval on beforeunload
- move fileplus-feature-list.md into docs/
- CLAUDE.md current-state refresh (rewritten again in Stage 0 Task 7)
Also carries sidebar tag-cloud markup, text-tertiary contrast lifts and
Home polish leftovers from the same session. No behaviour change intended.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Expected: `git status --short` prints nothing.

---

### Task 2: API contract tests for every route

**Files:**
- Create: `tests/test_api.py`
- Modify: `backend/api.py` — `trigger_scan()` only (lines 158–165 in the current file)

**Interfaces:**
- Consumes: `sandbox` and `db` fixtures from `tests/conftest.py` (they monkeypatch `FILEPLUS_SANDBOX_PATH`, `FILEPLUS_DB_PATH`, `SAFETY_MODE=True`). `backend.api.app`.
- Produces: `tests/test_api.py::client` fixture pattern (`with TestClient(app) as c` so the lifespan runs `init_db()`), reused by Stage 2 tests.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_api.py
"""Contract tests for every route registered in backend/api.py.

Stub routes are tested for their *current* not-implemented shape so that
Stage 2 turns each of those assertions into a real one deliberately.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    """TestClient inside its context manager so the lifespan runs init_db()."""
    from backend.api import app
    with TestClient(app) as c:
        yield c


def _seed(sandbox):
    (sandbox / "alpha.txt").write_text("alpha")
    (sandbox / "notes.md").write_text("notes")
    sub = sandbox / "sub"
    sub.mkdir()
    (sub / "beta.txt").write_text("beta")
    (sandbox / ".hidden").write_text("skip me")
    (sandbox / "partial.crdownload").write_text("skip me too")


def test_health_shape(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)


def test_files_is_empty_before_any_scan(client):
    assert client.get("/files").json() == []


def test_scan_indexes_sandbox_and_skips_hidden_and_partial(client, sandbox):
    _seed(sandbox)
    r = client.post("/scan", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 3
    assert body["stale_removed"] == 0
    assert body["path"] == str(sandbox)
    names = {f["filename"] for f in client.get("/files").json()}
    assert names == {"alpha.txt", "notes.md", "beta.txt"}


def test_files_filters_by_path_prefix_and_q(client, sandbox):
    _seed(sandbox)
    client.post("/scan", json={})
    in_sub = client.get("/files", params={"path": str(sandbox / "sub")}).json()
    assert [f["filename"] for f in in_sub] == ["beta.txt"]
    q = client.get("/files", params={"q": "alph"}).json()
    assert [f["filename"] for f in q] == ["alpha.txt"]


def test_file_by_id_and_404(client, sandbox):
    _seed(sandbox)
    client.post("/scan", json={})
    first = client.get("/files").json()[0]
    r = client.get(f"/files/{first['id']}")
    assert r.status_code == 200
    assert r.json()["path"] == first["path"]
    assert "hash" in r.json()
    assert client.get("/files/999999").status_code == 404


def test_scan_removes_stale_rows(client, sandbox):
    _seed(sandbox)
    client.post("/scan", json={})
    (sandbox / "alpha.txt").unlink()
    body = client.post("/scan", json={}).json()
    assert body["count"] == 2
    assert body["stale_removed"] == 1


def test_scan_outside_sandbox_is_403(client, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    r = client.post("/scan", json={"path": str(outside)})
    assert r.status_code == 403
    assert "sandbox" in r.json()["detail"].lower()


def test_tags_empty(client):
    assert client.get("/tags").json() == []


def test_fs_list_root_returns_sandbox(client, sandbox):
    _seed(sandbox)
    r = client.get("/fs/list/root")
    assert r.status_code == 200
    assert r.json()["path"] == str(sandbox.resolve())
    names = {e["name"] for e in r.json()["entries"]}
    assert {"alpha.txt", "notes.md", "sub"} <= names


def test_stub_routes_report_not_implemented(client):
    """Stage 2 replaces each of these with a real assertion."""
    assert client.post("/files/1/tags").json() == {"status": "not_implemented"}
    assert client.get("/operations").json() == []
    assert client.post("/operations/1/undo").json() == {"status": "not_implemented"}
    assert client.post("/operations/batch/abc/undo").json() == {"status": "not_implemented"}
```

- [ ] **Step 2: Run to verify the one real failure**

Run: `py -3 -m pytest tests/test_api.py -q`
Expected: 9 pass, `test_scan_outside_sandbox_is_403` FAILS (the endpoint raises `OutOfSandboxError`, surfacing as a 500 / exception through `TestClient`).

- [ ] **Step 3: Add the 403 guard to `trigger_scan`**

Replace the body of `trigger_scan` in `backend/api.py`:

```python
@app.post("/scan")
async def trigger_scan(body: Optional[ScanRequest] = None):
    """Index a directory. Uses FILEPLUS_SANDBOX_PATH when no path is provided."""
    root = Path(body.path) if (body and body.path) else _config.FILEPLUS_SANDBOX_PATH
    try:
        count = await scan_directory(root)
    except OutOfSandboxError as e:
        raise HTTPException(status_code=403, detail=str(e))
    stale = await remove_stale_entries()
    return {"count": count, "stale_removed": stale, "path": str(root)}
```
`OutOfSandboxError` and `HTTPException` are already imported at the top of the file.

- [ ] **Step 4: Run the full suite**

Run: `py -3 -m pytest -q`
Expected: `40 passed`.

- [ ] **Step 5: Commit**

```bash
git add tests/test_api.py backend/api.py
git -c core.safecrlf=false commit -m "test(api): contract tests for every route; POST /scan returns 403 outside sandbox

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Deterministic sandbox fixture generator

**Files:**
- Create: `scripts/__init__.py` (empty), `scripts/gen_sandbox.py`
- Test: `tests/test_gen_sandbox.py`

**Interfaces:**
- Consumes: `backend.hasher.hash_file(path: Path) -> str`.
- Produces: `scripts.gen_sandbox.build(out: Path, large: bool = False) -> dict` returning `{"files": int, "dirs": int, "duplicates": int, "hidden": int}`; `EXPECTED_FILES = 42` (without `--large`), `EXPECTED_FILES_LARGE = 43`. CLI: `py -3 scripts/gen_sandbox.py [--out DIR] [--large]`, default out `FilePlusTestSandbox/_gen`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_gen_sandbox.py
"""The sandbox generator must be deterministic and cover every fixture class."""
import os
from pathlib import Path

from backend.hasher import hash_file
from scripts.gen_sandbox import build, EXPECTED_FILES


def _listing(root: Path) -> list[tuple[str, int]]:
    return sorted(
        (str(p.relative_to(root)), p.stat().st_size)
        for p in root.rglob("*") if p.is_file()
    )


def test_build_produces_expected_counts(tmp_path):
    stats = build(tmp_path / "gen")
    assert stats["files"] == EXPECTED_FILES
    assert stats["dirs"] >= 10
    assert stats["duplicates"] == 3
    assert stats["hidden"] == 2
    assert len(_listing(tmp_path / "gen")) == EXPECTED_FILES


def test_build_is_deterministic(tmp_path):
    build(tmp_path / "a")
    build(tmp_path / "b")
    assert _listing(tmp_path / "a") == _listing(tmp_path / "b")
    ha = hash_file(tmp_path / "a" / "Documents" / "report-2025.txt")
    hb = hash_file(tmp_path / "b" / "Documents" / "report-2025.txt")
    assert ha == hb


def test_duplicates_share_a_hash(tmp_path):
    root = tmp_path / "gen"
    build(root)
    original = root / "Documents" / "report-2025.txt"
    copies = [
        root / "Downloads" / "report-2025.txt",
        root / "Documents" / "old" / "report-2025 (1).txt",
        root / "Desktop" / "report-2025 - Copy.txt",
    ]
    for c in copies:
        assert c.exists(), c
        assert hash_file(c) == hash_file(original)


def test_hidden_files_carry_windows_hidden_attribute(tmp_path):
    root = tmp_path / "gen"
    build(root)
    for name in (".hidden-config", "thumbs.db"):
        attrs = (root / name).stat().st_file_attributes
        assert attrs & 0x2, f"{name} is not hidden"


def test_special_names_and_depth(tmp_path):
    root = tmp_path / "gen"
    build(root)
    assert (root / "Documents" / "Rechnung_Müller.txt").exists()
    assert (root / "Documents" / "ノート.md").exists()
    assert (root / "Documents" / "café menu.txt").exists()
    assert (root / "Projects" / "a" / "b" / "c" / "d" / "e" / "f" / "deep.txt").exists()
    assert (root / "Downloads" / "movie.mkv.crdownload").exists()
    assert (root / "Pictures" / "IMG_0001.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_large_flag_adds_one_sparse_file(tmp_path):
    root = tmp_path / "gen"
    stats = build(root, large=True)
    big = root / "Videos" / "large-render.mov"
    assert stats["files"] == EXPECTED_FILES + 1
    assert big.stat().st_size == 101 * 1024 * 1024
```

- [ ] **Step 2: Run to verify failure**

Run: `py -3 -m pytest tests/test_gen_sandbox.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts'`.

- [ ] **Step 3: Write the generator**

`scripts/__init__.py` is an empty file.

```python
# scripts/gen_sandbox.py
"""Deterministic sandbox fixture generator for FilePlus.

Creates a small, varied file tree that exercises every indexer/tagger path:
text, markdown, code, PNG images, a PDF header, duplicates by content,
Windows-hidden files, a partial download, unicode names, deep nesting and
(optionally) a 101 MB sparse file for the large-file rule.

Usage:
    py -3 scripts/gen_sandbox.py [--out DIR] [--large]

Default output: <repo>/FilePlusTestSandbox/_gen  (gitignored via FilePlusTestSandbox/).
Re-running is idempotent: the tree is removed and rebuilt from a fixed seed.
"""
from __future__ import annotations

import argparse
import ctypes
import os
import random
import shutil
import struct
import zlib
from pathlib import Path

SEED = 20260910
EXPECTED_FILES = 42
EXPECTED_FILES_LARGE = EXPECTED_FILES + 1
LARGE_BYTES = 101 * 1024 * 1024
FILE_ATTRIBUTE_HIDDEN = 0x2

_WORDS = ("invoice", "render", "sample", "draft", "budget", "session", "mix", "notes",
          "brief", "archive", "plan", "sketch", "log", "export", "master", "preview")


def _text(rng: random.Random, words: int) -> str:
    return " ".join(rng.choice(_WORDS) for _ in range(words)) + "\n"


def _png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Minimal valid RGB PNG (one colour), no external deps."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _hide(path: Path) -> None:
    if os.name == "nt":
        ok = ctypes.windll.kernel32.SetFileAttributesW(str(path), FILE_ATTRIBUTE_HIDDEN)
        if not ok:
            raise OSError(f"SetFileAttributesW failed for {path}")


def _write(path: Path, data: bytes | str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_bytes(data)


def build(out: Path, large: bool = False) -> dict:
    """Rebuild the fixture tree at *out* and return counts."""
    out = Path(out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    rng = random.Random(SEED)
    files = 0

    # Documents: 12 txt + 3 md + 1 pdf header + 3 unicode names  (19)
    for i in range(12):
        _write(out / "Documents" / f"doc-{i:02d}.txt", _text(rng, 40 + i * 7)); files += 1
    for name in ("readme.md", "meeting-notes.md", "todo.md"):
        _write(out / "Documents" / name, "# " + name + "\n\n" + _text(rng, 60)); files += 1
    _write(out / "Documents" / "contract.pdf", b"%PDF-1.4\n%FilePlus fixture\n" + _text(rng, 200).encode()); files += 1
    for name in ("Rechnung_Müller.txt", "ノート.md", "café menu.txt"):
        _write(out / "Documents" / name, _text(rng, 25)); files += 1

    # Duplicate set: 1 original + 3 byte-identical copies  (4)
    report = _text(rng, 300)
    _write(out / "Documents" / "report-2025.txt", report); files += 1
    for rel in ("Downloads/report-2025.txt", "Documents/old/report-2025 (1).txt", "Desktop/report-2025 - Copy.txt"):
        _write(out / rel, report); files += 1

    # Pictures: 6 PNGs  (6)
    for i in range(6):
        rgb = (rng.randrange(256), rng.randrange(256), rng.randrange(256))
        _write(out / "Pictures" / f"IMG_{i + 1:04d}.png", _png(16 + i * 8, 16 + i * 4, rgb)); files += 1

    # Projects: 3 code files + deep nesting  (4)
    _write(out / "Projects" / "app" / "main.py", "def main():\n    print('fileplus')\n\nif __name__ == '__main__':\n    main()\n"); files += 1
    _write(out / "Projects" / "app" / "utils.py", "def add(a, b):\n    return a + b\n"); files += 1
    _write(out / "Projects" / "web" / "app.js", "console.log('fileplus');\n"); files += 1
    _write(out / "Projects" / "a" / "b" / "c" / "d" / "e" / "f" / "deep.txt", _text(rng, 10)); files += 1

    # Music: 4 fake wav headers  (4)
    for i in range(4):
        _write(out / "Music" / f"take-{i + 1:02d}.wav", b"RIFF" + struct.pack("<I", 36) + b"WAVEfmt " + bytes(rng.randrange(256) for _ in range(64))); files += 1

    # Downloads: installer stub, zip stub, partial download  (3)
    _write(out / "Downloads" / "setup-tool.exe", b"MZ" + bytes(rng.randrange(256) for _ in range(512))); files += 1
    _write(out / "Downloads" / "presets.zip", b"PK\x03\x04" + bytes(rng.randrange(256) for _ in range(256))); files += 1
    _write(out / "Downloads" / "movie.mkv.crdownload", bytes(rng.randrange(256) for _ in range(1024))); files += 1

    # Hidden: dotfile + thumbs.db, both with the Windows hidden attribute  (2)
    _write(out / ".hidden-config", "hidden=1\n"); _hide(out / ".hidden-config"); files += 1
    _write(out / "thumbs.db", bytes(64)); _hide(out / "thumbs.db"); files += 1

    # Empty folders (0 files, 2 dirs)
    (out / "Empty").mkdir()
    (out / "Videos").mkdir()

    if large:
        big = out / "Videos" / "large-render.mov"
        with open(big, "wb") as fh:
            fh.truncate(LARGE_BYTES)
        files += 1

    assert files == (EXPECTED_FILES_LARGE if large else EXPECTED_FILES), files
    dirs = sum(1 for p in out.rglob("*") if p.is_dir())
    return {"files": files, "dirs": dirs, "duplicates": 3, "hidden": 2}


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=repo / "FilePlusTestSandbox" / "_gen")
    ap.add_argument("--large", action="store_true", help="also create a 101 MB sparse file")
    args = ap.parse_args()
    stats = build(args.out, large=args.large)
    print(f"built {stats['files']} files in {stats['dirs']} dirs at {args.out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests**

Run: `py -3 -m pytest tests/test_gen_sandbox.py -q`
Expected: `6 passed`. If `test_build_produces_expected_counts` reports a different number, the `assert files == ...` inside `build()` will have fired first — fix the count constant to match the actual tree only if a file was genuinely added or removed; never delete fixture files to make the number fit.

- [ ] **Step 5: Generate the real fixture once and confirm it is ignored**

Run: `py -3 scripts/gen_sandbox.py && git status --short`
Expected: `built 42 files in ... dirs at ...\FilePlusTestSandbox\_gen`; `git status` shows only `scripts/` and `tests/test_gen_sandbox.py` as new.

- [ ] **Step 6: Full suite, then commit**

Run: `py -3 -m pytest -q` → Expected `46 passed`.

```bash
git add scripts/__init__.py scripts/gen_sandbox.py tests/test_gen_sandbox.py
git -c core.safecrlf=false commit -m "test: deterministic sandbox fixture generator (scripts/gen_sandbox.py)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Electron smoke test with Playwright

**Files:**
- Modify: `frontend/package.json` (add `test` script and `@playwright/test` devDependency)
- Create: `frontend/playwright.config.js`, `frontend/test/smoke.spec.js`
- Modify: `.gitignore` (add `artifacts/`)

**Interfaces:**
- Consumes: globals defined in `frontend/src/app.js` and reachable from the renderer: `switchScreen(id)`, `openPalette()`, `closePalette()`; screen container ids `#screen-<id>` for `home, browser, ftree, scan-config, scan-progress, scan-results, review-bin, everything, settings`; `#shell` root element. Backend on `http://127.0.0.1:9876` (must already be running; Task 5 starts it).
- Produces: `npm test` in `frontend/` exits 0 when every screen renders with zero `pageerror`/`console.error` and writes `artifacts/screenshots/<screen>.png` plus `palette.png` at the repo root.

- [ ] **Step 1: Install the test runner**

Run (from `frontend/`): `npm install --save-dev @playwright/test`
Expected: `package.json` gains `"@playwright/test": "^1.x"` under `devDependencies`; `package-lock.json` updates. No browser download is needed — Playwright drives the installed Electron binary.

- [ ] **Step 2: Add the test script**

In `frontend/package.json`, change `scripts` to:
```json
"scripts": {
  "start": "electron .",
  "test": "playwright test"
}
```

- [ ] **Step 3: Write the config**

```js
// frontend/playwright.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '../artifacts/test-results',
});
```

- [ ] **Step 4: Write the failing smoke test**

```js
// frontend/test/smoke.spec.js
// Launches the real Electron app against a running backend, visits every
// screen, fails on any renderer error, and screenshots each screen.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const FRONTEND = path.join(__dirname, '..');
const SHOTS = path.join(FRONTEND, '..', 'artifacts', 'screenshots');
const API = 'http://127.0.0.1:9876';
const SCREENS = [
  'home', 'browser', 'ftree', 'scan-config', 'scan-progress',
  'scan-results', 'review-bin', 'everything', 'settings',
];

test('backend /health is reachable', async () => {
  const r = await fetch(`${API}/health`);
  expect(r.ok).toBeTruthy();
  expect((await r.json()).status).toBe('ok');
});

test('every screen renders with no renderer errors', async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [FRONTEND],
    cwd: FRONTEND,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.waitForSelector('#shell');
  await page.waitForTimeout(1500); // fonts, first /health poll

  for (const id of SCREENS) {
    await page.evaluate((s) => switchScreen(s), id);
    await expect(page.locator(`#screen-${id}`)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `${id}.png`) });
  }

  await page.evaluate(() => openPalette());
  await page.screenshot({ path: path.join(SHOTS, 'palette.png') });
  await page.evaluate(() => closePalette());

  await app.close();
  expect(errors, errors.join('\n')).toEqual([]);
});
```

- [ ] **Step 5: Run it without a backend to see the first test fail**

Run (from `frontend/`, with nothing on port 9876): `npm test`
Expected: `backend /health is reachable` FAILS with a fetch error; the second test may pass or fail. This confirms the reachability gate works.

- [ ] **Step 6: Start the backend and run again**

In one shell from the repo root: `py -3 -m backend.api` (leave running).
In another, from `frontend/`: `npm test`
Expected: `2 passed`; `artifacts/screenshots/` contains 10 PNGs.

If the second test fails on collected errors: read them. A `pageerror` or `console.error` coming from `app.js` / `actions.js` is a real defect in the renderer — fix its root cause (this is in scope: the harness must be green on the real app). Do not add an allowlist. If the error is a network fetch failure because the backend was down, that is the reachability gate's job, not this test's; re-run with the backend up.

- [ ] **Step 7: Ignore build artefacts**

Append to `.gitignore`:
```
# Test artefacts (screenshots, Playwright output)
artifacts/
```

- [ ] **Step 8: Commit**

```bash
git add .gitignore frontend/package.json frontend/package-lock.json frontend/playwright.config.js frontend/test/smoke.spec.js
git -c core.safecrlf=false commit -m "test(frontend): Playwright Electron smoke test visits every screen and screenshots it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: One-command `verify`

**Files:**
- Create: `scripts/verify.ps1`

**Interfaces:**
- Consumes: `py -3 -m pytest -q` (Tasks 2–3), `npm test` in `frontend/` (Task 4), `py -3 -m backend.api` serving `/health` on 9876.
- Produces: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` exits 0 only when pytest and the smoke test both pass. This is the gate named in spec §6 step 4.

- [ ] **Step 1: Write the script**

```powershell
# scripts/verify.ps1 — the single gate for every autonomous run.
# Runs: pytest -> start backend -> Electron smoke test -> stop backend.
# Exit code is non-zero if any stage fails.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== 1/3 pytest ==' -ForegroundColor Cyan
py -3 -m pytest -q
if ($LASTEXITCODE -ne 0) { Write-Host 'pytest failed' -ForegroundColor Red; exit 1 }

Write-Host '== 2/3 backend ==' -ForegroundColor Cyan
$backend = Start-Process -FilePath 'py' -ArgumentList '-3', '-m', 'backend.api' `
  -WorkingDirectory $root -WindowStyle Hidden -PassThru
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9876/health' -TimeoutSec 1
    if ($r.StatusCode -eq 200) { $healthy = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if (-not $healthy) {
  Write-Host 'backend did not answer /health within 20 s' -ForegroundColor Red
  if (-not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
  exit 1
}

Write-Host '== 3/3 electron smoke ==' -ForegroundColor Cyan
$code = 1
try {
  Push-Location (Join-Path $root 'frontend')
  npm test
  $code = $LASTEXITCODE
  Pop-Location
} finally {
  if (-not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
}

if ($code -ne 0) { Write-Host 'smoke test failed' -ForegroundColor Red; exit $code }
Write-Host 'verify: all green' -ForegroundColor Green
exit 0
```

Note: if a backend is already listening on 9876, the spawned one exits on bind failure and the health loop still passes against the existing process. That is acceptable for local use; the script never kills a process it did not start.

- [ ] **Step 2: Run it**

Run (from the repo root, Git Bash or PowerShell): `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1`
Expected: three cyan headers, `46 passed`, `2 passed`, `verify: all green`, exit code 0. Confirm with `echo $?` (Bash) or `$LASTEXITCODE` (PowerShell).

- [ ] **Step 3: Prove it fails red**

Temporarily break a test: in `tests/test_api.py` change `assert body["status"] == "ok"` to `== "nope"`, run verify, expect exit 1 and `pytest failed`. Revert the change (`git checkout tests/test_api.py`) and confirm `git status --short` shows only `scripts/verify.ps1`.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify.ps1
git -c core.safecrlf=false commit -m "chore: scripts/verify.ps1 runs pytest, backend and Electron smoke as one gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs consolidation

**Files:**
- Move (git mv) into `docs/archive/`: `PLAN.md`, `docs/task-list.md`, `docs/design-brief.md`, `docs/design-tokens.md`, `DESIGN.md`, `DESIGN.json`, `docs/UI-AUDIT-2026-04-25.md`, `docs/UI-REFINEMENT-REPORT.md`, `fileplus-manual.pdf`
- Create: `docs/archive/README.md`
- Modify: `README.md` (status section), `docs/UI-SPEC.md` (header note)
- Modify: any file outside `docs/archive/` and `docs/superpowers/plans/` that links to a moved file

**Interfaces:**
- Consumes: spec §8 tables.
- Produces: exactly the "Keep as canonical" set at their current paths; everything else under `docs/archive/`.

- [ ] **Step 1: Move the files**

```bash
git mv PLAN.md docs/archive/PLAN.md
git mv docs/task-list.md docs/archive/task-list.md
git mv docs/design-brief.md docs/archive/design-brief.md
git mv docs/design-tokens.md docs/archive/design-tokens.md
git mv DESIGN.md docs/archive/DESIGN.md
git mv DESIGN.json docs/archive/DESIGN.json
git mv docs/UI-AUDIT-2026-04-25.md docs/archive/UI-AUDIT-2026-04-25.md
git mv docs/UI-REFINEMENT-REPORT.md docs/archive/UI-REFINEMENT-REPORT.md
git mv fileplus-manual.pdf docs/archive/fileplus-manual.pdf
```

- [ ] **Step 2: Write the archive index**

```markdown
# docs/archive

Historical documents kept for reference. None of these is canonical. The current roadmap is
[`../superpowers/specs/2026-09-10-fileplus-roadmap-design.md`](../superpowers/specs/2026-09-10-fileplus-roadmap-design.md).

| File | What it was | Superseded by |
|---|---|---|
| `fileplus-manual.pdf` | Original April 2026 seed document | `PRODUCT.md`, `fileplus-feature-list.md` |
| `PLAN.md` | Phase 0–11 build plan | Roadmap spec §5 |
| `task-list.md` | Flat task backlog | Stage plans under `docs/superpowers/plans/` |
| `design-brief.md` | First UI brief (already marked superseded 2026-04-25) | `UI-SPEC.md` for behaviour; roadmap D8 for style |
| `design-tokens.md`, `DESIGN.md`, `DESIGN.json` | Purple/amber token system | Roadmap D7/D8; `frontend/src/styles.css` after Stage 1 |
| `UI-AUDIT-2026-04-25.md`, `UI-REFINEMENT-REPORT.md` | Audit and reconciliation logs from the April polish | — (historical) |
| `finalization-spec-v0.md` | Pre-brief spec | `UI-SPEC.md` |
```

- [ ] **Step 3: Fix dangling links**

Run: `grep -rn --include=*.md -E "PLAN\.md|task-list\.md|design-brief\.md|design-tokens\.md|DESIGN\.md|DESIGN\.json|UI-AUDIT|UI-REFINEMENT|fileplus-manual" . --exclude-dir=node_modules --exclude-dir=archive --exclude-dir=plans --exclude-dir=.git`
For every hit outside `CLAUDE.md` (rewritten in Task 7): repoint the link to the `docs/archive/` path, or delete the sentence if it instructs the reader to follow a superseded process (for example "Run Section 41 audit"). Expected hits: `README.md` ("See PLAN.md…"), possibly `docs/UI-SPEC.md` and `docs/backend-integration.md`. The roadmap spec's own mentions are descriptive and stay.

- [ ] **Step 4: Update README status and UI-SPEC header**

Replace the `## Development status` section of `README.md` with:
```markdown
## Development status

Restarted 2026-09-10. The roadmap and every decision live in
[docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md](docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md).
Session rules are in [CLAUDE.md](CLAUDE.md).

Run everything with one command from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```
```
Also change the `### Test` block earlier in README to `py -3 -m pytest -q` and add a `### Fixtures` block: `py -3 scripts/gen_sandbox.py` builds `FilePlusTestSandbox/_gen`.

Insert after the title line of `docs/UI-SPEC.md`:
```markdown
> **Style note (2026-09-10).** Section A.0 "Aesthetic baseline" and every colour, bevel, glow and font reference in this document describe the April 2026 design, which the roadmap replaces (decisions D7/D8 in `superpowers/specs/2026-09-10-fileplus-roadmap-design.md`). Layout, sizing, density and behaviour in this document remain canonical.
```

- [ ] **Step 5: Verify and commit**

Run: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` → Expected `verify: all green`.
Run the grep from Step 3 again → Expected: no hits outside `CLAUDE.md`.

```bash
git add -A
git -c core.safecrlf=false commit -m "docs: archive superseded plan and design docs; one canonical doc per concern

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Rewrite CLAUDE.md for the autonomous-run working mode

**Files:**
- Modify: `CLAUDE.md` (full rewrite, ≤100 lines)

**Interfaces:**
- Consumes: roadmap spec §3, §6; `scripts/verify.ps1`; the load-bearing frontend traps recorded in the April memory notes.
- Produces: the session-context file every future Claude session reads first.

- [ ] **Step 1: Replace the file with this content**

```markdown
# FilePlus — Claude Code Reference

Windows desktop app: an AI-driven replacement for Windows Explorer. Files land in one inbox, the AI
proposes where they belong, the user approves, every move is logged and undoable.

**Read first:** `docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md` (roadmap, decisions D1–D10,
run protocol). Check which stage is active in `docs/superpowers/runs/` before doing anything.

## Stack

Backend Python 3.14 (`py -3`) · FastAPI on `localhost:9876` · aiosqlite/SQLite WAL · xxhash · watchdog.
Frontend Electron 41, plain HTML/CSS/JS, no framework, no build step. Tests: pytest (asyncio auto) and
`@playwright/test` driving Electron.

## Hard safety rules (non-negotiable)

- Nothing moves, renames or deletes without explicit user approval.
- Every file operation is written to `operations_log` BEFORE it executes.
- `path_guard()` gates every filesystem touch. Reads may span real drives; writes stay inside
  `FILEPLUS_SANDBOX_PATH` until `WRITE_UNLOCKED=true` (decision D2; implemented in Stage 2).
- Deletes go to the Recycle Bin or a staging area, never straight to gone.

## Verify before every commit

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```
Runs pytest, starts the backend, runs the Electron smoke test (every screen, zero console errors,
screenshots to `artifacts/screenshots/`), stops the backend. Red means stop and fix; never commit on red.
Fixtures: `py -3 scripts/gen_sandbox.py` rebuilds `FilePlusTestSandbox/_gen`.

## Working protocol (spec §6)

Brainstorm → stage spec → task plan → one autonomous run on `stage/<n>-<slug>` → author reviews once →
merge. Per task: implement, verify green, commit. Stop only for a destructive action outside the spec,
a spec ambiguity that changes design, or verify red after two fixes. Runs end with
`docs/superpowers/runs/<date>-stage-<n>.md`. Do NOT pause after each change for a visual check; the
April "one fix at a time" rule is retired (D10).

## Coding conventions

- All paths come from `backend/config.py`; never hardcode one.
- Backend is async everywhere (`async def`, `aiosqlite`, `aiohttp`). No global DB connection.
- Frontend talks to the backend with `fetch()` only; the renderer never touches Node fs.
- API routes have NO `/api/` prefix.
- Model IDs and AI tier order live in config only (spec §7); no model string in any `.py` outside
  `config.py` defaults.
- Placeholders are debt: a screen with fake data is not built. Wire real data or hide the screen.

## Frontend traps (load-bearing, learned the hard way)

- Click dispatch is the `switch` in `frontend/src/app.js` (`document.addEventListener('click', …)`).
  `actions.js` exports an `ACTION_MAP` that nothing calls; helpers there are fine, the registry is dead.
  Stage 2 decides its fate.
- `index.html` loads `actions.js` before `app.js`; both define `showSnackbar`/`showToast` and the later
  (app.js) binding wins. Use app.js's signature `showSnackbar(msg, 'Undo', fn)`.
- Snackbars/toasts are gated by `localStorage['fp-notifications-enabled']` (default off). Only
  `showToast(msg, 'error')` bypasses. No other exceptions.
- Tab close affordance is `<span role="button">`, never a nested `<button>`. Per-tab screen state lives
  on `data-tab-screen`; `switchScreen(id)` mutates the active tab, `switchToTab(tab)` activates another.
- Repeating visual treatments become tokens in `:root` of `styles.css`; accent-derived colours use
  `color-mix(... var(--accent) ...)`, never hardcoded rgba.

## Current state

See `docs/superpowers/runs/` for the latest run summary and the roadmap spec §2 for the baseline
inventory. Canonical docs: `PRODUCT.md`, `docs/UI-SPEC.md` (behaviour; style superseded),
`docs/backend-integration.md` (wiring ledger), `docs/fileplus-feature-list.md` (backlog).
Everything else is under `docs/archive/`.
```

- [ ] **Step 2: Check the length and links**

Run: `wc -l CLAUDE.md` → Expected ≤ 100.
Run: `ls docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md scripts/verify.ps1 scripts/gen_sandbox.py PRODUCT.md docs/UI-SPEC.md docs/backend-integration.md docs/fileplus-feature-list.md` → Expected: every path exists.

- [ ] **Step 3: Verify and commit**

Run: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` → Expected `verify: all green`.

```bash
git add CLAUDE.md
git -c core.safecrlf=false commit -m "docs: rewrite CLAUDE.md for the autonomous-run working mode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Run summary

**Files:**
- Create: `docs/superpowers/runs/2026-09-10-stage-0.md`

**Interfaces:**
- Consumes: `git log master..stage/0-reset-harness --oneline`, the final `verify` output, `artifacts/screenshots/`.
- Produces: the review document the author reads before merging (spec §6 step 5 and 7).

- [ ] **Step 1: Run verify one last time and capture the numbers**

Run: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 2>&1 | tail -20` and `git log master..HEAD --oneline` and `ls artifacts/screenshots`.

- [ ] **Step 2: Write the summary**

```markdown
# Run summary — Stage 0: Reset and harness

**Branch:** `stage/0-reset-harness` (on top of `master` @ 5395d53)
**Date:** 2026-09-10
**Plan:** `docs/superpowers/plans/2026-09-10-stage-0-reset-and-harness.md`
**Verify:** `verify: all green` — pytest <N> passed, smoke 2 passed, <N> screenshots in `artifacts/screenshots/`.

## What landed
<one line per commit from `git log master..HEAD --oneline`, oldest first>

## What was skipped and why
<"Nothing" or the list>

## Open questions for the author
<anything that needs a decision before Stage 1; otherwise "None">

## How to review
1. `git switch stage/0-reset-harness`
2. `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1`
3. Open `artifacts/screenshots/` and glance at each screen (they still show the April design; Stage 1 changes that).
4. Read `CLAUDE.md` and `docs/archive/README.md`.
5. Merge: `git switch master && git merge --no-ff stage/0-reset-harness`.
```
Fill every `<…>` with the real values from Step 1. No angle-bracket placeholders may remain.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/runs/2026-09-10-stage-0.md
git -c core.safecrlf=false commit -m "docs(run): Stage 0 summary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec

- **Spec coverage.** Stage 0 scope-in items: commit April work (T1); docs consolidation + CLAUDE.md rewrite (T6, T7); retire one-fix-at-a-time in docs (T7; memory already updated 2026-09-10); pytest API layer (T2); sandbox generator (T3); Electron smoke with screenshots (T4); one verify command (T5); `/api/` prefix fixed (confirmed in T1 Step 2, already done in the dirty tree). Run summary per §6 (T8). Done-when: verify green on one command (T5), CLAUDE.md ≤100 lines (T7), one canonical file per concern (T6).
- **Placeholders.** The only angle-bracket fields are in T8's template and Step 2 instructs filling them.
- **Type consistency.** `build(out, large=False) -> dict` with keys `files, dirs, duplicates, hidden` is used identically in T3 code and tests. `EXPECTED_FILES = 42` matches the per-section counts: Documents 12 + 3 + 1 + 3 = 19, duplicate set 4, Pictures 6, Projects 4, Music 4, Downloads 3, hidden 2 = 42. Screen ids in T4 match the `id="screen-*"` containers in `frontend/index.html`.
