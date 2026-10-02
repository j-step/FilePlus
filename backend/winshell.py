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

import codecs
import configparser
import ctypes
import os
import re
import time
from collections import OrderedDict, deque
from pathlib import Path

from backend import filetypes
from backend.errors import RefusedError

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

# ---------------------------------------------------------------------------
# ctypes DLL handles for the functions this module (beyond known_folders'
# own SHGetKnownFolderPath machinery, unchanged from Task 1) calls directly:
# GetFileAttributesW/SetFileAttributesW/GetDiskFreeSpaceW/GetCompressedFileSizeW
# (kernel32) and AssocQueryStringW (shlwapi). Loaded with use_last_error=True
# (a WinDLL instance separate from the shared, not-error-tracking
# ctypes.windll.kernel32) so ctypes.get_last_error() right after a call
# reliably reflects that call's own GetLastError(), and every argtypes/
# restype pair is declared explicitly -- ctypes defaults an undeclared
# restype to a *signed* 32-bit int, which silently corrupts a DWORD whose
# top bit is set (see size_on_disk's GetCompressedFileSizeW use, where a low
# 32 bits like 0x80000000 must compose as a large positive value, not a
# negative one).
# ---------------------------------------------------------------------------
if os.name == "nt":
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _kernel32.GetFileAttributesW.argtypes = [ctypes.c_wchar_p]
    _kernel32.GetFileAttributesW.restype = ctypes.c_uint32
    _kernel32.SetFileAttributesW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32]
    _kernel32.SetFileAttributesW.restype = ctypes.c_int
    _kernel32.GetDiskFreeSpaceW.argtypes = [
        ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_uint32),
        ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_uint32),
    ]
    _kernel32.GetDiskFreeSpaceW.restype = ctypes.c_int
    _kernel32.GetCompressedFileSizeW.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_uint32)]
    _kernel32.GetCompressedFileSizeW.restype = ctypes.c_uint32

    _shlwapi = ctypes.WinDLL("shlwapi", use_last_error=True)
    _shlwapi.AssocQueryStringW.argtypes = [
        ctypes.c_uint32, ctypes.c_int, ctypes.c_wchar_p, ctypes.c_wchar_p,
        ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_uint32),
    ]
    _shlwapi.AssocQueryStringW.restype = ctypes.c_long
