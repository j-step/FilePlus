"""Windows shell helpers via ctypes/pywin32.

known_folders() returns Desktop/Downloads/Documents/Pictures/Videos/Music
(plus Screenshots when <Pictures>\\Screenshots exists) as absolute paths.
On Windows the shell is asked directly, via the FOLDERID GUIDs below, so a
OneDrive-redirected folder still resolves correctly (the shell answers, not
a hardcoded guess). On any other OS, or when the shell call fails for any
reason, each folder falls back to Path.home()/<Name> -- this keeps the
module (and every test that imports it) usable on any platform.

The rest of this module backs GET /fs/properties and the attr-set /
folder-type-set mutations (Stage 2C Task 3): file attributes
(get_attributes/set_attributes), on-disk size (size_on_disk), file-type
associations (assoc), a budgeted recursive folder summary (contains_counts),
the desktop.ini-backed "folder type" Explorer feature
(read_folder_type/detect_folder_type/write_folder_type/restore_desktop_ini),
and the pywin32-backed extended property list (property_details). Every
function other than property_details returns a documented fallback on a
non-Windows OS (or, for set_attributes, when the underlying WinAPI call
fails) so the module stays importable and testable anywhere.
"""
from __future__ import annotations

import configparser
import ctypes
import io
import os
import time
from collections import deque
from pathlib import Path

from backend import filetypes

FILE_ATTRIBUTE_READONLY = 0x1
FILE_ATTRIBUTE_HIDDEN = 0x2
FILE_ATTRIBUTE_SYSTEM = 0x4
FILE_ATTRIBUTE_ARCHIVE = 0x20

_DESKTOP_INI = "desktop.ini"
FOLDER_TYPES = ("Generic", "Documents", "Pictures", "Videos", "Music")
_GROUP_TO_FOLDER_TYPE = {"image": "Pictures", "video": "Videos", "audio": "Music",
                         "document": "Documents", "code": "Documents"}
_GROUP_BY_PROPERTY_PREFIX = {
    "Video": "Video", "Audio": "Audio", "Image": "Image",
    "Media": "Media", "Document": "Document", "Photo": "Photo",
}


class _GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", ctypes.c_ulong),
        ("Data2", ctypes.c_ushort),
        ("Data3", ctypes.c_ushort),
        ("Data4", ctypes.c_ubyte * 8),
    ]


# id -> (display name, FOLDERID GUID string). Dict order fixes known_folders()
# output order; "screenshots" is appended separately, only when it exists.
_FOLDERS: dict[str, tuple[str, str]] = {
    "desktop":   ("Desktop",   "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}"),
    "downloads": ("Downloads", "{374DE290-123F-4565-9164-39C4925E467B}"),
    "documents": ("Documents", "{FDD39AD0-238F-46AF-ADB4-6C85480369C7}"),
    "pictures":  ("Pictures",  "{33E28130-4E1E-4676-835A-98395C3BC3BB}"),
    "videos":    ("Videos",    "{18989B1D-99B5-455B-841C-AB7C74E4DDFC}"),
    "music":     ("Music",     "{4BD8D571-6D19-48D3-BE97-422220080E43}"),
}


def _sh_known_folder_path(guid_str: str) -> str | None:
    """Ask the Windows shell for a known folder's path; None on any failure."""
    try:
        guid = _GUID()
        ole32 = ctypes.windll.ole32  # type: ignore[attr-defined]
        if ole32.CLSIDFromString(ctypes.c_wchar_p(guid_str), ctypes.byref(guid)) != 0:
            return None
        path_ptr = ctypes.c_wchar_p()
        shell32 = ctypes.windll.shell32  # type: ignore[attr-defined]
        hres = shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, 0, ctypes.byref(path_ptr))
        if hres != 0:
            return None
        # A successful call always allocates path_ptr -- free it in a finally
        # so an empty (falsy) result doesn't skip CoTaskMemFree and leak it.
        try:
            value = path_ptr.value
            return value if value else None
        finally:
            ole32.CoTaskMemFree(path_ptr)
    except OSError:
        return None


