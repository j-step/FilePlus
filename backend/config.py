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

# Backend HTTP port. Overriding this lets a second backend (e.g. scripts/verify.ps1's,
# which sets FILEPLUS_PORT=9877) run alongside a developer's already-running instance
# on the default 9876 without a bind conflict. frontend/main.js reads the same
# variable (or the same .env) so the Electron app's fetch() calls agree.
FILEPLUS_PORT = int(os.getenv("FILEPLUS_PORT", "9876"))

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
    r"^\\\\(?P<host>[^\\]+)\\(?P<share>[A-Za-z]\$|ADMIN\$)(?P<rest>$|[\\/].*)$", re.IGNORECASE
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
    lookup itself never returns. Any exception from the lookup (not just
    socket.gaierror -- a hostile or malformed host can trip other errors too)
    is swallowed the same way: a failed or inconclusive lookup just means "no
    addresses", never a crash.
    """
    out: list[str] = []

    def _do() -> None:
        try:
            out.extend(info[4][0] for info in socket.getaddrinfo(host, None))
        except Exception:
            pass

    t = threading.Thread(target=_do, daemon=True)
    t.start()
    t.join(timeout)
    return out


def _addr_is_local(addr: str, local_addrs: set[str]) -> bool:
    """True when *addr* (a literal IP string) is loopback or one of ours.

    Shared by the ipv6-literal decode path and the resolved-hostname path in
    _is_local_host. A malformed *addr* is never local -- it just fails to
    parse and this returns False, no exception escapes.
    """
    addr = addr.split("%")[0]  # strip an IPv6 zone id, if any
    try:
        parsed = ipaddress.ip_address(addr)
    except ValueError:
        return False
    if parsed.is_loopback:
        return True
    return addr.lower() in local_addrs or str(parsed).lower() in local_addrs


def _is_local_host(host: str) -> bool:
    """True when *host* (a UNC hostname) names this machine.

    Checked, cheapest first: the classic loopback names/our own
    COMPUTERNAME/hostname; the ``.ipv6-literal.net`` encoding Windows accepts
    for IPv6 UNC hosts (e.g. ``0--1.ipv6-literal.net`` for ``::1``) -- decoded
    (strip the suffix, ``-`` -> ``:``, ``s`` -> ``%`` for a zone id) and
    classified the same way any other address is, so a *foreign*
    ipv6-literal.net address (someone else's ``2001:db8::1``) is correctly
    NOT treated as local; and finally whether *host* resolves (bounded
    lookup) to a loopback address or one of our own interface addresses --
    catching a bare LAN IP or any other hostname for this same box.
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
    local_addrs = _local_interface_addresses()
    if h.endswith(".ipv6-literal.net"):
        stem = h[: -len(".ipv6-literal.net")]
        decoded = stem.replace("-", ":").replace("s", "%")
        return _addr_is_local(decoded, local_addrs)
    for addr in _resolve_host_addrs(host):
        if _addr_is_local(addr, local_addrs):
            return True
    return False


def _normalize_unc_separators(s: str) -> str:
    r"""Collapse duplicated path separators in *s*, preserving a UNC prefix.

    Windows treats "/" interchangeably with "\" and silently collapses a run
    of separators into one when it actually resolves a path -- so
    "//localhost//C$//Windows", "\\localhost\\C$\Windows" (a duplicated
    separator before the share) and "\\localhost\C$\Windows" are all exactly
    as much a loopback admin share as each other. _ADMIN_SHARE_RE only
    matches the canonical single-backslash form, so without this
    normalisation any of the duplicated-separator spellings would fail to
    match -- staying UNC straight through to is_under's string containment
    check against SYSTEM_WRITE_ROOTS (which never matches a UNC string
    against a local-drive root), bypassing write protection entirely.
    """
    starts_unc = bool(re.match(r"^[\\/]{2,}", s))
    collapsed = re.sub(r"[\\/]+", "\\\\", s)
    if starts_unc and not collapsed.startswith("\\\\"):
        collapsed = "\\" + collapsed
    return collapsed


def _map_loopback_admin_share(raw: str) -> str | None:
    """Map a local admin-share UNC spelling back to its local drive form.

    ``\\\\localhost\\C$\\Windows\\x``, ``\\\\<own LAN IP>\\C$\\...``,
    ``\\\\0--1.ipv6-literal.net\\C$\\...`` and ``\\\\<host>\\ADMIN$\\...`` are
    all just a local drive (or, for ADMIN$, %SystemRoot%) reached over the
    loopback network stack under a different name. Left as UNC, is_under's
    string containment check against SYSTEM_WRITE_ROOTS (local-drive paths)
    never matches, so any of these spellings would otherwise bypass write
    protection entirely when unlocked. A UNC host that isn't this machine is
    a real remote share and this returns None, unchanged.

    Takes and returns a plain (not-yet-resolved) string, on purpose: this
    check -- and thus the _is_local_host lookup it depends on -- must run
    BEFORE Path.resolve() ever sees a UNC path. Resolving a UNC path opens an
    SMB session, which can take on the order of 20s to fail against an
    unroutable or firewalled host -- including this machine's own LAN
    address if SMB is blocked. Detecting "this is actually me" first lets
    the caller resolve only the (fast, local) mapped drive path instead.
    """
    if not raw.startswith(("\\\\", "//")):
        return None
    normalized = _normalize_unc_separators(raw)
    m = _ADMIN_SHARE_RE.match(normalized)
    if not m:
        return None
    if not _is_local_host(m.group("host")):
        return None
    share = m.group("share")
    rest = m.group("rest").lstrip("\\")
    if share.upper() == "ADMIN$":
        root = os.environ.get("SystemRoot", r"C:\Windows")
        return f"{root}\\{rest}" if rest else root
    return f"{share[0]}:\\{rest}"


def _strip_extended_length_prefix(s: str) -> str:
    r"""Strip a \\?\ or \\?\UNC\ extended-length prefix from *s*.

    Runs on the raw string, ahead of any resolving -- see _canonicalize.
    Raises BadPathError if what's left doesn't already look like a proper
    drive- or UNC-rooted path: a bogus non-drive spelling (e.g.
    ``\\?\Volume{guid}\...``) would otherwise strip down to a
    relative-looking string that Path.resolve() would silently reinterpret
    against the process's cwd instead of failing.
    """
    unc_prefix = "\\\\?\\UNC\\"
    ext_prefix = "\\\\?\\"
    if s[:len(unc_prefix)].upper() == unc_prefix.upper():
        stripped = "\\\\" + s[len(unc_prefix):]
        if not (Path(stripped).drive and Path(stripped).root):
            raise BadPathError(f"Extended-length UNC path does not resolve to a UNC root: {s!r}")
        return stripped
    if s.startswith(ext_prefix):
        stripped = s[len(ext_prefix):]
        if not (Path(stripped).drive and Path(stripped).root):
            raise BadPathError(f"Extended-length path does not resolve to a drive-rooted location: {s!r}")
        return stripped
    return s


def _strip_resolved_extended_length_prefix(s: str) -> Path:
    r"""Undo the same \\?\ / \\?\UNC\ prefixes on an already-resolved string.

    Path.resolve() reproduces a \\?\ prefix in its output whenever one was
    present in its input (verified empirically; a plain drive or UNC
    spelling resolves back to a plain drive or UNC spelling). Since the
    prefix is already stripped from the string handed to resolve() in
    _canonicalize, this is just cheap defence in depth -- a plain
    Path(...) construction, never another resolve() call (which would
    reopen the door to the same slow-UNC-resolve problem this whole
    reordering exists to avoid).
    """
    unc_prefix = "\\\\?\\UNC\\"
    ext_prefix = "\\\\?\\"
    if s[:len(unc_prefix)].upper() == unc_prefix.upper():
        return Path("\\\\" + s[len(unc_prefix):])
    if s.startswith(ext_prefix):
        return Path(s[len(ext_prefix):])
    return Path(s)


def _canonicalize(path: Path | str) -> Path:
    r"""Resolve *path* and reject spellings that would defeat containment checks.

    Win32 accepts (and silently normalises away) an extended-length \\?\
    prefix, a drive-relative spelling, and path components with a trailing
    space or dot -- any of which could make a path that is really inside a
    protected or sandboxed location look like it isn't, or vice versa.
    Path.resolve() absolutises a drive-relative or relative spelling before
    it can be rejected, so the absolute-input check below runs on the raw
    *path* first, ahead of any resolving.

    Everything else -- the \\?\ prefix strip, the loopback admin-share
    mapping, and the trailing space/dot check -- also runs on the raw string
    before any resolving, for the same reason: Path.resolve() on a UNC path
    opens an SMB session, which can hang for ~20s against an unroutable host.
    A loopback admin share (this machine, reached via \\localhost\C$\... or
    similar) is mapped to its local drive form first so only that local path
    is ever resolved; a genuine non-loopback UNC path still resolves here
    exactly as before.
    """
    p = Path(path)
    s = str(p)
    if not (p.is_absolute() and (p.drive or s.startswith("\\\\"))):
        raise BadPathError(f"Path must be absolute with a drive or UNC root: {path!r}")

    s = _strip_extended_length_prefix(s)

    mapped = _map_loopback_admin_share(s)
    if mapped is not None:
        s = mapped

    for part in Path(s).parts[1:]:
        if part in (".", ".."):
            continue  # a legitimate navigation component, not an evasive spelling
        if part.endswith(" ") or part.endswith("."):
            raise BadPathError(
                f"Path component {part!r} ends with a space or a dot; Windows accepts "
                f"that spelling but normalises it away, which would defeat containment "
                f"checks: {s}"
            )

    resolved = _strip_resolved_extended_length_prefix(str(Path(s).resolve()))
    if not (resolved.drive and resolved.root):
        raise BadPathError(f"Path must be absolute with a drive: {path!r}")

    # Defence in depth: if the input didn't parse as a loopback admin share
    # pre-resolve (e.g. some other separator pathology not anticipated
    # above), but resolve() nonetheless produced a UNC string, try the
    # admin-share mapping once more against the now-canonical form. Only the
    # (local, fast) mapped path is ever resolved again here -- never a
    # second resolve() of a UNC string, which is the whole slow-SMB problem
    # this function exists to avoid.
    rs = str(resolved)
    if rs.startswith("\\\\"):
        remapped = _map_loopback_admin_share(rs)
        if remapped is not None:
            resolved = Path(remapped).resolve()

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
