"""Windows known-folder resolution via SHGetKnownFolderPath (ctypes).

known_folders() returns Desktop/Downloads/Documents/Pictures/Videos/Music
(plus Screenshots when <Pictures>\\Screenshots exists) as absolute paths.
On Windows the shell is asked directly, via the FOLDERID GUIDs below, so a
OneDrive-redirected folder still resolves correctly (the shell answers, not
a hardcoded guess). On any other OS, or when the shell call fails for any
reason, each folder falls back to Path.home()/<Name> -- this keeps the
module (and every test that imports it) usable on any platform.
"""
from __future__ import annotations

import ctypes
import os
from pathlib import Path


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
        if hres != 0 or not path_ptr.value:
            return None
        value = path_ptr.value
        ole32.CoTaskMemFree(path_ptr)
        return value
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