def known_folders() -> list[dict]:
    """Return known folders as [{id, name, path}, ...].

    Ids: desktop, downloads, documents, pictures, videos, music, and (only
    when the directory exists) screenshots.
    """
    folders: list[dict] = []
    for folder_id, (name, guid_str) in _FOLDERS.items():
        path = _sh_known_folder_path(guid_str) if os.name == "nt" else None
        if not path:
            path = str(Path.home() / name)
        folders.append({"id": folder_id, "name": name, "path": path})

    pictures_path = next(f["path"] for f in folders if f["id"] == "pictures")
    screenshots_path = Path(pictures_path) / "Screenshots"
    if screenshots_path.is_dir():
        folders.append({"id": "screenshots", "name": "Screenshots", "path": str(screenshots_path)})

    return folders


# ---------------------------------------------------------------------------
# File attributes
# ---------------------------------------------------------------------------

def get_attributes(path: Path) -> dict:
    """Return {"bits", "read_only", "hidden", "archive", "system"} for *path*.

    On Windows this is exactly GetFileAttributesW. On any other OS there is
    no such bitmask, so one is synthesised from st_mode (writability ->
    read_only) and the filename (a dot-prefix -> hidden); archive is left set
    (matching a freshly-written Windows file) and system is always false.
    """
    path = Path(path)
    if os.name == "nt":
        attrs = ctypes.windll.kernel32.GetFileAttributesW(str(path))  # type: ignore[attr-defined]
        if attrs in (-1, 0xFFFFFFFF):
            raise OSError(f"GetFileAttributesW failed for {path}")
        bits = attrs
    else:
        bits = FILE_ATTRIBUTE_ARCHIVE
        if not os.access(path, os.W_OK):
            bits |= FILE_ATTRIBUTE_READONLY
        if path.name.startswith("."):
            bits |= FILE_ATTRIBUTE_HIDDEN
    return {
        "bits": bits,
        "read_only": bool(bits & FILE_ATTRIBUTE_READONLY),
        "hidden": bool(bits & FILE_ATTRIBUTE_HIDDEN),
        "archive": bool(bits & FILE_ATTRIBUTE_ARCHIVE),
        "system": bool(bits & FILE_ATTRIBUTE_SYSTEM),
    }


def set_attributes(path: Path, bits: int) -> None:
    """Apply the exact Windows attribute bitmask *bits* to *path*.

    Raises OSError on failure. On a non-Windows OS there is no bitmask to
    set, so only the one bit chmod can approximate is honoured: the
    read-only flag toggles the owner-write permission bit.
    """
    path = Path(path)
    if os.name == "nt":
        ok = ctypes.windll.kernel32.SetFileAttributesW(str(path), bits)  # type: ignore[attr-defined]
        if not ok:
            raise OSError(f"SetFileAttributesW failed for {path} (bits={bits:#x})")
        return
    mode = path.stat().st_mode
    mode = (mode & ~0o222) if (bits & FILE_ATTRIBUTE_READONLY) else (mode | 0o200)
    os.chmod(path, mode)


# ---------------------------------------------------------------------------
# Size on disk
# ---------------------------------------------------------------------------

def _cluster_size(path: Path) -> int:
    """Bytes per allocation unit on *path*'s volume, or 0 if it can't be read."""
    drive = os.path.splitdrive(str(Path(path).resolve()))[0]
    if not drive:
        return 0
    root = drive + "\\"
    sectors_per_cluster = ctypes.c_ulong(0)
    bytes_per_sector = ctypes.c_ulong(0)
    free_clusters = ctypes.c_ulong(0)
    total_clusters = ctypes.c_ulong(0)
    ok = ctypes.windll.kernel32.GetDiskFreeSpaceW(  # type: ignore[attr-defined]
        ctypes.c_wchar_p(root), ctypes.byref(sectors_per_cluster), ctypes.byref(bytes_per_sector),
        ctypes.byref(free_clusters), ctypes.byref(total_clusters),
    )
    if not ok:
        return 0
    return sectors_per_cluster.value * bytes_per_sector.value


