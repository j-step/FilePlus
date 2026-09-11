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
import ipaddress
import os
import re
import socket
import threading
from pathlib import Path

import psutil

load_dotenv()


class OutOfSandboxError(Exception):
    """Raised for a write outside the sandbox while WRITE_UNLOCKED is false."""


class ProtectedPathError(Exception):
    """Raised for a write under a protected system root, regardless of unlock state."""


class BadPathError(ValueError):
    """Raised for an input spelling _canonicalize refuses outright (not absolute,
    no drive/UNC root, or a component that would be silently normalised away)."""


FILEPLUS_APP_DIR = Path(__file__).resolve().parents[1]

FILEPLUS_SANDBOX_PATH = Path(os.getenv("FILEPLUS_SANDBOX_PATH", str(FILEPLUS_APP_DIR / "FilePlusTestSandbox")))
FILEPLUS_DB_PATH = Path(os.getenv("FILEPLUS_DB_PATH", str(FILEPLUS_APP_DIR / "fileplus.db")))
FILEPLUS_EVERYTHING_PATH = Path(os.getenv("FILEPLUS_EVERYTHING_PATH", r"C:\Everything"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
# When set, every route except /health requires header X-FilePlus-Token to match.
FILEPLUS_API_TOKEN = os.getenv("FILEPLUS_API_TOKEN", "")
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


_ADMIN_SHARE_RE = re.compile(
    r"^\\\\(?P<host>[^\\]+)\\(?P<share>[A-Za-z]\$|ADMIN\$)(?P<rest>.*)$", re.IGNORECASE
)

_local_addrs_cache: set[str] | None = None


def _local_interface_addresses() -> set[str]:
    """This machine's own interface addresses (IPv4 and IPv6), lower-cased.

    Computed once per process (network interfaces don't change mid-run) and
    reused by _is_local_host.
    """
    global _local_addrs_cache
    if _local_addrs_cache is None:
        addrs: set[str] = set()
        try:
            for iface_addrs in psutil.net_if_addrs().values():
                for a in iface_addrs:
                    if a.address:
                        addrs.add(a.address.split("%")[0].lower())  # strip IPv6 zone id
        except Exception:
            pass  # best effort -- an empty set just means no LAN-IP match, not a crash
        _local_addrs_cache = addrs
    return _local_addrs_cache


def _resolve_host_addrs(host: str, timeout: float = 2.0) -> list[str]:
    """socket.getaddrinfo(host, None), bounded to *timeout* seconds.

    getaddrinfo has no native timeout on Windows, so this runs it on a
    daemon thread and gives up (returning []) if it hasn't finished by the
    deadline -- a hung DNS lookup for a hostile hostname must not hang
    path_guard, and a daemon thread never blocks process exit even if the
    lookup itself never returns.
    """
    out: list[str] = []

    def _do() -> None:
        try:
            out.extend(info[4][0] for info in socket.getaddrinfo(host, None))
        except OSError:
            pass

    t = threading.Thread(target=_do, daemon=True)
    t.start()
    t.join(timeout)
    return out


def _is_local_host(host: str) -> bool:
    """True when *host* (a UNC hostname) names this machine.

    Checked, cheapest first: the classic loopback names/our own
    COMPUTERNAME/hostname; the ``.ipv6-literal.net`` encoding Windows accepts
    for IPv6 UNC hosts (e.g. ``0--1.ipv6-literal.net`` for ``::1``); and
    finally whether *host* resolves (bounded lookup) to a loopback address or
    one of our own interface addresses -- catching a bare LAN IP or any other
    hostname for this same box.
    """
    h = host.lower()
    named = {
        "localhost", "127.0.0.1", "::1",
        os.environ.get("COMPUTERNAME", "").lower(),
        socket.gethostname().lower(),
    }
    named.discard("")
    if h in named:
        return True
    if h.endswith(".ipv6-literal.net"):
        return True
    local_addrs = _local_interface_addresses()
    for addr in _resolve_host_addrs(host):
        addr = addr.split("%")[0].lower()
        try:
            if ipaddress.ip_address(addr).is_loopback:
                return True
        except ValueError:
            pass
        if addr in local_addrs:
            return True
    return False


def _map_loopback_admin_share(resolved: Path) -> Path:
    """Map a local admin-share UNC spelling back to its local drive form.

    ``\\\\localhost\\C$\\Windows\\x``, ``\\\\<own LAN IP>\\C$\\...``,
    ``\\\\0--1.ipv6-literal.net\\C$\\...`` and ``\\\\<host>\\ADMIN$\\...`` are
    all just a local drive (or, for ADMIN$, %SystemRoot%) reached over the
    loopback network stack under a different name. Left as UNC, is_under's
    string containment check against SYSTEM_WRITE_ROOTS (local-drive paths)
    never matches, so any of these spellings would otherwise bypass write
    protection entirely when unlocked. A UNC host that isn't this machine is
    a real remote share and passes through unchanged.
    """
    s = str(resolved)
    if not s.startswith("\\\\"):
        return resolved
    m = _ADMIN_SHARE_RE.match(s)
    if not m:
        return resolved
    if not _is_local_host(m.group("host")):
        return resolved
    share = m.group("share")
    rest = m.group("rest").lstrip("\\")
    if share.upper() == "ADMIN$":
        root = os.environ.get("SystemRoot", r"C:\Windows")
        mapped = f"{root}\\{rest}" if rest else root
    else:
        mapped = f"{share[0]}:\\{rest}"
    return Path(mapped).resolve()


def _canonicalize(path: Path | str) -> Path:
    """Resolve *path* and reject spellings that would defeat containment checks.

    Win32 accepts (and silently normalises away) an extended-length \\\\?\\
    prefix, a drive-relative spelling, and path components with a trailing
    space or dot -- any of which could make a path that is really inside a
    protected or sandboxed location look like it isn't, or vice versa.
    Path.resolve() absolutises a drive-relative or relative spelling before
    it can be rejected, so the absolute-input check below runs on the raw
    *path* first, ahead of any resolving.
    """
    p = Path(path)
    s = str(p)
    if not (p.is_absolute() and (p.drive or s.startswith("\\\\"))):
        raise BadPathError(f"Path must be absolute with a drive or UNC root: {path!r}")
    resolved = p.resolve()
    s = str(resolved)
    if s.startswith("\\\\?\\UNC\\"):
        stripped = Path("\\\\" + s[len("\\\\?\\UNC\\"):])
        if not (stripped.drive and stripped.root):
            raise BadPathError(f"Extended-length UNC path does not resolve to a UNC root: {s!r}")
        resolved = stripped.resolve()
    elif s.startswith("\\\\?\\"):
        stripped = Path(s[len("\\\\?\\"):])
        # A bogus non-drive spelling (e.g. \\?\Volume{guid}\...) strips down to
        # a relative-looking string; resolving that would silently reinterpret
        # it against the process's cwd instead of failing, so check first.
        if not (stripped.drive and stripped.root):
            raise BadPathError(f"Extended-length path does not resolve to a drive-rooted location: {s!r}")
        resolved = stripped.resolve()
    resolved = _map_loopback_admin_share(resolved)
    if not (resolved.drive and resolved.root):
        raise BadPathError(f"Path must be absolute with a drive: {path!r}")
    for part in resolved.parts[1:]:
        if part.endswith(" ") or part.endswith("."):
            raise BadPathError(
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