else:
    _kernel32 = None
    _shlwapi = None


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
        ctypes.set_last_error(0)
        attrs = _kernel32.GetFileAttributesW(str(path))
        if attrs == 0xFFFFFFFF:  # INVALID_FILE_ATTRIBUTES, restype is unsigned so never -1
            raise ctypes.WinError(ctypes.get_last_error())
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
        ctypes.set_last_error(0)
        ok = _kernel32.SetFileAttributesW(str(path), bits)
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())
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
    sectors_per_cluster = ctypes.c_uint32(0)
    bytes_per_sector = ctypes.c_uint32(0)
    free_clusters = ctypes.c_uint32(0)
    total_clusters = ctypes.c_uint32(0)
    ok = _kernel32.GetDiskFreeSpaceW(
        root, ctypes.byref(sectors_per_cluster), ctypes.byref(bytes_per_sector),
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
    to st_size rounded up to a 4096-byte cluster on a non-Windows OS, when
    the WinAPI call fails for a reason other than "path doesn't exist" (a
    transient/permission failure shouldn't be fatal), or when GetLastError()
    reports success despite an all-ones low DWORD (a file that is genuinely
    exactly 0xFFFFFFFF bytes low-order -- GetCompressedFileSizeW's own
    documented way to say "that's the real value, not an error").

    A missing *path* raises FileNotFoundError (from either
    GetCompressedFileSizeW's own GetLastError() or the st_size fallback's
    own path.stat()) rather than silently returning a fabricated size --
    GET /fs/properties already checks existence before calling this, so
    that's a clean, expected 404 for any caller that doesn't.
    """
    path = Path(path)
    if path.is_dir():
        return contains_counts(path, budget_s=budget_s, clock=clock)["bytes"]
    if os.name == "nt":
        try:
            high = ctypes.c_uint32(0)
            ctypes.set_last_error(0)
            low = _kernel32.GetCompressedFileSizeW(str(path), ctypes.byref(high))
            if low == 0xFFFFFFFF:
                err = ctypes.get_last_error()
                if err != 0:
                    raise ctypes.WinError(err)
            actual = (high.value << 32) | low  # both unsigned (restype=c_uint32) -- safe to compose directly
            cluster = _cluster_size(path)
            if cluster:
                actual = ((actual + cluster - 1) // cluster) * cluster
            return actual
        except FileNotFoundError:
            raise
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
    size = ctypes.c_uint32(0)
    _shlwapi.AssocQueryStringW(0, assocstr, dotted_ext, None, None, ctypes.byref(size))
    if size.value == 0:
        return None
    buf = ctypes.create_unicode_buffer(size.value)
    hres = _shlwapi.AssocQueryStringW(0, assocstr, dotted_ext, None, buf, ctypes.byref(size))
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

def _decode_ini_bytes(data: bytes) -> str:
    """Decode desktop.ini bytes, honouring a BOM when one is present.

    Explorer writes desktop.ini in whatever encoding the shell happened to
    use for it -- an ANSI (system codepage) file with no BOM is the classic
    case, but a UTF-8 or UTF-16 file (each with its own BOM) also shows up
    in the wild (e.g. after being hand-edited in Notepad, which defaults to
    UTF-8 today). A recognised BOM wins outright; with none, this tries the
    Windows ANSI codepage ('mbcs' -- a no-op fallback to latin-1 on a
    non-Windows OS, where 'mbcs' isn't a registered codec) and finally
    latin-1, which never raises (every byte 0-255 is a valid codepoint) so
    this function itself never raises either -- an unparseable *result* is
    caught later, when the decoded text is actually parsed as INI syntax.
    """
    if data.startswith(codecs.BOM_UTF8):
        return data.decode("utf-8-sig")
    if data.startswith(codecs.BOM_UTF16_LE) or data.startswith(codecs.BOM_UTF16_BE):
        return data.decode("utf-16")  # codec reads the BOM itself to pick LE vs BE
    try:
        return data.decode("mbcs")
    except (LookupError, UnicodeDecodeError):
        return data.decode("latin-1")


def _read_ini(text: str) -> configparser.RawConfigParser:
    """Parse *text* leniently -- for validation and value lookup only.

    RawConfigParser (no %-interpolation, so a stray '%' in a comment or an
    IconResource path never raises), strict=False (tolerates a duplicated
    section/option, which a hand-edited or shell-corrupted desktop.ini can
    have), allow_no_value=True (a bare key with no '=' is valid INI, if
    unusual here). Raises configparser.Error for text that still doesn't
    parse as INI at all (e.g. a value line before any section header) --
    callers that need to refuse on that (write_folder_type) catch it
    themselves; callers that just want a best-effort read (everything else
    here) treat it as "no FolderType found".
    """
    cp = configparser.RawConfigParser(strict=False, allow_no_value=True)
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
    return _folder_type_from_ini_text(_decode_ini_bytes(data))


def read_folder_type(path: Path) -> str | None:
    """The explicit FolderType set in *path*'s desktop.ini, or None."""
    ini_path = Path(path) / _DESKTOP_INI
    if not ini_path.exists():
        return None
    try:
        data = ini_path.read_bytes()
    except OSError:
        return None
    return folder_type_from_ini_bytes(data)


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


_INI_SECTION_HEADER_RE = re.compile(r"^[ \t]*\[[ \t]*ViewState[ \t]*\][ \t]*\r?\n?$", re.IGNORECASE)
_INI_ANY_HEADER_RE = re.compile(r"^[ \t]*\[.*\][ \t]*\r?\n?$")
_INI_FOLDER_TYPE_LINE_RE = re.compile(r"^([ \t]*FolderType[ \t]*=)(.*?)(\r?\n?)$", re.IGNORECASE)


def _set_ini_folder_type_text(text: str, folder_type: str) -> str:
    """Return *text* with [ViewState] FolderType=*folder_type* inserted or replaced.

    String surgery, not a configparser round-trip: every other line --
    including comments and any section configparser itself would silently
    drop on a re-serialised write -- is left byte-for-byte untouched. A
    missing [ViewState] section is appended at the end; a missing FolderType
    line inside an existing [ViewState] section is inserted right after the
    header; an existing FolderType line has only its value replaced.
    """
    newline = "\r\n" if "\r\n" in text else ("\n" if "\n" in text else "\r\n")
    lines = text.splitlines(keepends=True) if text else []

    section_start = next((i for i, line in enumerate(lines) if _INI_SECTION_HEADER_RE.match(line)), None)
    if section_start is None:
        if lines and not lines[-1].endswith(("\n", "\r")):
            lines[-1] += newline
        lines.append(f"[ViewState]{newline}")
        lines.append(f"FolderType={folder_type}{newline}")
        return "".join(lines)

    section_end = len(lines)
    for j in range(section_start + 1, len(lines)):
        if _INI_ANY_HEADER_RE.match(lines[j]):
            section_end = j
            break

    for i in range(section_start + 1, section_end):
        m = _INI_FOLDER_TYPE_LINE_RE.match(lines[i])
        if m:
            lines[i] = f"FolderType={folder_type}{m.group(3) or newline}"
            return "".join(lines)

    lines.insert(section_start + 1, f"FolderType={folder_type}{newline}")
    return "".join(lines)


def write_folder_type(path: Path, folder_type: str) -> tuple[bytes | None, int]:
    """Set *path*'s Explorer folder type.

    Returns (previous desktop.ini bytes or None, the folder's own attribute
    bits exactly as they were before this call touched them) so
    restore_desktop_ini can undo both precisely -- including the folder's
    READONLY bit if something other than FilePlus had already set it before
    this call, which a "clear READONLY unconditionally" undo would wrongly
    strip.

    Merges FolderType into the [ViewState] section of any existing
    desktop.ini via string surgery (_set_ini_folder_type_text), preserving
    every other section/key/comment untouched -- reading it first,
    BOM-aware (_decode_ini_bytes), and refusing (RefusedError, -> 409) to
    overwrite a desktop.ini that doesn't parse as INI at all, rather than
    silently clobbering unrecognised content. On Windows, matches Explorer's
    own "Customize this folder" behaviour: the ini gets hidden+system
    attributes and the folder itself gets the read-only attribute (the
    marker Explorer uses to know a folder carries custom metadata --
    PathMakeSystemFolder's effect, done directly here since
    PathMakeSystemFolder itself is not exposed to ctypes/pywin32 as a plain
    function export).
    """
    if folder_type not in FOLDER_TYPES:
        raise ValueError(f"unknown folder type {folder_type!r}")
    folder = Path(path)
    ini_path = folder / _DESKTOP_INI
    previous = ini_path.read_bytes() if ini_path.exists() else None
    folder_bits_before = get_attributes(folder)["bits"]

    if previous is not None:
        try:
            text = _decode_ini_bytes(previous)
            _read_ini(text)  # validate parseability only; the value (if any) is unused here
        except (UnicodeDecodeError, configparser.Error) as exc:
            raise RefusedError("desktop.ini could not be parsed; not overwriting") from exc
    else:
        text = ""

    data = _set_ini_folder_type_text(text, folder_type).encode("utf-8")

    if os.name == "nt" and ini_path.exists():
        try:
            set_attributes(ini_path, 0)  # clear hidden/system/read-only so the rewrite can't be refused
        except OSError:
            pass
    ini_path.write_bytes(data)
    if os.name == "nt":
        set_attributes(ini_path, FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)
        set_attributes(folder, folder_bits_before | FILE_ATTRIBUTE_READONLY)
    return previous, folder_bits_before


def restore_desktop_ini(path: Path, previous: bytes | None, folder_bits_before: int) -> None:
    """Undo write_folder_type: restore *previous* bytes (or remove the ini),
    and restore the folder's own attribute bits to exactly *folder_bits_before*.

    *folder_bits_before* -- write_folder_type's second return value -- is
    applied via set_attributes verbatim, so the folder's READONLY bit ends
    up exactly as it was before write_folder_type ever ran: still set if
    something other than FilePlus had already set it (rather than always
    clearing it), still clear if it wasn't set.
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
    elif ini_path.exists():
        if os.name == "nt":
            try:
                set_attributes(ini_path, 0)
            except OSError:
                pass
        ini_path.unlink()
    if os.name == "nt":
        set_attributes(folder, folder_bits_before)


# ---------------------------------------------------------------------------
# Extended property list (pywin32 propsys) — backs GET /fs/properties/details
# ---------------------------------------------------------------------------

_PROPERTY_DETAILS_CACHE_MAX = 256
_property_details_cache: "OrderedDict[tuple[str, float], list[dict]]" = OrderedDict()


def property_details(path: Path) -> list[dict]:
    """[{"group", "name", "value"}, ...] via the Windows property system.

    Imports pywin32 lazily so importing backend.winshell never requires it
    (pywin32 is Windows-only and only this one function needs it); raises
    RuntimeError("pywin32 not installed") if the import fails, which
    GET /fs/properties/details maps to a 503.

    Cached by (str(path), mtime): SHGetPropertyStoreFromParsingName plus
    per-property COM marshalling is comparatively expensive, and the
    Properties panel can re-request the same file's details (switching
    tabs, re-opening the dialog) without its mtime changing in between. The
    cache is a bounded FIFO, not an LRU -- capped at
    _PROPERTY_DETAILS_CACHE_MAX entries, oldest-inserted evicted first --
    since this is a plain in-process dict with no per-entry access tracking.
    A path whose mtime can't be read (already gone, or a permission error)
    just skips caching rather than failing the call.
    """
    cache_key = None
    try:
        cache_key = (str(path), Path(path).stat().st_mtime)
    except OSError:
        pass
    if cache_key is not None and cache_key in _property_details_cache:
        return _property_details_cache[cache_key]

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

    if cache_key is not None:
        _property_details_cache[cache_key] = out  # a fresh key (cache miss got us here) lands at the end
        if len(_property_details_cache) > _PROPERTY_DETAILS_CACHE_MAX:
            _property_details_cache.popitem(last=False)  # FIFO: oldest inserted evicted first
    return out


# ---------------------------------------------------------------------------
# Shell images at physical pixels (Stage 2C pass 2 -- Windows-icon sharpness,
# docs/superpowers/specs/2026-09-14-stage-2c-pass-2-icon-design.md §4.7).
#
# shell_image(path, px) is IShellItemImageFactory::GetImage(SIZE{px,px},
# SIIGBF_ICONONLY | SIIGBF_SCALEUP) -- the interface Explorer's own views
# draw with. It yields the hand-hinted 16/20/24/32/40/48/.../256 resources at
# any px (and scales exactly as Explorer does when none exists), real folder /
# known-folder / desktop.ini icons, shortcut-TARGET icons, and exact tile
# icons -- everything Chromium's app.getFileIcon (the Electron fallback, "Tier
# B") gets wrong: one system-drive glyph for every directory and extension-
# less file, one blank page for every .lnk/.url, and only 16*S / 32*S sizes.
#
# The raw vtable call (slot 3 of IShellItemImageFactory, after IUnknown's
# QueryInterface/AddRef/Release) is made through ctypes rather than pywin32
# because pywin32 does not wrap this interface. Measured on this machine
# (scratchpad probe, 2026-09-16): every px in 8..512 answers px x px RGBA with
# a transparent corner and an opaque body; a .lnk answers byte-identical to
# its target; a directory and an extension-less file differ; 200 calls cost
# ~90 ms on the executor.
#
# Every call runs on ICON_EXECUTOR, a 2-thread pool whose threads are
# initialised COINIT_APARTMENTTHREADED: shell icon handlers are STA objects
# and the default asyncio.to_thread pool is not COM-initialised at all. A
# hung third-party icon handler holds one worker (the route times out and
# answers `pending`; the thread is not cancellable) -- SIIGBF_ICONONLY keeps
# thumbnail providers, the heavy ones, out of this path entirely.
#
# HRESULTs are read as c_long and compared explicitly (a ctypes.HRESULT
# restype raises OSError, which would turn "the shell has no image for this"
# into an exception path). Nothing here raises: None means no image.
# ---------------------------------------------------------------------------

import concurrent.futures
import io
import threading

SIIGBF_ICONONLY = 0x4
_E_PENDING = 0x8000000A
_E_PENDING_TRIES = 20         # x _E_PENDING_RETRY_S: well inside the batch route's 2.5 s
_E_PENDING_RETRY_S = 0.025
SIIGBF_SCALEUP = 0x100
_IID_ISHELLITEMIMAGEFACTORY = "{BCC18B79-BA16-442F-80C4-8A59C30C463B}"
ICON_PX_MIN, ICON_PX_MAX = 8, 512
# Extensions whose shell icon is per FILE rather than per extension (the icon
# lives in, or is resolved through, the file itself). Parity-tested against
# frontend/iconCache.js's PER_PATH_SHELL_EXTS (tests/test_winshell.py) so the
# renderer's request identity and this cache agree on what is shareable.
PER_PATH_ICON_EXTS = frozenset({"exe", "dll", "ico", "lnk", "url", "cpl", "scr"})


class _SIZE(ctypes.Structure):
    _fields_ = [("cx", ctypes.c_long), ("cy", ctypes.c_long)]


class _BITMAP(ctypes.Structure):
    _fields_ = [
        ("bmType", ctypes.c_long), ("bmWidth", ctypes.c_long), ("bmHeight", ctypes.c_long),
        ("bmWidthBytes", ctypes.c_long), ("bmPlanes", ctypes.c_ushort), ("bmBitsPixel", ctypes.c_ushort),
        ("bmBits", ctypes.c_void_p),
    ]


class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", ctypes.c_uint32), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long),
        ("biPlanes", ctypes.c_ushort), ("biBitCount", ctypes.c_ushort), ("biCompression", ctypes.c_uint32),
        ("biSizeImage", ctypes.c_uint32), ("biXPelsPerMeter", ctypes.c_long), ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", ctypes.c_uint32), ("biClrImportant", ctypes.c_uint32),
    ]


class _BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", _BITMAPINFOHEADER), ("bmiColors", ctypes.c_uint32 * 3)]


# HRESULT GetImage(SIZE size, SIIGBF flags, HBITMAP *phbm) -- vtable slot 3.
# _SIZE is passed by value: on x64 an 8-byte POD struct travels in one
# register exactly like a c_uint64, which is what the shell expects.
_GETIMAGE = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, _SIZE, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)) if os.name == "nt" else None
_RELEASE = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p) if os.name == "nt" else None  # IUnknown slot 2

if os.name == "nt":
    _ole32i = ctypes.WinDLL("ole32")
    _ole32i.CoInitializeEx.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    _ole32i.CoInitializeEx.restype = ctypes.c_long
    _ole32i.CLSIDFromString.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(_GUID)]
    _ole32i.CLSIDFromString.restype = ctypes.c_long
    _shell32i = ctypes.WinDLL("shell32")
    _shell32i.SHCreateItemFromParsingName.argtypes = [
        ctypes.c_wchar_p, ctypes.c_void_p, ctypes.POINTER(_GUID), ctypes.POINTER(ctypes.c_void_p),
    ]
    _shell32i.SHCreateItemFromParsingName.restype = ctypes.c_long
    _gdi32 = ctypes.WinDLL("gdi32")
    _gdi32.GetObjectW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
    _gdi32.GetObjectW.restype = ctypes.c_int
    _gdi32.CreateCompatibleDC.argtypes = [ctypes.c_void_p]
    _gdi32.CreateCompatibleDC.restype = ctypes.c_void_p  # a 64-bit handle: restype MUST be c_void_p
    _gdi32.GetDIBits.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint,
    ]
    _gdi32.GetDIBits.restype = ctypes.c_int
    _gdi32.DeleteDC.argtypes = [ctypes.c_void_p]
    _gdi32.DeleteDC.restype = ctypes.c_int
    _gdi32.DeleteObject.argtypes = [ctypes.c_void_p]
    _gdi32.DeleteObject.restype = ctypes.c_int
else:
    _ole32i = _shell32i = _gdi32 = None


_com_ready = threading.local()


def _co_init_sta() -> None:
    """Once per thread: CoInitializeEx(COINIT_APARTMENTTHREADED). Idempotent
    (S_FALSE on a second call; RPC_E_CHANGED_MODE on an MTA thread, which the
    shell item calls below still tolerate) and never balanced with
    CoUninitialize -- the thread keeps its apartment for its lifetime, which
    is what an icon handler cache expects. The executor's initializer and
    every direct shell_image call go through this, so a caller on the pytest
    main thread (or any other un-initialised thread) works too."""
    if os.name == "nt" and not getattr(_com_ready, "done", False):
        _ole32i.CoInitializeEx(None, 0x2)
        _com_ready.done = True


def _make_icon_executor() -> concurrent.futures.ThreadPoolExecutor:
    return concurrent.futures.ThreadPoolExecutor(
        max_workers=2, thread_name_prefix="fp-shell-icon", initializer=_co_init_sta,
    )


ICON_EXECUTOR = _make_icon_executor()
_icon_executor_lock = threading.Lock()


def icon_executor() -> concurrent.futures.ThreadPoolExecutor:
    """The live STA pool. A pool that lifespan already shut down (a second
    TestClient in one process; uvicorn's reload) is replaced, so a route can
    never see "cannot schedule new futures after shutdown"."""
    global ICON_EXECUTOR
    with _icon_executor_lock:
        if ICON_EXECUTOR._shutdown:  # noqa: SLF001 -- the only signal the class exposes
            ICON_EXECUTOR = _make_icon_executor()
        return ICON_EXECUTOR


def shutdown_icon_executor() -> None:
    """Abandon queued and running icon work without waiting (a hung handler
    must not hold process exit); icon_executor() will mint a fresh pool if
    anything asks again."""
    with _icon_executor_lock:
        ICON_EXECUTOR.shutdown(wait=False, cancel_futures=True)

# (kind, ident, px) -> PNG bytes. Only successes are cached; a miss is
# re-asked (the shell may answer next time -- a file being written, a network
# target that just came back). No mtime: Explorer holds icons for the session
# too, and an icon key is per extension / per path, never per content.
_icon_cache: OrderedDict[tuple, bytes] = OrderedDict()
_icon_cache_lock = threading.Lock()
_ICON_CACHE_MAX = 2048


def clear_icon_cache() -> int:
    """Drops every cached shell image; returns how many there were. An icon
    being rendered right now still lands afterwards -- it is a fresh answer."""
    with _icon_cache_lock:
        n = len(_icon_cache)
        _icon_cache.clear()
    return n


def shell_icon_key(path: Path, is_dir: bool, px: int) -> tuple:
    """Cache identity for a shell image: every directory per path (desktop.ini
    custom icons, known-folder glyphs), PER_PATH_ICON_EXTS per path, any other
    extension shared. Mirrors frontend/iconCache.js's shellIconKey."""
    norm = os.path.normcase(str(path))
    if is_dir:
        return ("dir", norm, px)
    ext = Path(path).suffix.lower().lstrip(".")
    if ext in PER_PATH_ICON_EXTS:
        return ("path", norm, px)
    return ("ext", ext, px)


def shell_image(path: Path, px: int, icon_only: bool = True) -> bytes | None:
    """px x px PNG (straight alpha, RGBA) of the shell's image for *path* --
    IShellItemImageFactory::GetImage, what Explorer's views draw. px is
    clamped to ICON_PX_MIN..ICON_PX_MAX. None on any failure (a missing path,
    an item the shell has no image for, a COM error) and on a non-Windows OS.
    Call it on ICON_EXECUTOR (STA threads), never on the default pool."""
    if os.name != "nt":
        return None
    px = max(ICON_PX_MIN, min(ICON_PX_MAX, int(px)))
    _co_init_sta()
    iid = _GUID()
    if _ole32i.CLSIDFromString(_IID_ISHELLITEMIMAGEFACTORY, ctypes.byref(iid)) != 0:
        return None
    ppv = ctypes.c_void_p()
    # str(Path) has already folded forward slashes; SHCreateItemFromParsingName
    # rejects a mixed-separator spelling, and a UNC/relative one never gets
    # here (path_guard / isSafeLocalPath ahead of every caller).
    if _shell32i.SHCreateItemFromParsingName(str(path), None, ctypes.byref(iid), ctypes.byref(ppv)) != 0 or not ppv:
        return None
    vtbl = ctypes.cast(ppv, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    release, get_image = _RELEASE(vtbl[2]), _GETIMAGE(vtbl[3])
    hbm = ctypes.c_void_p()
    try:
        flags = SIIGBF_SCALEUP | (SIIGBF_ICONONLY if icon_only else 0)
        # E_PENDING is "not yet": the shell is still filling its icon cache
        # on another thread (measured: the 2nd and 3rd of three concurrent
        # first calls on a fresh STA pool). Retried briefly, never reported
        # as "no image" -- the renderer would cache that null for the session.
        for attempt in range(_E_PENDING_TRIES):
            hr = get_image(ppv, _SIZE(px, px), flags, ctypes.byref(hbm)) & 0xFFFFFFFF
            if hr != _E_PENDING:
                break
            if attempt + 1 < _E_PENDING_TRIES:
                time.sleep(_E_PENDING_RETRY_S)
        if hr != 0 or not hbm:
            return None
        return _hbitmap_to_png(hbm)
    except Exception:
        return None
    finally:
        if hbm:
            _gdi32.DeleteObject(hbm)
        release(ppv)


def _hbitmap_to_png(hbm) -> bytes | None:
    """Top-down 32-bpp DIB of *hbm* -> PNG bytes. GetImage hands back
    PREMULTIPLIED BGRA; Pillow's 'BGRa' raw mode un-premultiplies ('BGRA'
    would fringe every anti-aliased edge dark)."""
    bm = _BITMAP()
    if _gdi32.GetObjectW(hbm, ctypes.sizeof(bm), ctypes.byref(bm)) == 0:
        return None
    w, h = bm.bmWidth, abs(bm.bmHeight)
    if w <= 0 or h <= 0:
        return None
    bmi = _BITMAPINFO()
    bmi.bmiHeader.biSize = ctypes.sizeof(_BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth, bmi.bmiHeader.biHeight = w, -h  # negative height = top-down rows
    bmi.bmiHeader.biPlanes, bmi.bmiHeader.biBitCount, bmi.bmiHeader.biCompression = 1, 32, 0
    buf = (ctypes.c_ubyte * (w * h * 4))()
    hdc = _gdi32.CreateCompatibleDC(None)
    try:
        lines = _gdi32.GetDIBits(hdc, hbm, 0, h, buf, ctypes.byref(bmi), 0)
    finally:
        _gdi32.DeleteDC(hdc)
    if lines != h:
        return None
    from PIL import Image  # pillow is a hard requirement (requirements.txt); imported lazily like propsys
    img = Image.frombuffer("RGBA", (w, h), bytes(buf), "raw", "BGRa", 0, 1)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def shell_image_cached(key: tuple, path: Path, px: int, icon_only: bool = True) -> bytes | None:
    """shell_image through the bounded, thread-safe LRU keyed by *key*
    (shell_icon_key). Only a rendered image is stored."""
    with _icon_cache_lock:
        hit = _icon_cache.get(key)
        if hit is not None:
            _icon_cache.move_to_end(key)
            return hit
    png = shell_image(path, px, icon_only)
    if png:
        with _icon_cache_lock:
            _icon_cache[key] = png
            _icon_cache.move_to_end(key)
            while len(_icon_cache) > _ICON_CACHE_MAX:
                _icon_cache.popitem(last=False)
    return png
