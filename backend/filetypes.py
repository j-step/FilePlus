"""FilePlus file-type taxonomy — single source of truth for extension lookups.

FAMILIES maps a family key to the (lowercase, dotless) extensions that belong
to it. GROUPS maps a coarser search/UI group to the families it covers; a
family absent from every group (font, database, generic) falls back to the
'other' group at lookup time. `scripts/build_filetypes.py` regenerates
`frontend/src/filetypes.js` from this module — keep the two in lockstep by
running it after any change here (tests/test_filetypes.py enforces parity).
"""
from __future__ import annotations

FAMILIES: dict[str, tuple[str, ...]] = {
    "text": ("txt", "log", "ini", "cfg", "conf", "nfo"),
    "markdown": ("md", "markdown"),
    "pdf": ("pdf",),
    "word": ("doc", "docx", "odt", "rtf"),
    "excel": ("xls", "xlsx", "ods"),
    "powerpoint": ("ppt", "pptx", "odp"),
    "csv": ("csv", "tsv"),
    "code-js": ("js", "mjs", "cjs", "jsx"),
    "code-ts": ("ts", "tsx"),
    "code-py": ("py", "pyw", "ipynb"),
    "code-html": ("html", "htm"),
    "code-css": ("css", "scss", "less"),
    "code-json": ("json", "jsonc"),
    "code-xml": ("xml", "xaml", "plist"),
    "code-yaml": ("yml", "yaml", "toml"),
    "code-shell": ("ps1", "bat", "cmd", "sh"),
    "code-c": ("c", "h", "cpp", "hpp", "cc", "cs"),
    "code-java": ("java", "kt"),
    "code-go": ("go",),
    "code-rust": ("rs",),
    "code-other": ("rb", "php", "swift", "lua", "sql", "r"),
    "image": ("png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "ico", "heic", "avif"),
    "image-raw": ("cr2", "nef", "arw", "dng", "raf"),
    "svg": ("svg",),
    "video": ("mp4", "mkv", "mov", "avi", "webm", "m4v", "wmv", "flv"),
    "audio": ("mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"),
    "archive": ("zip", "7z", "rar", "tar", "gz", "bz2", "xz"),
    "executable": ("exe", "com", "dll", "sys"),
    "shortcut": ("lnk", "url"),
    "installer": ("msi", "msix", "appx"),
    "font": ("ttf", "otf", "woff", "woff2"),
    "disk-image": ("iso", "img", "vhd", "vhdx"),
    "database": ("db", "sqlite", "sqlite3", "mdb", "accdb"),
    "ebook": ("epub", "mobi", "azw3"),
    "generic": (),
}

GROUPS: dict[str, tuple[str, ...]] = {
    "image": ("image", "image-raw", "svg"),
    "video": ("video",),
    "audio": ("audio",),
    "document": ("text", "markdown", "pdf", "word", "excel", "powerpoint", "csv", "ebook"),
    "code": (
        "code-js", "code-ts", "code-py", "code-html", "code-css", "code-json",
        "code-xml", "code-yaml", "code-shell", "code-c", "code-java", "code-go",
        "code-rust", "code-other",
    ),
    "archive": ("archive", "disk-image"),
    "executable": ("executable", "shortcut", "installer"),
}

_EXT_TO_FAMILY: dict[str, str] = {
    ext: family for family, exts in FAMILIES.items() for ext in exts
}

_FAMILY_TO_GROUP: dict[str, str] = {
    family: group for group, families in GROUPS.items() for family in families
}


def _normalize_ext(ext: str) -> str:
    return str(ext or "").lstrip(".").lower()


def family_for(ext: str) -> str:
    """Return the family for *ext* ('generic' when unknown).

    *ext* may carry a leading dot and any case (e.g. '.PY', 'py', 'PNG').
    """
    return _EXT_TO_FAMILY.get(_normalize_ext(ext), "generic")


def type_group_for(ext: str, is_dir: bool = False) -> str:
    """Return 'folder' for a directory, else the search group for *ext*.

    Falls back to 'other' for a family that isn't listed under any group
    (font, database, generic).
    """
    if is_dir:
        return "folder"
    return _FAMILY_TO_GROUP.get(family_for(ext), "other")


def is_media(ext: str) -> bool:
    """True when *ext* belongs to the 'image' or 'video' search group."""
    return type_group_for(ext) in ("image", "video")


def as_json() -> dict:
    """Serialisable snapshot of the taxonomy, as consumed by GET /filetypes."""
    return {"families": FAMILIES, "groups": GROUPS}
