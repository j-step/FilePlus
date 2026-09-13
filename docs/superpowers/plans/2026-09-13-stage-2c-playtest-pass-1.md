# Stage 2C — Playtest pass 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver every item of the author's 2026-09-12 playtest notes: real tabs, an inspector switch, deselect-anywhere, Explorer-grade drag and drop, a full Properties panel, View/Sort/refresh/This PC/Quick Access parity, a custom icon set with Windows thumbnails, the Discord-style search, and the "Ask File+" shell.

**Architecture:** Backend gains small Windows-shell helpers (`backend/winshell.py`), a live tree searcher (`backend/searcher.py`), a shared file-type taxonomy (`backend/filetypes.py`, generated into `frontend/src/filetypes.js`), and five logged/undoable or read-only routes. The Electron main process gains icon/thumbnail/shell-dialog bridge methods. The renderer gains five modules (`filetypes.js`, `icons.js`, `dragdrop.js`, `search.js`, `properties.js`) and a per-tab state model in `app.js`. All new settings persist through the existing `saveSetting` → `POST /config` path.

**Tech Stack:** Python 3.14 (`py -3`), FastAPI, aiosqlite, ctypes (Win32), pywin32 (`propsys`), Electron 41 (`app.getFileIcon`, `nativeImage.createThumbnailFromPath`), plain HTML/CSS/JS, `@fluentui/svg-icons` (MIT, vendored at build), pytest, `@playwright/test`.

**Spec:** `docs/superpowers/specs/2026-09-12-stage-2c-playtest-pass-1-design.md` (the authority; section numbers below refer to it).

## Global Constraints