def size_on_disk(path: Path, budget_s: float = 3.0, clock=time.monotonic) -> int:
    """Actual allocation on disk for *path*.

    A file: GetCompressedFileSizeW (the true allocation for a sparse or
    NTFS-compressed file), rounded up to the volume's cluster size. A folder:
    the budgeted recursive byte total from contains_counts (a true per-file
    on-disk walk would mean one GetCompressedFileSizeW call per file, which
    is far too slow for a folder with any real number of files). Falls back
    to st_size rounded up to a 4096-byte cluster on a non-Windows OS, or if
    the WinAPI call fails.
    """
    path = Path(path)
    if path.is_dir():
        return contains_counts(path, budget_s=budget_s, clock=clock)["bytes"]
    if os.name == "nt":
        try:
            high = ctypes.c_ulong(0)
            low = ctypes.windll.kernel32.GetCompressedFileSizeW(str(path), ctypes.byref(high))  # type: ignore[attr-defined]
            if low == 0xFFFFFFFF:
                raise OSError(f"GetCompressedFileSizeW failed for {path}")
            actual = (high.value << 32) | low
            cluster = _cluster_size(path)
            if cluster:
                actual = ((actual + cluster - 1) // cluster) * cluster
            return actual
        except OSError:
            pass
    return ((path.stat().st_size + 4095) // 4096) * 4096


# ---------------------------------------------------------------------------
# File-type association
# ---------------------------------------------------------------------------

# Real Win32 ASSOCSTR enum values (shlwapi.h): COMMAND=1, EXECUTABLE=2,
# FRIENDLYDOCNAME=3, FRIENDLYAPPNAME=4. Verified empirically against the
# live shell association table on this machine (AssocQueryStringW(3, ".txt")
# -> "Text Document", AssocQueryStringW(4, ".txt") -> "Notepad") -- the two
# friendly-name values are easy to mix up (some second-hand references swap
# them) and getting them backwards would silently swap type_description and
# opens_with in every /fs/properties response.
_ASSOCSTR_EXECUTABLE = 2
_ASSOCSTR_FRIENDLYDOCNAME = 3
_ASSOCSTR_FRIENDLYAPPNAME = 4


def _assoc_query_string(assocstr: int, dotted_ext: str) -> str | None:
    """One AssocQueryStringW lookup; None on any failure or empty result.

    Follows the documented two-call idiom: call once with a null buffer to
    learn the required size, then again with a buffer of that size.
    """
    shlwapi = ctypes.windll.shlwapi  # type: ignore[attr-defined]
    size = ctypes.c_uint(0)
    shlwapi.AssocQueryStringW(0, assocstr, ctypes.c_wchar_p(dotted_ext), None, None, ctypes.byref(size))
    if size.value == 0:
        return None
    buf = ctypes.create_unicode_buffer(size.value)
    hres = shlwapi.AssocQueryStringW(0, assocstr, ctypes.c_wchar_p(dotted_ext), None, buf, ctypes.byref(size))
    if hres != 0:  # S_OK
        return None
    return buf.value or None


def assoc(ext: str) -> dict:
    """Return {"type_description", "opens_with", "opens_with_exe"} for *ext*.

    Windows: AssocQueryStringW for the friendly doc name (e.g. "Text
    Document"), the friendly app name (e.g. "Notepad") and the resolved
    executable path. Falls back to f"{EXT} File" with no known app on a
    non-Windows OS or when no association is registered.
    """
    ext = str(ext or "").lstrip(".").lower()
    if os.name == "nt" and ext:
        dotted = f".{ext}"
        try:
            type_description = _assoc_query_string(_ASSOCSTR_FRIENDLYDOCNAME, dotted)
            if type_description:
                return {
                    "type_description": type_description,
                    "opens_with": _assoc_query_string(_ASSOCSTR_FRIENDLYAPPNAME, dotted),
                    "opens_with_exe": _assoc_query_string(_ASSOCSTR_EXECUTABLE, dotted),
                }
        except OSError:
            pass
    return {"type_description": f"{ext.upper()} File", "opens_with": None, "opens_with_exe": None}


# ---------------------------------------------------------------------------
# Recursive folder summary — budgeted os.scandir walk (see searcher.search_tree)
# ---------------------------------------------------------------------------

def contains_counts(path: Path, budget_s: float = 3.0, clock=time.monotonic) -> dict:
    """{"files", "folders", "bytes", "truncated"} for the tree rooted at *path*.

    Breadth-first over an explicit deque (never recursion), stopping as soon
    as the wall-clock budget is spent -- checked both when a directory is
    dequeued and once per entry inside it, so one huge flat directory can't
    dodge the budget by never re-checking the clock (same shape as
    searcher.search_tree). Either way `truncated` comes back True.
    """
    start = clock()
    files = folders = 0
    total_bytes = 0
    truncated = False
    queue: deque[Path] = deque([Path(path)])

    while queue:
        if clock() - start > budget_s:
            truncated = True
            break
        directory = queue.popleft()
        try:
            scandir_ctx = os.scandir(directory)
        except OSError:
            continue
        with scandir_ctx as entries:
            for entry in entries:
                if clock() - start > budget_s:
                    truncated = True
                    break
                try:
                    is_dir = entry.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                if is_dir:
                    folders += 1
                    queue.append(Path(entry.path))
                    continue
                files += 1
                try:
                    total_bytes += entry.stat(follow_symlinks=False).st_size
                except OSError:
                    pass
        if truncated:
            break

    return {"files": files, "folders": folders, "bytes": total_bytes, "truncated": truncated}


# ---------------------------------------------------------------------------
# Folder type (desktop.ini [ViewState] FolderType) — the Explorer feature
# behind "Customize -> Optimize this folder for: Pictures/Videos/Music/...".
# ---------------------------------------------------------------------------

def _read_ini(text: str) -> configparser.ConfigParser:
    cp = configparser.ConfigParser()
    cp.optionxform = str  # preserve key case (desktop.ini keys are PascalCase)
    cp.read_string(text)
    return cp


def _folder_type_from_ini_text(text: str) -> str | None:
    try:
        cp = _read_ini(text)
    except configparser.Error:
        return None
    if cp.has_section("ViewState") and cp.has_option("ViewState", "FolderType"):
        return cp.get("ViewState", "FolderType") or None
    return None


def folder_type_from_ini_bytes(data: bytes | None) -> str | None:
    """Parse a desktop.ini's FolderType without touching disk.

    Shared by read_folder_type (reads the file itself) and backend.mover's
    folder-type-set undo (which already has the previous bytes in hand from
    the operations_log reason and must report what they would restore
    without performing the restore first).
    """
    if data is None:
        return None
    return _folder_type_from_ini_text(data.decode("utf-8", errors="replace"))


def read_folder_type(path: Path) -> str | None:
    """The explicit FolderType set in *path*'s desktop.ini, or None."""
    ini_path = Path(path) / _DESKTOP_INI
    if not ini_path.exists():
        return None
    try:
        return _folder_type_from_ini_text(ini_path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return None


def detect_folder_type(names: list[tuple[str, bool]]) -> str:
    """Majority-rule folder type guess from *names* ([(name, is_dir), ...]).

    Sub-folders don't vote. Each file's filetypes group maps to a folder
    type (image -> Pictures, video -> Videos, audio -> Music, document/code
    -> Documents); anything else, or no files at all, is a tie at zero and
    resolves to Generic.
    """
    counts = {"Pictures": 0, "Videos": 0, "Music": 0, "Documents": 0}
    for name, is_dir in names:
        if is_dir:
            continue
        ext = os.path.splitext(name)[1]
        group = filetypes.type_group_for(ext, is_dir=False)
        folder_type = _GROUP_TO_FOLDER_TYPE.get(group)
        if folder_type:
            counts[folder_type] += 1
    winner = max(counts, key=lambda k: counts[k])
    return winner if counts[winner] > 0 else "Generic"


def write_folder_type(path: Path, folder_type: str) -> bytes | None:
    """Set *path*'s Explorer folder type; return the previous desktop.ini bytes (None if absent).

    Merges FolderType into the [ViewState] section of any existing
    desktop.ini, preserving every other section/key untouched. On Windows,
    matches Explorer's own "Customize this folder" behaviour: the ini gets
    hidden+system attributes and the folder itself gets the read-only
    attribute (the marker Explorer uses to know a folder carries custom
    metadata -- PathMakeSystemFolder's effect, done directly here since
    PathMakeSystemFolder itself is not exposed to ctypes/pywin32 as a plain
    function export).
    """
    if folder_type not in FOLDER_TYPES:
        raise ValueError(f"unknown folder type {folder_type!r}")
    folder = Path(path)
    ini_path = folder / _DESKTOP_INI
    previous = ini_path.read_bytes() if ini_path.exists() else None

    cp = configparser.ConfigParser()
    cp.optionxform = str
    if previous is not None:
        try:
            cp = _read_ini(previous.decode("utf-8", errors="replace"))
        except configparser.Error:
            cp = configparser.ConfigParser()
            cp.optionxform = str
    if not cp.has_section("ViewState"):
        cp.add_section("ViewState")
    cp.set("ViewState", "FolderType", folder_type)

    buf = io.StringIO()
    cp.write(buf, space_around_delimiters=False)
    data = buf.getvalue().replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8")

    if os.name == "nt" and ini_path.exists():
        try:
            set_attributes(ini_path, 0)  # clear hidden/system/read-only so the rewrite can't be refused
        except OSError:
            pass
    ini_path.write_bytes(data)
    if os.name == "nt":
        set_attributes(ini_path, FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)
        folder_bits = get_attributes(folder)["bits"]
        set_attributes(folder, folder_bits | FILE_ATTRIBUTE_READONLY)
    return previous


def restore_desktop_ini(path: Path, previous: bytes | None) -> None:
    """Undo write_folder_type: restore *previous* bytes, or remove the ini.

    When *previous* is None the folder had no desktop.ini before -- removing
    it and clearing the folder's read-only bit fully reverts it to an
    un-customized folder. When *previous* holds bytes, the folder was
    already customized before this change, so only the ini content is put
    back; the folder's read-only bit (already set from that earlier
    customization) is left alone.
    """
    folder = Path(path)
    ini_path = folder / _DESKTOP_INI
    if previous is not None:
        if os.name == "nt" and ini_path.exists():
            try:
                set_attributes(ini_path, 0)
            except OSError:
                pass
        ini_path.write_bytes(previous)
        if os.name == "nt":
            set_attributes(ini_path, FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)
        return
    if ini_path.exists():
        if os.name == "nt":
            try:
                set_attributes(ini_path, 0)
            except OSError:
                pass
        ini_path.unlink()
    if os.name == "nt":
        folder_bits = get_attributes(folder)["bits"]
        set_attributes(folder, folder_bits & ~FILE_ATTRIBUTE_READONLY)


# ---------------------------------------------------------------------------
# Extended property list (pywin32 propsys) — backs GET /fs/properties/details
# ---------------------------------------------------------------------------

def property_details(path: Path) -> list[dict]:
    """[{"group", "name", "value"}, ...] via the Windows property system.

    Imports pywin32 lazily so importing backend.winshell never requires it
    (pywin32 is Windows-only and only this one function needs it); raises
    RuntimeError("pywin32 not installed") if the import fails, which
    GET /fs/properties/details maps to a 503.
    """
    try:
        from win32com.propsys import propsys
    except ImportError as exc:
        raise RuntimeError("pywin32 not installed") from exc

    store = propsys.SHGetPropertyStoreFromParsingName(str(path))
    out: list[dict] = []
    for i in range(store.GetCount()):
        key = store.GetAt(i)
        try:
            name = propsys.PSGetNameFromPropertyKey(key)
        except Exception:
            continue
        try:
            raw = store.GetValue(key)
            value = raw.ToString() if hasattr(raw, "ToString") else str(raw.GetValue())
        except Exception:
            continue
        if value in ("", None):
            continue
        prefix = name.split(".")[1] if name.startswith("System.") else ""
        group = _GROUP_BY_PROPERTY_PREFIX.get(prefix, "General")
        out.append({"group": group, "name": name.replace("System.", "").split(".")[-1], "value": value})
    return out
