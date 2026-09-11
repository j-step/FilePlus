"""FilePlus configuration — loads env vars from .env and owns the write guard.

path_guard(path, mode) is the single gate for filesystem access:
  read  — any path (browsing real drives is the product).
  write — inside FILEPLUS_SANDBOX_PATH until WRITE_UNLOCKED=true; Windows system
          roots are never writable, and the FilePlus app directory is never
          writable except the sandbox inside it.

Write-mode containment order (see path_guard): (1) any SYSTEM_WRITE_ROOTS entry
wins unconditionally -> ProtectedPathError; (2) the sandbox is allowed; (3) any
other PROTECTED_WRITE_ROOTS entry (the app dir, or a test-injected root) ->
ProtectedPathError; (4) WRITE_UNLOCKED -> allowed, else OutOfSandboxError.
"""
from dotenv import load_dotenv
import os
from pathlib import Path

load_dotenv()


class OutOfSandboxError(Exception):
    """Raised for a write outside the sandbox while WRITE_UNLOCKED is false."""


class ProtectedPathError(Exception):
    """Raised for a write under a protected system root, regardless of unlock state."""


FILEPLUS_APP_DIR = Path(__file__).resolve().parents[1]

FILEPLUS_SANDBOX_PATH = Path(os.getenv("FILEPLUS_SANDBOX_PATH", str(FILEPLUS_APP_DIR / "FilePlusTestSandbox")))
FILEPLUS_DB_PATH = Path(os.getenv("FILEPLUS_DB_PATH", str(FILEPLUS_APP_DIR / "fileplus.db")))
FILEPLUS_EVERYTHING_PATH = Path(os.getenv("FILEPLUS_EVERYTHING_PATH", r"C:\Everything"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

# Decision D2: writes stay in the sandbox until the author flips this.
WRITE_UNLOCKED = os.getenv("WRITE_UNLOCKED", "false").lower() == "true"
AUTO_SORT_ENABLED = os.getenv("AUTO_SORT_ENABLED", "false").lower() == "true"
AUTO_SORT_CONFIDENCE_THRESHOLD = float(os.getenv("AUTO_SORT_CONFIDENCE_THRESHOLD", "0.85"))
MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", "100"))

TRASH_DIRNAME = ".FilePlusTrash"
LISTING_CAP = 10_000


def _env_path(name: str, default: str) -> Path:
    value = os.environ.get(name)
    return Path(value) if value else Path(default)


# The four Windows-system-derived roots. These win unconditionally in write
# mode, even over the sandbox exemption (see path_guard's containment order).
SYSTEM_WRITE_ROOTS: list[Path] = [
    _env_path("SystemRoot", r"C:\Windows"),
    _env_path("ProgramFiles", r"C:\Program Files"),
    _env_path("ProgramFiles(x86)", r"C:\Program Files (x86)"),
    _env_path("ProgramData", r"C:\ProgramData"),
]

# Kept for compatibility: everything SYSTEM_WRITE_ROOTS protects, plus the
# FilePlus app directory (whose sandbox subdirectory is exempted separately).
PROTECTED_WRITE_ROOTS: list[Path] = SYSTEM_WRITE_ROOTS + [FILEPLUS_APP_DIR]


def is_under(path: Path, root: Path) -> bool:
    """Case-insensitive, separator-aware containment test (Windows semantics)."""
    p = os.path.normcase(os.path.normpath(str(path)))
    r = os.path.normcase(os.path.normpath(str(root)))
    return p == r or p.startswith(r.rstrip("\\/") + os.sep)


def _canonicalize(path: Path | str) -> Path:
    """Resolve *path* and reject spellings that would defeat containment checks.

    Win32 accepts (and silently normalises away) an extended-length \\\\?\\
    prefix, a drive-relative spelling, and path components with a trailing
    space or dot -- any of which could make a path that is really inside a
    protected or sandboxed location look like it isn't, or vice versa.
    """
    resolved = Path(path).resolve()
    s = str(resolved)
    if s.startswith("\\\\?\\UNC\\"):
        resolved = Path("\\\\" + s[len("\\\\?\\UNC\\"):]).resolve()
    elif s.startswith("\\\\?\\"):
        resolved = Path(s[len("\\\\?\\"):]).resolve()
    if not (resolved.drive and resolved.root):
        raise ValueError(f"Path must be absolute with a drive: {path!r}")
    for part in resolved.parts[1:]:
        if part.endswith(" ") or part.endswith("."):
            raise ValueError(
                f"Path component {part!r} ends with a space or a dot; Windows accepts "
                f"that spelling but normalises it away, which would defeat containment "
                f"checks: {resolved}"
            )
    return resolved


def is_protected_read(path: Path) -> bool:
    """Read-time protection check, mirroring path_guard's write-mode order.

    A Windows system root always wins. Otherwise the sandbox is exempt (even
    though it may live inside a protected app dir). Otherwise any other
    PROTECTED_WRITE_ROOTS entry (the app dir) is protected. Used by the
    indexer and POST /index so they never treat the default sandbox -- which
    lives inside FILEPLUS_APP_DIR -- as protected.
    """
    resolved = Path(path).resolve()
    if any(is_under(resolved, root) for root in SYSTEM_WRITE_ROOTS):
        return True
    if is_under(resolved, FILEPLUS_SANDBOX_PATH):
        return False
    return any(is_under(resolved, root) for root in PROTECTED_WRITE_ROOTS)


def path_guard(path: Path | str, mode: str = "read") -> Path:
    """Return the resolved path or raise. See module docstring."""
    resolved = _canonicalize(path)
    if mode == "read":
        return resolved
    if mode != "write":
        raise ValueError(f"path_guard mode must be 'read' or 'write', got {mode!r}")
    for root in SYSTEM_WRITE_ROOTS:
        if is_under(resolved, root):
            raise ProtectedPathError(f"'{resolved}' is inside the protected Windows system location '{root}'; FilePlus never writes there.")
    if is_under(resolved, FILEPLUS_SANDBOX_PATH):
        return resolved  # the sandbox is always writable, even inside the app dir
    for root in PROTECTED_WRITE_ROOTS:
        if is_under(resolved, root):
            raise ProtectedPathError(f"'{resolved}' is inside the protected location '{root}'; FilePlus never writes there.")
    if not WRITE_UNLOCKED:
        raise OutOfSandboxError(
            f"Writes are locked to the sandbox '{FILEPLUS_SANDBOX_PATH}' (WRITE_UNLOCKED=false); refused '{resolved}'."
        )
    return resolved