- Hard safety rules unchanged (CLAUDE.md): nothing moves/renames/deletes/changes attributes without a user gesture; every mutation is `path_guard(mode='write')` → `log_operation(executed=0)` → act in `asyncio.to_thread` → `mark_executed` (`mark_error` on exception); undo is a logged inverse with `undo_of`; reads use `path_guard(mode='read')`. No hard delete.
- Backend async everywhere; blocking Win32/propsys/scandir work runs in `asyncio.to_thread`. All paths from `backend/config.py`. API routes have no `/api/` prefix. Every new route requires the `X-FilePlus-Token` header like the rest (middleware already does this).
- Renderer: `fetch()` through `API.*` only; the Electron bridge (`preload.js`) is the only other channel and only for shell integration (icons, thumbnails, dialogs, open/reveal). Click dispatch is the `switch` in `app.js` + `IN_SCOPE_ACTIONS`; no registry. Notifications gate is universal; only `showToast(msg,'error')` bypasses. Theme tokens only; accent-derived colours via `color-mix(... var(--accent) ...)`; flat elevation (borders, one popover/modal shadow). Zero renderer console errors in the smoke.
- Script load order in `frontend/index.html`: `api.js, filetypes.js, icons.js, fileops.js, browser.js, dragdrop.js, search.js, inspector.js, properties.js, home.js, settings.js, app.js`. A file may reference anything defined earlier at top level; later files only from inside functions that run after `DOMContentLoaded`.
- Copy in the UI: "Ask File+", "This PC", "Index for This PC search", "No file selected", "Not built yet — planned for Stage 3."
- Verify gate before every commit: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` all green. Commit trailer exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; commit with `git -c core.safecrlf=false commit`.
- Test counts in this plan are approximate; implementers report the actual counts and never chase a number.
- New settings keys (all under `POST /config`, read back in `applySettingsFromConfig`): `ui.inspector_open` (bool, default true), `ui.sidebar_thispc_open` (bool, true), `ui.quick_access_hidden` (string[] of known-folder ids, `[]`), `ui.list_scale` (number, 1.0), `ui.view_mode` (`details|list|grid`, `details`), `ui.sort` (`{key, dir}`, `{key:'name',dir:'asc'}`), `ui.dynamic_media_view` (bool, true), `ui.backspace_deletes` (bool, false), `ui.properties_mode` (`fileplus|windows`, `fileplus`), `ui.icon_source` (`fileplus|windows`, `fileplus`).

## File map

| File | Responsibility |
|---|---|
| `backend/filetypes.py` (new) | Extension → family and → search type group. Source of truth; exported as JSON. |
| `backend/winshell.py` (new) | ctypes/pywin32 helpers: known folders, attributes, size on disk, associations, desktop.ini, property store, contains counts. |
| `backend/searcher.py` (new) | Budgeted live tree search. |
| `backend/api.py` | New routes: `/filetypes`, `/known-folders`, `/fs/peek`, `/index/status`, `DELETE /index`, `/fs/search`, `/search` filters, `/fs/properties`, `/fs/properties/details`, `POST /fs/attributes`, `POST /fs/folder-type`. |
| `backend/mover.py` | `set_attributes`, `set_folder_type` mutations and their undo inverses. |
| `backend/database.py` | Schema v4: `index_roots` table. |
| `backend/indexer.py` | Record index roots and counts. |
| `scripts/build_filetypes.py` (new) | Generates `frontend/src/filetypes.js`. |
| `scripts/build_icons.js` (new) | Builds `frontend/src/icons-sprite.js` from vendored Fluent icons + `frontend/assets/icons/filetypes/*.svg`. |
| `scripts/check_icons.js` (new) | Gate: no stray inline `<svg`, every referenced symbol exists, every family has a symbol. |
| `frontend/main.js`, `frontend/preload.js` | Bridge: `fileIcon`, `thumbnail`, `showProperties`, `openWithDialog`. |
| `frontend/iconCache.js` (new) | Pure LRU + path validation used by main.js (unit-tested). |
| `frontend/native/show-properties.ps1` (new) | Invokes the shell Properties verb and waits for the dialog. |
| `frontend/src/filetypes.js` (generated) | `FP_FILETYPES`, `fpFamilyFor`, `fpTypeGroupFor`, `fpIsMedia`. |
| `frontend/src/icons.js` (new) | `icon(name)`, `iconFor(entry)`, thumbnail loader, icon-source switch. |
| `frontend/src/dragdrop.js` (new) | Pointer-event drag session, badge, spring-load, modifiers. |
| `frontend/src/search.js` (new) | Search bar, chips, dropdown, more-filters modal, history, results listing. |
| `frontend/src/properties.js` (new) | Properties modal (General/Details), attribute and folder-type edits. |
| `frontend/src/app.js` | Tab model, View/Sort menus, Ask File+, deselect-anywhere, theme toggle fix, menu applicability, new settings dispatch. |
| `frontend/src/browser.js` | Selection visuals, list scale, view modes, dynamic media view, favorites star, results listing hooks, breadcrumb labels. |
| `frontend/src/inspector.js` | Switch semantics, empty state, fixed geometry. |
| `frontend/src/home.js` | `favoritesSet` shared, deselect. |
| `frontend/src/settings.js` | New keys, Scan & Index real status, Quick Access checkboxes. |
| `frontend/index.html`, `frontend/src/styles.css` | Markup and tokens for everything above. |
| `frontend/test/smoke.spec.js`, `frontend/test/icon-cache.spec.js` (new) | E2E and unit coverage. |
| `scripts/verify.ps1` | Adds the icon gate and the filetypes parity gate. |

---

### Task 1: File-type taxonomy, known folders, peek, index status (backend)

**Files:**
- Create: `backend/filetypes.py`, `backend/winshell.py`, `scripts/build_filetypes.py`, `frontend/src/filetypes.js` (generated), `tests/test_filetypes.py`, `tests/test_winshell.py`, `tests/test_index_status.py`
- Modify: `backend/api.py`, `backend/database.py` (schema v4), `backend/indexer.py`, `tests/test_api.py` (or wherever `/fs/list` tests live — follow the existing file)

**Interfaces:**
- Produces `backend/filetypes.py`:
  ```python
  FAMILIES: dict[str, tuple[str, ...]]   # family -> extensions (lowercase, no dot)
  GROUPS: dict[str, tuple[str, ...]]     # search group -> families
  def family_for(ext: str) -> str        # 'generic' when unknown; ext may carry a leading dot / any case
  def type_group_for(ext: str, is_dir: bool = False) -> str  # 'folder' | group | 'other'
  def is_media(ext: str) -> bool         # group in {'image','video'}
  def as_json() -> dict                  # {"families": FAMILIES, "groups": GROUPS}
  ```
  Families (exact keys): `text, markdown, pdf, word, excel, powerpoint, csv, code-js, code-ts, code-py, code-html, code-css, code-json, code-xml, code-yaml, code-shell, code-c, code-java, code-go, code-rust, code-other, image, image-raw, svg, video, audio, archive, executable, shortcut, installer, font, disk-image, database, ebook, generic`. Groups (exact keys): `image → (image, image-raw, svg)`, `video → (video)`, `audio → (audio)`, `document → (text, markdown, pdf, word, excel, powerpoint, csv, ebook)`, `code → (all code-* families)`, `archive → (archive, disk-image)`, `executable → (executable, shortcut, installer)`, `other` is everything else (font, database, generic).
- Produces `backend/winshell.py::known_folders() -> list[dict]` with `{id, name, path}` for ids `desktop, downloads, documents, pictures, videos, music, screenshots` (screenshots only when `<pictures>\Screenshots` exists). Windows: `SHGetKnownFolderPath` via ctypes with the FOLDERID GUIDs `Desktop {B4BFCC3A-DB2C-424C-B029-7FE99A87C641}`, `Downloads {374DE290-123F-4565-9164-39C4925E467B}`, `Documents {FDD39AD0-238F-46AF-ADB4-6C85480369C7}`, `Pictures {33E28130-4E1E-4676-835A-98395C3BC3BB}`, `Videos {18989B1D-99B5-455B-841C-AB7C74E4DDFC}`, `Music {4BD8D571-6D19-48D3-BE97-422220080E43}`; non-Windows or failure → `Path.home()/<Name>`.
- Produces routes: `GET /filetypes` → `as_json()`; `GET /known-folders` → `{folders: [...]}`; `GET /fs/peek?path=&n=2` → `{items: [{name, path, ext}]}` (first `n` non-hidden media files by name, `path_guard` read, `LISTING_CAP` not needed — stop scanning after `n` hits or 2000 entries); `GET /index/status` → `{roots: [{root, file_count, last_run}], running: bool}`; `DELETE /index?root=` → removes the root's rows (`remove_stale_entries(root)` + delete its `index_roots` row) → `{status:'ok', removed: n}`.
- Produces `scripts/build_filetypes.py`: writes `frontend/src/filetypes.js`:
  ```js
  // GENERATED by scripts/build_filetypes.py from backend/filetypes.py — do not edit.
  const FP_FILETYPES = {"families": {...}, "groups": {...}};
  const _FP_EXT_TO_FAMILY = (() => { const m = {}; for (const [fam, exts] of Object.entries(FP_FILETYPES.families)) for (const e of exts) m[e] = fam; return m; })();
  const _FP_FAMILY_TO_GROUP = (() => { const m = {}; for (const [g, fams] of Object.entries(FP_FILETYPES.groups)) for (const f of fams) m[f] = g; return m; })();
  function fpFamilyFor(ext) { const e = String(ext || '').replace(/^\./, '').toLowerCase(); return _FP_EXT_TO_FAMILY[e] || 'generic'; }
  function fpTypeGroupFor(ext, isDir) { if (isDir) return 'folder'; return _FP_FAMILY_TO_GROUP[fpFamilyFor(ext)] || 'other'; }
  function fpIsMedia(ext) { const g = fpTypeGroupFor(ext, false); return g === 'image' || g === 'video'; }
  ```
- Schema v4 adds:
  ```sql
  CREATE TABLE IF NOT EXISTS index_roots (
      root       TEXT PRIMARY KEY,
      file_count INTEGER NOT NULL DEFAULT 0,
      last_run   TEXT NOT NULL
  );
  ```
  `scan_directory(root, hash)` upserts `(root, count, now)` when it finishes. `POST /index` unchanged otherwise.

- [ ] **Step 1: Write failing tests** (`tests/test_filetypes.py`):
```python
from backend import filetypes as ft

def test_family_and_group_lookup():
    assert ft.family_for("PNG") == "image"
    assert ft.family_for(".py") == "code-py"
    assert ft.family_for("zzz") == "generic"
    assert ft.type_group_for("mp4") == "video"
    assert ft.type_group_for("docx") == "document"
    assert ft.type_group_for("", is_dir=True) == "folder"
    assert ft.type_group_for("ttf") == "other"

def test_every_family_in_exactly_one_group_or_other():
    grouped = [f for fams in ft.GROUPS.values() for f in fams]
    assert len(grouped) == len(set(grouped))
    for fam in ft.FAMILIES:
        assert fam in grouped or fam in ("font", "database", "generic")

def test_no_extension_in_two_families():
    seen = {}
    for fam, exts in ft.FAMILIES.items():
        for e in exts:
            assert e == e.lower() and not e.startswith(".")
            assert e not in seen, f"{e} in {fam} and {seen[e]}"
            seen[e] = fam

def test_generated_js_is_current(tmp_path):
    import subprocess, sys, pathlib
    src = pathlib.Path("frontend/src/filetypes.js").read_text(encoding="utf-8")
    out = tmp_path / "filetypes.js"
    subprocess.run([sys.executable, "scripts/build_filetypes.py", str(out)], check=True)
    assert out.read_text(encoding="utf-8") == src, "run: py -3 scripts/build_filetypes.py"
```
`tests/test_winshell.py`:
```python
import os, pytest
from backend import winshell

def test_known_folders_shape():
    folders = winshell.known_folders()
    ids = [f["id"] for f in folders]
    for required in ("desktop", "downloads", "documents", "pictures", "videos", "music"):
        assert required in ids
    for f in folders:
        assert f["name"] and os.path.isabs(f["path"])

@pytest.mark.skipif(os.name != "nt", reason="windows only")
def test_known_folders_are_absolute_windows_paths():
    for f in winshell.known_folders():
        assert f["path"][1:3] == ":\\"
```
`tests/test_index_status.py` (use the existing TestClient/db fixtures from `tests/test_api*.py`): index a tmp folder with two files via `POST /index`, await the task, `GET /index/status` shows the root with `file_count == 2`; `DELETE /index?root=` returns `removed == 2` and status no longer lists it; `GET /filetypes` returns the same dict as `filetypes.as_json()`; `GET /known-folders` returns ≥ 6 folders; `GET /fs/peek?path=<_gen Pictures-like dir>&n=2` returns ≤ 2 media items and 400 for a relative path.
- [ ] **Step 2: Run tests, confirm they fail** (`py -3 -m pytest -q tests/test_filetypes.py tests/test_winshell.py tests/test_index_status.py`).
- [ ] **Step 3: Implement** `backend/filetypes.py` (a comprehensive extension list; at least: text `txt log ini cfg conf nfo`, markdown `md markdown`, pdf `pdf`, word `doc docx odt rtf`, excel `xls xlsx ods`, powerpoint `ppt pptx odp`, csv `csv tsv`, code-js `js mjs cjs jsx`, code-ts `ts tsx`, code-py `py pyw ipynb`, code-html `html htm`, code-css `css scss less`, code-json `json jsonc`, code-xml `xml xaml plist`, code-yaml `yml yaml toml`, code-shell `ps1 bat cmd sh`, code-c `c h cpp hpp cc cs`, code-java `java kt`, code-go `go`, code-rust `rs`, code-other `rb php swift lua sql r`, image `png jpg jpeg gif bmp webp tif tiff ico heic avif`, image-raw `cr2 nef arw dng raf`, svg `svg`, video `mp4 mkv mov avi webm m4v wmv flv`, audio `mp3 wav flac aac ogg m4a wma`, archive `zip 7z rar tar gz bz2 xz`, executable `exe com bat-free? no — exe com dll sys`, shortcut `lnk url`, installer `msi msix appx`, font `ttf otf woff woff2`, disk-image `iso img vhd vhdx`, database `db sqlite sqlite3 mdb accdb`, ebook `epub mobi azw3`), `backend/winshell.py::known_folders`, `scripts/build_filetypes.py` (argv[1] optional output path), schema v4 + `index_roots` upsert in `scan_directory`, the four routes. Run `py -3 scripts/build_filetypes.py` to generate the JS and add `<script src="src/filetypes.js">` after `api.js` in `index.html`.
- [ ] **Step 4: Run the tests; then the full suite** (`py -3 -m pytest -q`) — all green.
- [ ] **Step 5: Commit** `feat(backend): file-type taxonomy, known folders, peek, index status (Stage 2C Task 1)`.

---

### Task 2: Live tree search and index-search filters (backend)

**Files:**
- Create: `backend/searcher.py`, `tests/test_searcher.py`
- Modify: `backend/api.py` (`GET /fs/search`, `GET /search`), `backend/filetypes.py` (no change expected), `backend/tagger.py` (add `paths_for_tag(conn, tag_name) -> set[str]`)

**Interfaces:**
- Produces:
  ```python
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
      tag_paths: set[str] | None = None     # pre-resolved by the route when tag= is given

  def match_spans(name: str, words: list[str], whole_word: bool) -> list[tuple[int, int]] | None
      # case-insensitive; every word must occur; returns merged [start,end) spans or None

  def search_tree(root: Path, filters: SearchFilters, *, budget_s: float = 4.0, limit: int = 500,
                  clock=time.monotonic) -> dict
      # {"results": [...], "truncated": bool, "elapsed_ms": int, "walked": int}
  ```
  Result item: `{path, name, is_dir, size, modified, created, ext, match: [[s,e],...]}`. Walk with `os.scandir` iteratively (explicit stack, breadth-first so shallow hits come first), skipping `.FilePlusTrash`, `config.is_protected_read(path)` roots, reparse points (`entry.is_symlink()` or `st_file_attributes & FILE_ATTRIBUTE_REPARSE_POINT`), hidden entries unless `hidden`, and any entry whose `stat()` raises. Stop when `limit` results are collected or `clock() - start > budget_s` (then `truncated=True`).
- Route `GET /fs/search` params exactly as §8.4; `root` must be absolute (400 otherwise) and passes `path_guard(mode='read')`; `tag` resolves through `tagger.paths_for_tag` before the thread; the call runs in `asyncio.to_thread`. `limit` capped at 1000.
- `GET /search` (index) accepts the same filter params and adds `indexed_roots: [root,...]` to its response; `q` matching stays `LIKE` but `type/ext/modified/size/hidden` are applied in SQL where possible (`extension`, `modified`, `size` columns exist) and in Python otherwise; when `root='*'` the frontend calls this route.

- [ ] **Step 1: Write failing tests** (`tests/test_searcher.py`), building a tree in `tmp_path`: `a/doc-01.txt`, `a/b/doc-02.md`, `a/.hidden/doc-03.txt`, `img.PNG`, a file with the reparse attribute cannot be created portably — monkeypatch `os.DirEntry.is_symlink`-style via a fake entry for the skip test.
```python
from backend.searcher import match_spans, search_tree, SearchFilters

def test_match_spans_all_words_case_insensitive():
    assert match_spans("Doc-01 Final.TXT", ["doc", "final"], False) == [(0, 3), (7, 12)]
    assert match_spans("Doc-01.txt", ["doc", "zzz"], False) is None
    assert match_spans("readme", [], False) == []

def test_whole_word():
    assert match_spans("my doc.txt", ["doc"], True) == [(3, 6)]
    assert match_spans("mydoc.txt", ["doc"], True) is None

def test_search_tree_finds_nested_and_skips_hidden(tree):
    r = search_tree(tree, SearchFilters(q="doc"))
    names = sorted(x["name"] for x in r["results"])
    assert names == ["doc-01.txt", "doc-02.md"]
    r2 = search_tree(tree, SearchFilters(q="doc", hidden=True))
    assert len(r2["results"]) == 3

def test_type_and_ext_filters(tree):
    assert [x["name"] for x in search_tree(tree, SearchFilters(type="image"))["results"]] == ["img.PNG"]
    assert [x["name"] for x in search_tree(tree, SearchFilters(ext="md"))["results"]] == ["doc-02.md"]
    assert [x["name"] for x in search_tree(tree, SearchFilters(type="folder"))["results"]] == ["a", "b"]

def test_budget_truncates(tree):
    ticks = iter([0.0, 0.0, 10.0, 10.0, 10.0, 10.0])
    r = search_tree(tree, SearchFilters(q=""), budget_s=1.0, clock=lambda: next(ticks))
    assert r["truncated"] is True

def test_limit_truncates(tree):
    r = search_tree(tree, SearchFilters(q=""), limit=2)
    assert len(r["results"]) == 2 and r["truncated"] is True

def test_skips_protected_roots(tree, monkeypatch):
    from backend import searcher
    monkeypatch.setattr(searcher.config, "is_protected_read", lambda p: p.name == "b")
    assert all(x["name"] != "doc-02.md" for x in search_tree(tree, SearchFilters(q="doc"))["results"])
```
Route tests (in the existing API test file): `/fs/search?root=<tree>&q=doc` → 2 results with `match` spans; relative root → 400; `tag=` filter returns only tagged paths (apply a tag via `/files/{id}/tags` first — obtain the id through `/file?path=`); `/search?q=doc&type=document` on an indexed tree returns the txt/md rows and `indexed_roots` lists the root.
- [ ] **Step 2: Run tests, confirm they fail.**
- [ ] **Step 3: Implement** `backend/searcher.py`, `tagger.paths_for_tag`, both routes.
- [ ] **Step 4: Run the full suite** — green.
- [ ] **Step 5: Commit** `feat(backend): live tree search with filters; index search filters (Stage 2C Task 2)`.

---

### Task 3: Properties, attributes, folder type (backend + undo)

**Files:**
- Modify: `backend/winshell.py`, `backend/mover.py`, `backend/api.py`, `requirements.txt` (add `pywin32`), `tests/test_winshell.py`, `tests/test_undo_dbops.py` (or a new `tests/test_properties.py`)

**Interfaces:**
- Produces in `backend/winshell.py` (Windows via ctypes; on non-Windows every function returns the documented fallback so tests run anywhere):
  ```python
  FILE_ATTRIBUTE_READONLY = 0x1; FILE_ATTRIBUTE_HIDDEN = 0x2; FILE_ATTRIBUTE_SYSTEM = 0x4; FILE_ATTRIBUTE_ARCHIVE = 0x20
  def get_attributes(path: Path) -> dict      # {"bits": int, "read_only": bool, "hidden": bool, "archive": bool, "system": bool}; fallback from st_mode/name
  def set_attributes(path: Path, bits: int) -> None   # SetFileAttributesW; raises OSError; fallback: chmod read-only bit only
  def size_on_disk(path: Path) -> int         # GetCompressedFileSizeW rounded up to cluster (GetDiskFreeSpaceW); folders: sum over files (budgeted with contains_counts); fallback: st_size rounded to 4096
  def assoc(ext: str) -> dict                 # {"type_description": str, "opens_with": str|None, "opens_with_exe": str|None} via AssocQueryStringW (ASSOCSTR_FRIENDLYDOCNAME=4, ASSOCSTR_FRIENDLYAPPNAME=3, ASSOCSTR_EXECUTABLE=2); fallback: f"{EXT.upper()} File"
  def contains_counts(path: Path, budget_s: float = 3.0, clock=time.monotonic) -> dict  # {"files": n, "folders": n, "bytes": n, "truncated": bool}
  def read_folder_type(path: Path) -> str | None   # desktop.ini [ViewState] FolderType → 'Generic'|'Documents'|'Pictures'|'Videos'|'Music', None when absent
  def detect_folder_type(names: list[tuple[str, bool]]) -> str   # majority rule over files by filetypes group: image→Pictures, video→Videos, audio→Music, document/code→Documents, else Generic
  def write_folder_type(path: Path, folder_type: str) -> bytes | None   # returns previous desktop.ini bytes (None if absent); merges [ViewState] FolderType; sets hidden+system on the ini; sets read-only on the folder (PathMakeSystemFolder equivalent: FILE_ATTRIBUTE_READONLY)
  def restore_desktop_ini(path: Path, previous: bytes | None) -> None   # writes previous bytes back or removes the ini and clears the folder read-only bit
  def property_details(path: Path) -> list[dict]   # [{"group": str, "name": str, "value": str}] via pywin32 propsys; raises RuntimeError("pywin32 not installed") if import fails
  ```
  `property_details` implementation sketch:
  ```python
  from win32com.propsys import propsys, pscon
  store = propsys.SHGetPropertyStoreFromParsingName(str(path))
  for i in range(store.GetCount()):
      key = store.GetAt(i)
      try:
          name = propsys.PSGetNameFromPropertyKey(key)
      except Exception:
          continue
      val = store.GetValue(key).ToString() if hasattr(store.GetValue(key), 'ToString') else str(store.GetValue(key).GetValue())
      if val in ("", None): continue
      group = _GROUP_BY_PREFIX.get(name.split(".")[1] if name.startswith("System.") else "", "General")  # Video/Audio/Image/Media/Document/Photo → those; else General
      out.append({"group": group, "name": name.replace("System.", "").split(".")[-1], "value": val})
  ```
  (Adjust to the real pywin32 API surface while implementing; the test only asserts shape and the 503 path.)
- Mutations in `backend/mover.py` (both follow `_perform`'s guard → log → act → mark, with `batch_id`):
  ```python
  async def set_attributes(conn, path: Path, *, read_only: bool | None, hidden: bool | None, archive: bool | None, batch_id: str) -> dict
      # op_type 'attr-set', source_path=path, reason=json.dumps({"before": bits, "after": bits})
  async def set_folder_type(conn, path: Path, folder_type: str, batch_id: str) -> dict
      # op_type 'folder-type-set', source_path=path, reason=json.dumps({"before_ini": base64|None, "after": folder_type})
  ```
  Undo in `undo_operation`: `attr-set` → new `attr-set` op with before/after swapped, `undo_of` set; `folder-type-set` → new `folder-type-set` op that restores `before_ini` (reason records the current ini as its own `before_ini` so redo works). Unknown op types keep raising `RefusedError`.
- Routes:
  - `GET /fs/properties?path=` → `{path, name, is_dir, type_description, opens_with, opens_with_exe, location, size, size_on_disk, contains: {files, folders, truncated} | null, created, modified, accessed, attributes: {...}, folder_type: str|null, folder_type_detected: str|null}`; `path_guard` read; 404 when missing.
  - `GET /fs/properties/details?path=` → `{details: [...]}`; 503 `{detail: "pywin32 not installed"}` on RuntimeError.
  - `POST /fs/attributes {path, read_only?, hidden?, archive?}` → `{batch_id, op}`; `POST /fs/folder-type {path, type}` → `{batch_id, op}`; `type` validated against the five values (422 otherwise).

- [ ] **Step 1: Write failing tests**: `get_attributes`/`set_attributes` round-trip on a tmp file (skip set on non-Windows); `size_on_disk >= size`; `assoc("txt")["type_description"]` non-empty; `contains_counts` on a 3-file/1-folder tree and a budget-truncation case with a fake clock; `detect_folder_type` majority cases (3 png + 1 txt → Pictures; 2 txt + 1 png → Documents; empty → Generic); `write_folder_type` then `read_folder_type` → 'Pictures', previous bytes returned, `restore_desktop_ini(previous=None)` removes the ini; route tests: `/fs/properties` on a sandbox file has all keys and `contains is None`; on a folder `contains.files == n`; `POST /fs/attributes` sets read-only, ops log has `attr-set` executed, `POST /operations/{id}/undo` clears it and inserts the inverse; same for `/fs/folder-type` (undo removes the ini); `/fs/properties/details` returns 200 list or 503 with the exact detail; writes outside the sandbox → 403.
- [ ] **Step 2: Run tests, confirm failures.**
- [ ] **Step 3: Implement** winshell helpers, mover mutations + inverses, routes; `pip install pywin32` and add `pywin32>=306; sys_platform == 'win32'` to `requirements.txt`.
- [ ] **Step 4: Full suite green.**
- [ ] **Step 5: Commit** `feat(backend): properties, attributes and folder-type ops with undo (Stage 2C Task 3)`.

---

### Task 4: Bridge — icons, thumbnails, shell dialogs (Electron main + preload)

**Files:**
- Create: `frontend/iconCache.js`, `frontend/native/show-properties.ps1`, `frontend/test/icon-cache.spec.js`
- Modify: `frontend/main.js`, `frontend/preload.js`

**Interfaces:**
- Produces `frontend/iconCache.js` (CommonJS, no Electron imports, unit-tested):
  ```js
  class LruCache { constructor(max) ; get(key) ; set(key, value) ; delete(key) ; get size() }
  function iconCacheKey(path, ext, size)   // per-path for ext in {exe, lnk, url, ico, cpl, scr}; otherwise `ext:${ext}:${size}`
  function isSafeLocalPath(p)              // absolute Windows drive path (`^[A-Za-z]:\\`), no `..` component, no `\\?\`, not UNC, length < 32767
  module.exports = { LruCache, iconCacheKey, isSafeLocalPath };
  ```
- Bridge methods (preload → ipc → main):
  - `fileIcon(path, ext, size /* 16|20|32|48 */) → Promise<string|null>` data URL via `app.getFileIcon(path, {size: size >= 32 ? 'large' : 'normal'})`, resized with `nativeImage.resize`, LRU 300 by `iconCacheKey`. Returns null on error.
  - `thumbnail(path, size /* 48…256 */, mtime) → Promise<string|null>` via `nativeImage.createThumbnailFromPath(path, {width: size, height: size})`, LRU 500 keyed `${path}|${mtime}|${size}`. Returns null on error. Concurrency capped at 4 in flight (simple queue) so a grid of 500 tiles does not spawn 500 shell calls.
  - `showProperties(path) → Promise<boolean>`: `isSafeLocalPath` else false; spawns `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <app>/native/show-properties.ps1 -Path <path>` detached; returns true when spawned.
  - `openWithDialog(path) → Promise<boolean>`: `isSafeLocalPath` else false; spawns `rundll32.exe shell32.dll,OpenAs_RunDLL <path>`.
- `show-properties.ps1`:
  ```powershell
  param([Parameter(Mandatory=$true)][string]$Path)
  $item = Get-Item -LiteralPath $Path -Force
  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.Namespace($item.DirectoryName ?? $item.Parent.FullName)
  if ($item.PSIsContainer) { $folder = $shell.Namespace((Split-Path -LiteralPath $Path -Parent)) }
  $target = $folder.ParseName($item.Name)
  $target.InvokeVerb("Properties")
  # The dialog lives in this process: wait until its window is gone.
  Add-Type -AssemblyName System.Windows.Forms
  $title = "$($item.Name) Properties"
  $deadline = (Get-Date).AddMinutes(30)
  do { Start-Sleep -Milliseconds 400; $open = Get-Process -Id $PID | Select-Object -ExpandProperty MainWindowTitle } while ((Get-Date) -lt $deadline -and (Get-Process | Where-Object { $_.MainWindowTitle -eq $title }))
  ```
  (Windows PowerShell 5.1 has no `??`; write it as an `if`. Verify manually that the dialog stays open and the process exits after it is closed.)

- [ ] **Step 1: Write failing unit tests** (`frontend/test/icon-cache.spec.js`, `@playwright/test` `test()` like `env-token.spec.js`): LRU evicts the oldest at capacity and refreshes on `get`; `iconCacheKey` is per-path for `.exe`/`.lnk` and per-ext for `.txt`; `isSafeLocalPath` accepts `C:\Users\x\a.txt`, rejects `\\server\share\a`, `C:\a\..\b`, `\\?\C:\a`, `relative\a`, and a 40 000-char string.
- [ ] **Step 2: Run** `npx playwright test test/icon-cache.spec.js` from `frontend/` — fails.
- [ ] **Step 3: Implement** the module, the ipc handlers in `main.js` (with the in-flight queue), the preload methods, and the script. Manually verify with a throwaway node script or the running app that `fileIcon('C:\\Windows\\notepad.exe','exe',32)` returns a PNG data URL and `thumbnail(<a _gen png>, 96, mtime)` returns one.
- [ ] **Step 4: Verify gate green** (JS count grows).
- [ ] **Step 5: Commit** `feat(bridge): file icons, shell thumbnails, native properties/open-with dialogs (Stage 2C Task 4)`.

---

### Task 5: Icon sprite, chrome icons, icon gate

**Files:**
- Create: `scripts/build_icons.js`, `scripts/check_icons.js`, `frontend/assets/icons/filetypes/` (SVG sources, Task 6 fills), `frontend/src/icons-sprite.js` (generated), `frontend/src/icons.js`
- Modify: `frontend/package.json` (devDependency `@fluentui/svg-icons`), `frontend/index.html`, every `frontend/src/*.js` that contains inline SVG, `frontend/src/styles.css`, `scripts/verify.ps1`

**Interfaces:**
- `scripts/build_icons.js` reads `CHROME_ICONS` (a map `fpName → fluent file name`, e.g. `home → ic_fluent_home_20_regular.svg`, `desktop → ic_fluent_desktop_20_regular.svg`, `download → ic_fluent_arrow_download_20_regular.svg`, `screenshots → ic_fluent_image_multiple_20_regular.svg`, `folder → ic_fluent_folder_20_regular.svg`, `folder-open → ic_fluent_folder_open_20_regular.svg`, `pin → ic_fluent_pin_20_regular.svg`, `drive → ic_fluent_hard_drive_20_regular.svg`, `scan → ic_fluent_document_search_20_regular.svg`, `review-bin → ic_fluent_tray_item_remove_20_regular.svg` (or `mail_inbox_20`), `everything → ic_fluent_folder_link_20_regular.svg`, `settings → ic_fluent_settings_20_regular.svg`, `sparkle → ic_fluent_sparkle_20_regular.svg`, `arrow-left/right/up`, `refresh → ic_fluent_arrow_sync_20_regular.svg`, `view-grid → ic_fluent_grid_20_regular.svg`, `view-list → ic_fluent_text_bullet_list_ltr_20_regular.svg`, `sort → ic_fluent_arrow_sort_20_regular.svg`, `inspector → ic_fluent_panel_right_20_regular.svg`, `theme-dark → ic_fluent_weather_moon_20_regular.svg`, `theme-light → ic_fluent_weather_sunny_20_regular.svg`, `search`, `open → ic_fluent_open_20_regular.svg`, `reveal → ic_fluent_folder_arrow_right_20_regular.svg`, `star`, `star-off`, `tag`, `copy`, `cut`, `paste → ic_fluent_clipboard_paste_20_regular.svg`, `rename`, `delete`, `info`, `chevron-down/right`, `close → ic_fluent_dismiss_20_regular.svg`, `add`, `check`, `warning`, `error`, `history`, `filter`, `more → ic_fluent_more_horizontal_20_regular.svg`, `undo`, `redo`, `new-tab → ic_fluent_tab_add_20_regular.svg`, `file → ic_fluent_document_20_regular.svg`) from `frontend/node_modules/@fluentui/svg-icons/icons/`, strips `width/height/fill`, sets `fill="currentColor"`, and emits `<symbol id="fp-<name>" viewBox="0 0 20 20">…</symbol>`. It also inlines every `frontend/assets/icons/filetypes/<family>.svg` as `<symbol id="fp-ft-<family>" viewBox="0 0 20 20">`. Output: `frontend/src/icons-sprite.js` containing `const FP_ICON_SPRITE = "<svg xmlns=… style='display:none'>…</svg>";`. The script fails if a mapped Fluent file is missing.
- `frontend/src/icons.js`:
  ```js
  function fpInstallSprite()                         // inserts FP_ICON_SPRITE once at the top of <body>
  function icon(name, cls = '')                      // returns '<svg class="fp-icon ' + cls + '" aria-hidden="true"><use href="#fp-' + name + '"></use></svg>'
  function iconFor(entry, size = 16)                 // entry {name, is_dir, ext, path, modified}; returns markup honouring window.__fpConfig['ui.icon_source'] (Task 6 adds the Windows path; here always the sprite family icon; folders 'fp-folder')
  ```
  CSS: `.fp-icon { width: 1em; height: 1em; display: inline-block; vertical-align: -0.15em; fill: currentColor; flex: none }` and size modifiers `.fp-icon--16/20/24`.
- `scripts/check_icons.js` (exit 1 with a list on failure): (1) `grep` `frontend/index.html` and `frontend/src/*.js` except `icons-sprite.js` for `<svg` — allowed only when the tag contains `class="fp-icon` (the `<use>` wrapper); (2) every `#fp-…` / `icon('…')` reference resolves to a symbol in the sprite; (3) every family in `frontend/src/filetypes.js` has `fp-ft-<family>` (this check is enabled in Task 6; in Task 5 it warns).
- `verify.ps1` gains `node scripts/check_icons.js` in the frontend-gates stage.

- [ ] **Step 1:** `cd frontend && npm i -D @fluentui/svg-icons` (pin the version in package.json); write `build_icons.js` and generate the sprite; write `check_icons.js` and run it — it must FAIL now listing every inline `<svg` in `index.html`/JS.
- [ ] **Step 2:** Replace every inline SVG in `index.html` (sidebar, toolbar, tabs, inspector, modals, palette, settings, empty states) and in `browser.js`/`home.js`/`inspector.js`/`app.js` (`ICON_*` constants, `HOME_ICON_*`, `renderDriveItem`, context-menu icons) with `icon('<name>')` / `<svg class="fp-icon"><use href="#fp-…">`. The listed replacements (drives, scan, review bin, generic file in browser + inspector, reveal) use the new Fluent names. Load `icons-sprite.js` then `icons.js` right after `filetypes.js`; call `fpInstallSprite()` first thing in `DOMContentLoaded`.
- [ ] **Step 3:** `node scripts/check_icons.js` → ok; verify gate green (screenshots show the new chrome icons); spot-check `home.png`, `browser.png`, `settings.png`.
- [ ] **Step 4: Commit** `feat(icons): Fluent chrome icon sprite, icon() helper, icon gate (Stage 2C Task 5)`.

---

### Task 6: File-type icon family, Windows icon mode, thumbnails, folder previews

**Files:**
- Create: `frontend/assets/icons/filetypes/*.svg` (one per family in `FAMILIES` + `folder`, `folder-open`, `folder-desktop`, `folder-downloads`, `folder-documents`, `folder-pictures`, `folder-videos`, `folder-music`, `folder-screenshots`)
- Modify: `frontend/src/icons.js`, `frontend/src/browser.js` (`renderFsRow`, grid tiles), `frontend/src/inspector.js` (header icon), `frontend/src/home.js` (`homeIconFor`), `frontend/src/settings.js` + `index.html` (Personalization: "File icons: FilePlus / Windows"), `frontend/src/app.js` (dispatch `settings-set-icon-source`), `scripts/check_icons.js` (enable family check), `frontend/src/styles.css`

**Interfaces:**
- Family SVG construction rules (all on a 20×20 grid, `viewBox="0 0 20 20"`): document families share the silhouette `M5 2h7l4 4v12H5z` (page) with a folded corner `M12 2v4h4` at 1.5 px stroke `currentColor` at 70 % opacity, a 3 px-tall coloured tab across the bottom `y=14…17` using a family colour (`--ft-<family>` token defined in `styles.css` for both themes: text `#8A8F98`, markdown `#6C8EBF`, pdf `#E5484D`, word `#2B579A`, excel `#217346`, powerpoint `#D24726`, csv `#3E9C6A`, code-* `#7C5CFF` with per-language variant colours js `#E8C547`, ts `#3178C6`, py `#3776AB`, html `#E44D26`, css `#264DE4`, json `#8B8B8B`, xml `#0060AC`, yaml `#CB171E`, shell `#4EAA25`, c `#5C6BC0`, java `#B07219`, go `#00ADD8`, rust `#DEA584`, other `#7C5CFF`; image `#3FA7D6`, image-raw `#2F7FA6`, svg `#FFB13B`, video `#A259FF`, audio `#FF7A59`, archive `#B08968`, executable `#4C8BF5`, shortcut `#4C8BF5`, installer `#4C8BF5`, font `#5B5F97`, disk-image `#6B7280`, database `#0E7C7B`, ebook `#9C6644`, generic `#8A8F98`) and a 1-to-3-letter glyph or simple pictogram inside (e.g. `TXT`, `MD`, `PDF`, `W`, `X`, `P`, `{}` for json, `<>` for html/xml, a play triangle for video, a note for audio, a zip line for archive, a gear for executable, an arrow-in-box for shortcut). Folders: Fluent `folder_20_filled` silhouette in `--ft-folder` (`#F2C94C` dark / `#E8B923` light) with a small white glyph for the special variants. Each family file is hand-authored with `<path>` elements only (no text elements — glyph letters are drawn as paths or omitted in favour of a pictogram; the extension badge for unknown types is rendered by `iconFor` as a `<text>` overlay, not in the sprite).
- `iconFor(entry, size)` (final form):
  ```js
  function iconFor(entry, size = 16) {
    const src = (window.__fpConfig && window.__fpConfig['ui.icon_source']) || 'fileplus';
    if (entry.is_dir) return src === 'windows' ? _winIcon(entry, size, 'fp-folder') : icon(_folderSymbol(entry), 'fp-icon--' + size);
    const fam = fpFamilyFor(entry.ext);
    if (src === 'windows') return _winIcon(entry, size, 'fp-ft-' + fam);
    if (fam === 'generic' && entry.ext) return icon('ft-generic', 'fp-icon--' + size) + '<span class="fp-ext-badge">' + escapeHtml(entry.ext.slice(0, 3).toUpperCase()) + '</span>';
    return icon('ft-' + fam, 'fp-icon--' + size);
  }
  // _winIcon returns '<img class="fp-icon fp-icon--win fp-icon--N" data-win-icon="<path>|<ext>|<size>" alt="">' with the sprite symbol as a CSS background fallback; a MutationObserver/IntersectionObserver in icons.js resolves data-win-icon through electronAPI.fileIcon and sets src (cached in a Map per key).
  function fpRequestThumbnail(imgEl, path, size, mtime)  // IntersectionObserver-driven; sets src on success, adds .fp-thumb--failed on null; cancels when the tile leaves the viewport (observer.unobserve)
  ```
- Grid tiles (`#list-scroll[data-view="grid"]`): media files render `<img class="fp-thumb" data-thumb="…">` at the tile size (Task 9 sets the size from `--list-scale`); folders in `fileplus` mode render the folder symbol plus up to two fanned `fp-thumb--mini` images from `GET /fs/peek?path&n=2`; in `windows` mode folders request `thumbnail(path)` directly. List rows show family icons; image rows show a 16 px thumbnail (`fpRequestThumbnail` at 16).
- Setting: Personalization gains "File icons" segmented `FilePlus | Windows` → `saveSetting('ui.icon_source', v)` → re-render the current listing, inspector and Home.

- [ ] **Step 1:** Author the family SVGs (one file each, ≤ 1 KB, paths only) and the folder variants; rebuild the sprite; enable the family check in `check_icons.js` and run it — must pass.
- [ ] **Step 2:** Implement `iconFor`, `_winIcon`, `fpRequestThumbnail`, the peek-based folder previews, the setting, and swap every icon call site (`renderFsRow`, inspector header/meta, Home rows, palette results) to `iconFor`.
- [ ] **Step 3:** Smoke additions: grid view of `_gen\Pictures` shows ≥ 1 `img.fp-thumb[src^="data:"]` within 3 s; switching `ui.icon_source` to `windows` makes rows carry `img.fp-icon--win[src^="data:"]`; back to `fileplus` restores `<use href="#fp-ft-…">`. Screenshot `browser-grid.png`.
- [ ] **Step 4:** Verify gate green; commit `feat(icons): FilePlus file-type icon family, Windows icon mode, shell thumbnails, folder previews (Stage 2C Task 6)`.

---

### Task 7: Tabs model, drive labels, sidebar highlight, tab styling

**Files:**
- Modify: `frontend/src/app.js`, `frontend/src/browser.js`, `frontend/index.html`, `frontend/src/styles.css`, `frontend/test/smoke.spec.js`

**Interfaces:**
- Produces in `app.js`:
  ```js
  const tabs = { list: [], activeId: null };            // records: {id, screen, label, path, history: [], historyIndex: -1, view: null, scrollTop: 0, selection: []}
  function activeTab()                                  // record
  function createTab({screen = 'home', path = null, history = [], historyIndex = -1, label = 'Home'} = {}) // returns record, renders element, does NOT activate
  function activateTab(id)                              // saves outgoing (browserState → record), restores incoming (loadDirectory(record.path, {restore: record}) when screen === 'browser'), updates sidebar synchronously
  function closeTabById(id)                             // last tab: creates a fresh Home tab instead of quitting; pushes to closed stack
  function duplicateTab(id) ; function closeOtherTabs(id) ; function reopenLastTab()
  function tabLabelFor(path)                            // 'This PC' for null/root listing, 'D:' for a drive root, basename otherwise, 'Home' for home
  function driveDisplayLabel(letter)                    // 'Seagate Barracuda 4tb HDD (D:)' from the cached /drives list; letter alone when unknown
  ```
  `navHistory` is removed as a global; `browser.js` navigation (`navBack/navForward/navUp/loadDirectory`) reads and writes `activeTab().history/historyIndex` through two small accessors exported by `app.js`? No — `app.js` loads last. Rule: `browser.js` defines `const nav = { history: [], index: -1 }` and `app.js` swaps `nav.history/nav.index` on tab activation (assigning the record's arrays by reference). `loadDirectory(path, opts)` gains `opts.restore` (scrollTop + selection paths) and calls `onNavigated(path)` (defined in `app.js`, invoked only from inside functions) to update label, sidebar and breadcrumb synchronously before the fetch.
- Tab element: `<div class="fp-tab" data-tab-id role="tab">` with `.fp-tab__icon` (`icon('home')` / `icon('folder')` / `icon('drive')`), `.fp-tab__label`, `<span role="button" class="fp-tab__close">`. Middle-click (`auxclick` button 1) closes. Tab menu items: `cm-new-tab, cm-duplicate-tab, 'sep', cm-close-tab, cm-close-other-tabs` (pin/rename removed).
- CSS: `.fp-tab { background: var(--bg-raised); border: 1px solid transparent }`, `.fp-tab:hover { background: var(--bg-pressed) }`, `.fp-tab--active { background: var(--bg-content); border-color: var(--border-hairline); box-shadow: inset 0 -2px 0 var(--accent) }` — verify contrast of inactive label ≥ 4.5:1 with `scripts/contrast_check.py` (add the pair).
- Breadcrumb: first crumb of a drive path renders `driveDisplayLabel(letter)`; the listing request no longer rewrites the label afterwards (§3.2). Sidebar: `updateSidebarActive(pathOrScreen)` is called from `onNavigated` and from `activateTab`; `data-manual-active` removed (§3.3).

- [ ] **Step 1: Smoke tests first** (append to `smoke.spec.js`, they fail now): open `_gen\Documents` in tab 1; Ctrl+T → new tab shows Home and the tab strip has 2 tabs; navigate tab 2 to `_gen\Pictures`; click tab 1 → breadcrumb ends with `Documents` and `.fp-row` count matches the earlier count; middle-click tab 2 → one tab remains; Ctrl+Shift+T → tab 2 returns at `Pictures`; navigate to the sandbox root listing → tab label `This PC`; the tab menu has no "Pin tab"/"Rename tab" items; `check_menu_cases` still passes.
- [ ] **Step 2: Implement** the tab model, navigation accessors, labels, sidebar sync, CSS. Remove `syncActiveTabPath`, `data-manual-active`, and the old `navHistory` global; `openBrowserAt(path, label)` becomes `openBrowserAt(path, {tab} = {})`.
- [ ] **Step 3:** Verify gate green (all existing smoke steps still pass — the e2e rename+undo runs inside tab 1).
- [ ] **Step 4: Commit** `feat(tabs): per-tab browser state, duplicate/close-others, drive labels without flash, sidebar single source of truth (Stage 2C Task 7)`.

---

### Task 8: Inspector switch and geometry, deselect anywhere, refresh, theme toggle, density

**Files:**
- Modify: `frontend/src/inspector.js`, `frontend/src/browser.js`, `frontend/src/home.js`, `frontend/src/app.js`, `frontend/src/settings.js`, `frontend/index.html`, `frontend/src/styles.css`, `frontend/test/smoke.spec.js`

**Interfaces:**
- `inspector.js`: `setInspectorOpen(open, {persist = true})` is the only writer of `.inspector--open`; `toggleInspector()` calls it with the negation and `saveSetting('ui.inspector_open', open)`. `updateInspector('none')` renders the empty state (`#inspector-filename` = "No file selected", meta rows show "—", preview shows the `file` icon at 40 % opacity, Tags/History panes show "Select a file"), never touching `.inspector--open`. `onSelectionChanged` keeps its debounce but only calls `updateInspector`.
- Geometry: `.inspector__header { height: 56px }`, `.inspector__preview { aspect-ratio: 16/10; width: 100% }`, `.inspector__meta { display: grid; grid-template-rows: repeat(6, 24px) }`, `.inspector__body { min-height: 0; flex: 1; overflow: auto }`, tabs container fixed height, panes toggled with the `hidden` attribute inside a container with `min-height: 160px`. Filename `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
- Deselect anywhere: in `app.js` `document.getElementById('app').addEventListener('mousedown', handler, true)` with the selector list from §3.5; the handler calls `clearSelection()` (browser) and `homeClearSelection()` (home) when the active screen is Browser/Home respectively and the target is not interactive. `contextmenu` on non-interactive space does the same before the empty-area menu opens.
- Refresh: toolbar button `<button data-action="refresh-directory" title="Refresh (F5)">` right after `#breadcrumb`; `refreshDirectory()` gains `{keepSelection: true, keepScroll: true}` behaviour (re-select by path, restore `scrollTop`) and toggles `.is-spinning` on the button while in flight (`@keyframes fp-spin`, respects `prefers-reduced-motion`). F5 calls the same.
- Theme: `toggleTheme()` → `applyTheme(resolveTheme(current) === 'dark' ? 'light' : 'dark')` + `saveSetting('ui.theme', …)`; the toolbar button icon swaps `theme-dark`/`theme-light` with the resolved theme.
- Density: add `[data-density="spacious"] .fp-row { height: 40px }` and the matching Home row rule.

- [ ] **Step 1: Smoke tests first**: with `ui.inspector_open=false` (set via `POST /config` in the test) click a row → inspector has no `.inspector--open`; set true → click blank sidebar space (`#sidebar` padding area, use `page.mouse.click` at a coordinate inside the sidebar but below the last item) → selection count 0 and `#inspector-filename` text `No file selected`; measure `boundingBox()` of `.inspector__header`, `.inspector__preview`, `.inspector__meta` in empty and single-file states — identical; click the refresh button → `.is-spinning` appears then disappears and the selected row stays selected; theme toggle from dark once → `html[data-theme="light"]`, once more → dark.
- [ ] **Step 2: Implement.** Remove the `fp:inspector-toggle` event if unused after the change.
- [ ] **Step 3:** Verify gate green; screenshots `inspector-empty.png`, `inspector-file.png`.
- [ ] **Step 4: Commit** `fix(shell): inspector switch + fixed geometry, deselect anywhere, refresh button, one-click theme toggle, spacious density (Stage 2C Task 8)`.

---

### Task 9: This PC, Quick Access defaults, Backspace setting

**Files:**
- Modify: `frontend/index.html` (sidebar), `frontend/src/app.js`, `frontend/src/settings.js`, `frontend/src/browser.js`, `frontend/src/styles.css`, `frontend/test/smoke.spec.js`

**Interfaces:**
- Sidebar section markup:
  ```html
  <div class="fp-sidebar__section" id="sb-thispc">
    <div class="fp-sidebar__section-head" role="button" tabindex="0" data-action="thispc-open">
      <button class="fp-sidebar__chevron" data-action="thispc-toggle" aria-label="Collapse This PC" aria-expanded="true">…icon('chevron-down')…</button>
      <span class="fp-sidebar__section-label">This PC</span>
    </div>
    <div class="fp-sidebar__section-body" id="sb-drives"></div>
  </div>
  ```
  `thispc-toggle` flips `aria-expanded`, hides `#sb-drives` (`hidden`), rotates the chevron, saves `ui.sidebar_thispc_open`. `thispc-open` → `openBrowserAt(null)` (the drives listing) with tab label "This PC".
- Quick Access: at init `API.get('/known-folders')` → render items for `desktop, downloads, screenshots` (plus Home) unless their id is in `ui.quick_access_hidden`; each item `data-path`, `data-known-id`, icon `desktop`/`download`/`screenshots`; sidebar-item menu gains `cm-quick-access-remove` (enabled only for known items) which appends the id to `ui.quick_access_hidden` and re-renders; Settings › Personalization gains "Quick Access" with a checkbox per known folder (`settings-quick-access-toggle`, `data-known-id`) that removes/re-adds the id. The old `#nav-downloads` static entry is replaced by the rendered list.
- Backspace: Personalization › Keyboard: "Backspace deletes selected items (otherwise goes up a folder)" checkbox → `ui.backspace_deletes`; `browserKeydown` Backspace branch reads `window.__fpConfig['ui.backspace_deletes']` and calls `fileops.trashSelection()` when true and something is selected (no selection → no-op), else `navUp()`.

- [ ] **Step 1: Smoke first**: sidebar contains "This PC" and no "Tree"; clicking the chevron hides `#sb-drives` and `/config` holds `ui.sidebar_thispc_open=false`; Quick Access shows Desktop and Downloads items with absolute `data-path`; `settings-quick-access-toggle` for `desktop` off → item disappears → on → returns; with `ui.backspace_deletes=true`, select `doc-01.txt` and press Backspace → the row disappears and `GET /operations?limit=1` shows `trash`; Ctrl+Z restores it.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** Verify green; commit `feat(sidebar): This PC section, Quick Access known folders with removal, Backspace-deletes setting (Stage 2C Task 9)`.

---

### Task 10: List scale, View and Sort menus, List view, Dynamic media view

**Files:**
- Modify: `frontend/src/browser.js`, `frontend/src/app.js`, `frontend/src/settings.js`, `frontend/index.html`, `frontend/src/styles.css`, `frontend/main.js` (Ctrl+wheel no longer zooms), `frontend/test/smoke.spec.js`

**Interfaces:**
- `--list-scale` on `#list-scroll` (`style.setProperty`); `LIST_SCALE_STEPS = [0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.75, 2]`; `setListScale(v)` persists `ui.list_scale`. CSS derives: list row height `calc(var(--row-height) * var(--list-scale))`, row icon `calc(16px * var(--list-scale))`, row font `calc(var(--fs-13) * var(--list-scale))`; grid tile `calc(120px * var(--list-scale))`, thumb `calc(96px * var(--list-scale))`. The Ctrl+wheel handler in `app.js` (currently zoom) now: if the event target is inside `#list-scroll` → step `--list-scale`; else → ignore (application zoom stays on Ctrl+=/−/0 only). Remove the `webContents` zoom-on-wheel path if any in `main.js`.
- View modes: `browserState.view ∈ {details, list, grid}`; `setViewMode(mode, {manual})`; `details` = current columns; `list` = `#list-head` hidden, rows show icon + name only, container `column-count`-free single column (Explorer's "List" flows in columns; ours is single-column name-only rows — state that in the menu label as "List"); `grid` as today. `ui.view_mode` persists the user default; grid presets set `ui.list_scale` to `0.75 (Small) / 1 (Medium) / 1.5 (Large) / 2 (Extra large)` and `ui.view_mode='grid'`.
- View menu (`data-action="open-view-menu"`, toolbar) items: `view-xl, view-large, view-medium, view-small, 'sep', view-list, view-details, 'sep', toggle-show-hidden, toggle-show-extensions, toggle-dynamic-media` with `checked(ctx)` predicates rendered as a leading check icon; Sort menu (`open-sort-menu`): `sort-name, sort-modified, sort-type, sort-size, 'sep', sort-asc, sort-desc` (radio checks). `showContextMenu(x, y, items, {anchor})` gains `checked` support (Task 11 adds `enabled`); menus open below the button.
- `ui.sort` replaces `sessionStorage['fp-sort']`; `applySort` sorts by `type` using `fpFamilyFor(ext)` then name.
- Dynamic media view: in `loadDirectory` after entries arrive: `if (cfg['ui.dynamic_media_view'] !== false && !manualViewByPath.get(path))` → `mediaShare = files.filter(fpIsMedia).length / files.length` (files = non-dir, non-hidden; 0 when no files) → `setViewMode(mediaShare > 0.5 ? 'grid' : cfg['ui.view_mode'] || 'details', {manual: false})` and if grid was chosen automatically use scale 1 for this listing without persisting. `setViewMode(mode, {manual: true})` (menu/toggle) records `manualViewByPath.set(path, mode)` for the session.
- The toolbar `#view-toggle` segmented control is replaced by the View button; `cm-view-list/grid` context items map to `view-details/view-medium`.

- [ ] **Step 1: Smoke first**: open `_gen\Pictures` → `#list-scroll[data-view="grid"]`; open `_gen\Documents` → `data-view="details"`; open the View menu → click "List" → `data-view="list"` and `#list-head` hidden; back to Pictures → still grid; Sort menu → "Size" + "Descending" → first row is the largest file (compare `GET /fs/list` sizes); Ctrl+wheel over the list changes `--list-scale` and `electronAPI.getZoom()` is unchanged; `/config` holds `ui.list_scale`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** Verify green; commit `feat(views): explorer-only Ctrl+wheel scale, View and Sort menus, List view, dynamic media view (Stage 2C Task 10)`.

---

### Task 11: Selection visuals, context-menu applicability, favorites feedback

**Files:**
- Modify: `frontend/src/styles.css`, `frontend/src/browser.js`, `frontend/src/home.js`, `frontend/src/app.js`, `frontend/test/smoke.spec.js`

**Interfaces:**
- CSS (§4.1): `.list-scroll { padding-left: 0 }`; `.fp-row--selected::before { left: 0 }`; merging: `.fp-row--selected + .fp-row--selected { border-top-color: transparent; border-top-left-radius: 0; border-top-right-radius: 0 }` and `.fp-row--selected:has(+ .fp-row--selected) { border-bottom-left-radius: 0; border-bottom-right-radius: 0 }` (Chromium 41-era Electron supports `:has`); the accent bar spans because each row's bar meets the next with no gap (`top: 0; bottom: 0` on `::before`). Grid: `[data-view="grid"] .fp-row--selected::before { left: 0; right: 0; top: auto; bottom: 0; height: 2px; width: auto }` shown only when `#list-scroll[data-selection-count="1"]`; `browser.js` sets `data-selection-count` on `#list-scroll` in `onSelectionChanged`.
- Menu applicability: `CONTEXT_MENUS` items accept `enabled(ctx)`; `buildMenuContext(target)` returns `{ selection: browserState entries for the selection (or the Home row), target, favoritesSet, clipboard: fileops.clipboardCount() }`; `showContextMenu` renders `aria-disabled="true"` + class `fp-context-menu__item--disabled` and ignores clicks. Rules exactly as §4.2. `cm-open` with a same-extension multi-selection opens each via `electronAPI.openPath` (cap 20; above 10 → `openModal('warn', {title: 'Open 14 files?', confirmLabel: 'Open'})`).
- Favorites: `favoritesSet` (Set of lowercase paths) lives in `home.js` and is loaded at init (`loadFavorites()` already fetches — expose `favoritesHas(path)` and `favoritesReload()`); `renderFsRow` appends `<span class="fp-row__star" title="In Favorites">' + icon('star') + '</span>` when `favoritesHas(path)`; the file/folder menu item `cm-favorite` gets `label(ctx)` → "Add to Favorites"/"Remove from Favorites" and the handler adds or deletes (`DELETE /favorites/{id}` — look up the id from the loaded favorites list) then re-renders the row and Home.

- [ ] **Step 1: Smoke first**: select `doc-00.txt` and `doc-01.txt` (click, shift-click) → both `.fp-row--selected` and the second has `border-top-color` transparent; right-click with both selected → "Open" enabled (same ext), "Rename" and "Properties" `aria-disabled`; select `doc-00.txt` + a `.md` file → "Open" disabled; right-click `doc-00.txt` → "Add to Favorites" → row shows `.fp-row__star`; right-click again → label "Remove from Favorites" → click → star gone and `GET /favorites` no longer lists it.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** Verify green; `check_menu_cases` still ok; commit `feat(browser): edge-hugging merged selection, context-menu applicability, favorites star and toggle (Stage 2C Task 11)`.

---

### Task 12: Drag and drop on pointer events

**Files:**
- Create: `frontend/src/dragdrop.js`
- Modify: `frontend/src/browser.js` (remove HTML5 drag handlers: `initRowDragDrop`, `initSidebarDragDrop`, `initBreadcrumbDragDrop`, `dragOverTarget`, `handleFsDrop`, `FP_DRAG_MIME`), `frontend/index.html` (`#drag-badge`), `frontend/src/styles.css`, `frontend/test/smoke.spec.js`

**Interfaces:**
- `dragdrop.js`:
  ```js
  const dragSession = { active: false, paths: [], sourceDir: null, pointerId: null, startX: 0, startY: 0, target: null, mode: 'move', springTimer: null, springTarget: null };
  function initDragDrop()                     // pointerdown on #list-scroll rows (delegated), pointermove/pointerup/pointercancel on window while active, keydown/keyup for Shift/Ctrl/Escape, contextmenu suppression while active
  function resolveDropTarget(x, y)            // elementFromPoint → {kind: 'folder'|'sidebar'|'crumb'|'up', path} | null; rejects self/current/descendant via the existing dropViolation logic (move that function here)
  function dropModeFor(paths, destPath, {ctrl, shift})   // shift → 'move'; ctrl → 'copy'; else sameVolume(paths[0], destPath) ? 'move' : 'copy'
  function sameVolume(a, b)                   // compare drive letter (`^[A-Za-z]:`) or UNC `\\server\share` root, case-insensitive
  function updateBadge(x, y)                  // positions #drag-badge at (x+14, y+14), sets text `${mode === 'copy' ? 'Copy' : 'Move'} ${n === 1 ? 'file' : n + ' files'}` (folders count as files in the wording), icon of the first item via iconFor
  function beginSpring(target) / cancelSpring()  // 700 ms timer; on fire: target.classList.add('fp-spring') for 250 ms then navigate (loadDirectory(path) for folder/sidebar/crumb, navUp() for 'up'); session persists; after the listing re-renders, the next pointermove re-resolves the target
  function finishDrop()                       // fileops.moveTo(paths, dest, mode === 'copy') ; then clear
  function cancelDrag()
  ```
  Right button during a session (`pointerdown` with `button === 2` or `buttons & 2` on pointermove): `navUp()` once per press; `contextmenu` event is prevented while active. Escape cancels. Text selection is suppressed during the session (`user-select: none` on body via class `is-dragging`). The pressed row is added to the selection if not selected (before the threshold triggers). Threshold 6 px.
- Badge markup `<div id="drag-badge" class="fp-drag-badge" hidden><span class="fp-drag-badge__icon"></span><span class="fp-drag-badge__text"></span></div>` with `--bg-raised` fill, hairline border, `--shadow-popover`, pointer-events none.
- Targets highlight with the existing `--drag-target` classes; `.fp-spring { animation: fp-spring 250ms ease-out }` (scale 1 → 1.04 → 1) respecting reduced motion.

- [ ] **Step 1: Smoke first** (Playwright `page.mouse`): in `_gen\Documents` press on `doc-01.txt`, move 40 px → `#drag-badge` visible with text "Move file"; hold Ctrl (`keyboard.down('Control')`) → text "Copy file"; release Ctrl; move over the `Archive` folder row (or any folder in `_gen\Documents`) and release → `doc-01.txt` gone from the list and `GET /operations?limit=1` is `move`; Ctrl+Z restores. Second run: press on a file, move over a folder and wait 1 s → breadcrumb ends with that folder (spring-load) while the badge is still visible; press Escape → badge hidden, no operation logged. Third: during a drag, `page.mouse.down({button:'right'})` → breadcrumb goes up one level.
- [ ] **Step 2: Implement**, delete the HTML5 handlers and the `draggable` attributes.
- [ ] **Step 3:** Verify green; commit `feat(dragdrop): pointer-event drag session with Move/Copy badge, modifiers, spring-loaded folders, right-click up (Stage 2C Task 12)`.

---

### Task 13: Properties panel (frontend)

**Files:**
- Create: `frontend/src/properties.js`
- Modify: `frontend/index.html` (`#properties-modal`), `frontend/src/app.js` (`cm-properties`, `inspector-properties`, Alt+Enter, settings dispatch), `frontend/src/settings.js` (`ui.properties_mode`), `frontend/src/styles.css`, `frontend/test/smoke.spec.js`

**Interfaces:**
- `properties.js`:
  ```js
  async function openProperties(path)           // mode check: 'windows' → electronAPI.showProperties(path); else fetch /fs/properties, render, open modal
  function renderGeneral(props) / function renderDetails(details)
  function propertiesApply()                    // sequence: rename (fileops.rename) if name changed → POST /fs/attributes if bits changed → POST /fs/folder-type if changed; each awaited; toasts on error; refreshDirectory() at the end; modal stays open with refreshed data
  function closeProperties()
  ```
- Modal markup (`#properties-modal`, uses the existing modal scrim pattern but its own element): header `<span class="props__icon">` (`iconFor(entry, 24)`) + editable name input; tab strip General / Details; General grid of `<dt>/<dd>` rows per §5.1 with the attribute checkboxes and (folders) the "Optimize this folder for" `<select>` (options General items, Documents, Pictures, Videos, Music; value from `folder_type || folder_type_detected` with "(detected)" appended to the detected option label); file rows include "Opens with" with the app icon (`electronAPI.fileIcon(opens_with_exe, 'exe', 16)`) and a **Change…** button (`props-open-with`); Attributes row has **Advanced…** (`props-advanced` → `electronAPI.showProperties`). Details tab lazy-loads `/fs/properties/details` on first open, grouped by `group`, shows "Details need pywin32 on this PC" on 503. Footer: **Apply** (disabled until an edit) and **Close**. No Cancel.
- Sizes formatted like Explorer: `1.23 MB (1,289,748 bytes)`; dates `Thursday, September 11, 2026, 4:12:03 PM` via `toLocaleString`.
- Settings › Personalization: "Properties panel: FilePlus | Windows" segmented → `ui.properties_mode`. Alt+Enter in the browser opens properties for the focused/selected single item.

- [ ] **Step 1: Smoke first**: right-click `doc-00.txt` → Properties → `#properties-modal` visible, header icon is `svg.fp-icon use[href="#fp-ft-text"]`, General shows Type of file containing "Text", Location ending with `Documents`, Size, Created, Modified, Accessed rows, footer has exactly one button labelled "Close" plus a disabled "Apply"; tick "Read-only" → Apply enabled → click → `/fs/properties` reports `read_only: true`; untick → Apply → false (both undone via History or `POST /operations/{id}/undo` at the end to leave the fixture clean); Details tab shows rows or the pywin32 message; a folder's properties shows Contains and the Optimize select.
- [ ] **Step 2: Implement**; remove the old `openModal('warn', …)` properties path.
- [ ] **Step 3:** Verify green; commit `feat(properties): FilePlus properties panel with General/Details, attribute and folder-type edits, Windows-dialog mode (Stage 2C Task 13)`.

---

### Task 14: Search overhaul (frontend) and Scan & Index status

**Files:**
- Create: `frontend/src/search.js`
- Modify: `frontend/index.html` (search bar, dropdown, more-filters modal, results header), `frontend/src/browser.js` (results listing mode, breadcrumb layout), `frontend/src/app.js` (palette command, actions, relabel `cm-index-folder` → "Index for This PC search"), `frontend/src/settings.js` + `index.html` (Scan & Index pane), `frontend/src/styles.css`, `frontend/test/smoke.spec.js`

**Interfaces:**
- `search.js` state: `searchState = { chips: [] /* {key, value, label} */, text: '', scope: 'current' | 'pc' | '<path>', results: null, truncated: false, inflight: null /* AbortController */, historyKey: 'fp-search-history' }`.
  ```js
  function initSearch()                          // wires #search-input (contenteditable-free: an <input> preceded by a chips container inside #search-wrap), dropdown open on focus, keyboard (Backspace on empty removes last chip, Enter runs, Escape closes dropdown)
  function addChip(key, value, label) ; function removeChip(i)
  function buildParams()                          // {root, q, type, ext, modified_after/before, created_after/before, min_size, max_size, tag, hidden, whole_word, limit: 500}
  async function runSearch()                      // aborts inflight; scope 'pc' → API.get('/search', …) else API.get('/fs/search', …) with signal; renders via browser.renderSearchResults(payload, {query, root}); pushes to history
  function clearSearch()                          // chips=[], text='', results=null → browser.exitSearchResults()
  function openMoreFilters()                      // modal with all filters; Apply → chips
  ```
- Dropdown (`#search-dropdown`, positioned under `#search-wrap`): sections **Filters** (rows with icon + title + hint: "In a specific folder — in: current location / This PC / Choose folder…", "Includes a specific type — type: image, video, audio, document, code, archive, folder", "Modified — modified: today, this week, this month, this year", "Size — size: < 1 MB, 1–100 MB, > 100 MB, > 1 GB", "Tag — tag: …", "More filters — dates, hidden items, whole words") each expanding inline to its choices; **History** (last 10, each restorable; trash icon clears). Date presets compute epoch bounds in the renderer.
- `browser.js`: `renderSearchResults(payload, {query, root})` sets `browserState.mode = 'search'`, `browserState.entries = payload.results` (each with `path`, `location = dirname(path)`), renders rows with `<mark>` around `match` spans and a `.fp-row__location` subline, header text `N results` / `First 500 results — refine the search` / `Searching…`; the breadcrumb shows `icon('search') Search in <root basename>` and a `×` (`data-action="search-clear"`); `exitSearchResults()` reloads the current path. Row actions (open, menu, drag, favorites, properties, inspector) use `entry.path`. `refreshDirectory()` in search mode re-runs the search.
- Layout (§8.3): `#toolbar { display: flex }`, `#breadcrumb-wrap { flex: 1 1 auto; min-width: 120px; overflow: hidden; display: flex; justify-content: flex-end; mask-image: linear-gradient(to right, transparent, black 24px) }`, `#search-wrap { flex: 0 1 auto; max-width: 60% }` and its width grows with content (`field-sizing: content` if supported, else a hidden measuring span).
- Palette: the file-search mode is removed; typing ≥ 1 char shows a first command "Search files for '<text>'" (action `palette-search-files`) which calls `search.setText(text); runSearch()`; the old `/search` call in `runPaletteSearch` goes away.
- Scope chip `in: This PC` → `/search` with `indexed_roots`; when the response's `indexed_roots` misses any fixed drive from `/drives`, show a results-header hint "N drives are not indexed — Index now" (`search-index-drives` → `POST /index` per missing drive, sequentially, toast progress).
- Scan & Index pane: replace the placeholder body with a table from `GET /index/status` (root, files, last run), buttons Re-index (`POST /index`) and Remove (`DELETE /index?root=`) per row, an "Index a folder…" button (`electronAPI.pickFolder` → `POST /index`), and the running indicator; the pane's placeholder toggles are removed. The folder context-menu item label becomes "Index for This PC search".

- [ ] **Step 1: Smoke first**: focus `#search-input` → `#search-dropdown` visible with "Filters" and "History"; type `doc-0` → after ≤ 1.5 s `#list-scroll` has rows with `mark` text `doc-0` and `.fp-row__location`; the header text matches `/\d+ results/`; click "Includes a specific type" → "document" → a chip `type: document` appears and results still list the txt/md files; press Backspace twice on empty text → chip removed; click outside the bar → results and text remain; click the breadcrumb `×` → normal listing returns; the History section lists `doc-0`; palette: Ctrl+K, type `readme` → first command "Search files for 'readme'" → Enter → results view. Settings › Scan & Index shows the sandbox `_gen` root after `POST /index` from the test.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** Verify green; screenshots `search-results.png`, `search-dropdown.png`; commit `feat(search): Discord-style filter chips, live results in the browser, This PC scope, Scan & Index status (Stage 2C Task 14)`.

---

### Task 15: Ask File+ button and popout; Tag Canvas banner

**Files:**
- Modify: `frontend/index.html`, `frontend/src/app.js`, `frontend/src/styles.css`, `frontend/test/smoke.spec.js`

**Interfaces:**
- Sidebar, directly under `#sb-device-name`: `<button class="fp-ask" data-action="ask-open">icon('sparkle') Ask File+</button>` (accent fill, `--text-on-accent`, pill radius, full sidebar width minus padding). Ctrl+J → `ask-open`.
- Popout `#ask-popout` (`role="dialog"`, anchored to the button's bottom-left, `--bg-raised`, hairline border, `--shadow-popover`): textarea (placeholder "Ask File+ to find, move or organise your files…"), three example chips (`ask-example`, inserts the text), footer: Send button `disabled` with `title="AI arrives in Stage 3"`, Close. Escape and outside click close (`ask-close`). No network call. Actions registered in `IN_SCOPE_ACTIONS`.
- Tag Canvas: insert the `fp-banner--planned` banner ("Not built yet — planned for Stage 3.") at the top of `#tag-canvas` and wrap its body in `fp-planned-dim`; `STUB_SCREENS`-equivalent map for overlays.

- [ ] **Step 1: Smoke first**: `.fp-ask` text is "Ask File+"; click → `#ask-popout` visible with a disabled Send; click an example chip → textarea value equals the chip text; Escape → hidden; open Tag Canvas → banner text present and body has `.fp-planned-dim`. Screenshot `ask-popout.png`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** Verify green; commit `feat(shell): Ask File+ button and popout shell; Tag Canvas planned banner (Stage 2C Task 15)`.

---

### Task 16: Gates, docs, run summary

**Files:**
- Modify: `scripts/verify.ps1` (filetypes parity gate: `py -3 scripts/build_filetypes.py <temp>` then compare; icon gate already added in Task 5), `CLAUDE.md` (module list/load order, new bridge methods, "Current state" → Stage 2C landed; ≤ 100 lines), `docs/backend-integration.md` (one-line marks for the new routes and the settings keys), `docs/superpowers/runs/2026-09-13-stage-2c.md`

- [ ] **Step 1:** Add the parity gate; run `verify.ps1` — green with the new stages listed.
- [ ] **Step 2:** Update CLAUDE.md and the integration ledger; write the run summary in the shape of `docs/superpowers/runs/2026-09-11-stage-2b.md`: what landed per task, the feedback ledger from spec §2 with a status per row, rulings (supplied at dispatch), known debts, verification counts, "How to review" (checkout, verify, `npm start`, walk the feedback list item by item), merge in two commands.
- [ ] **Step 3: Commit** `docs: Stage 2C run summary, CLAUDE.md module map, integration ledger; verify parity gate`.

---

## Self-review against the spec

- **Coverage:** §3.1 T7; §3.2–3.3 T7; §3.4–3.6, 3.9, 3.14 T8; §3.7–3.8, 3.13 T9; §3.10–3.12 T10; §4.1–4.3 T11; §4.4 T12; §5 T3 + T4 + T13; §6 T4 + T5 + T6; §7 T15; §8 T1 + T2 + T14; §9 T15; §10 load order in Global Constraints; §11 spread across tasks + T16.
- **Placeholders:** none; the family SVG set is authored in T6 under explicit construction rules; the propsys sketch is marked as to-be-adjusted to the real API and the test asserts shape only.
- **Interface consistency:** `iconFor(entry, size)` (T5/T6) is what T7 tabs, T11 rows, T12 badge, T13 header use; `saveSetting` (existing) for every key; `showContextMenu(x, y, items, opts)` gains `checked` in T10 and `enabled` in T11 — T10 must leave `enabled` support as a no-op-tolerant field so T11 adds predicates without changing the signature; `browser.renderSearchResults/exitSearchResults` (T14) consume `iconFor`, `favoritesHas` (T11) and the tab model (T7); `nav` object (T7) is what T12's spring-load `navUp()` and T14's exit path use; `fileops.moveTo(paths, dir, copy)` unchanged.
