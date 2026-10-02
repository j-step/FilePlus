"""FilePlus configuration — loads env vars from .env and owns the write guard.

path_guard(path, mode) is the single gate for filesystem access:
  read  — any path (browsing real drives is the product).
  write — inside FILEPLUS_SANDBOX_PATH (alias FILEPLUS_ROOT) only, unless
          FILEPLUS_ENV=prod AND WRITE_UNLOCKED=true; Windows system roots are
          never writable, and the FilePlus app directory is never writable
          except the sandbox inside it.

Write-mode containment order (see _enforce_write_containment): (1) any
SYSTEM_WRITE_ROOTS entry wins unconditionally -> ProtectedPathError; (2) the
sandbox is allowed; (3) any other PROTECTED_WRITE_ROOTS entry (the app dir, or
a test-injected root) -> ProtectedPathError; (4) writes_unlocked() -- prod
env and WRITE_UNLOCKED -- -> allowed, else OutOfSandboxError. In the dev and
test environments step (4) can never pass: tests and dev runs cannot touch
anything outside the root, whatever .env says.

path_guard always returns the *resolved* path, which follows junctions and
symlinks. Callers that are about to mutate the path itself (rename/move/trash)
use guard_operand instead: same containment decisions on the resolved path,
but the operand returned is the link's own spelling when the input is a
reparse point, so the link is what moves -- never its target.
"""
from dotenv import load_dotenv
import ipaddress
import os
import re
import secrets
import socket
import threading
from pathlib import Path

import psutil

load_dotenv()


class OutOfSandboxError(Exception):
    """Raised for a write outside the sandbox root unless writes_unlocked()."""


class ProtectedPathError(Exception):
    """Raised for a write under a protected system root, regardless of unlock state."""


class BadPathError(ValueError):
    """Raised for an input spelling _canonicalize refuses outright (not absolute,
    no drive/UNC root, or a component that would be silently normalised away)."""


FILEPLUS_APP_DIR = Path(__file__).resolve().parents[1]


# FILEPLUS_ENV: dev (default) | test | prod. Only prod can ever write outside
# the root (and only with WRITE_UNLOCKED=true as well) -- see writes_unlocked().
FILEPLUS_ENVS = ("dev", "test", "prod")
FILEPLUS_ENV = os.getenv("FILEPLUS_ENV", "dev").strip().lower() or "dev"
if FILEPLUS_ENV not in FILEPLUS_ENVS:
    raise ValueError(f"FILEPLUS_ENV must be one of {', '.join(FILEPLUS_ENVS)}; got {FILEPLUS_ENV!r}")


def _root_from_env() -> Path:
    """The one filesystem root the app may write into. FILEPLUS_ROOT and
    FILEPLUS_SANDBOX_PATH are two names for the same setting (FILEPLUS_ROOT is
    the dev-harness name); setting both to different places is refused rather
    than silently picking one."""
    root = os.getenv("FILEPLUS_ROOT", "").strip()
    sandbox = os.getenv("FILEPLUS_SANDBOX_PATH", "").strip()
    if root and sandbox and os.path.normcase(os.path.abspath(root)) != os.path.normcase(os.path.abspath(sandbox)):
        raise ValueError(f"FILEPLUS_ROOT ({root}) and FILEPLUS_SANDBOX_PATH ({sandbox}) disagree; set only one")
    return Path(root or sandbox or str(FILEPLUS_APP_DIR / "FilePlusTestSandbox"))


FILEPLUS_SANDBOX_PATH = _root_from_env()
FILEPLUS_DB_PATH = Path(os.getenv("FILEPLUS_DB_PATH", str(FILEPLUS_APP_DIR / "fileplus.db")))
FILEPLUS_EVERYTHING_PATH = Path(os.getenv("FILEPLUS_EVERYTHING_PATH", r"C:\Everything"))
# Where backend.log lives (backend/logging_setup.py). frontend/main.js reads the
# same variable for main.log and renderer.log, so one setting moves all three;
# the test harness points it at artifacts/logs so a test run never wipes the
# log of a dev session someone is reporting a bug from.
FILEPLUS_LOG_DIR = Path(os.getenv("FILEPLUS_LOG_DIR", str(FILEPLUS_APP_DIR / "logs")))

# Backend HTTP port. Overriding this lets a second backend (e.g. scripts/verify.ps1's,
# which sets FILEPLUS_PORT=9877) run alongside a developer's already-running instance
# on the default 9876 without a bind conflict. frontend/main.js reads the same
# variable (or the same .env) so the Electron app's fetch() calls agree.
FILEPLUS_PORT = int(os.getenv("FILEPLUS_PORT", "9876"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
# Every route except /health (and CORS preflight) requires header
# X-FilePlus-Token. When FILEPLUS_API_TOKEN is unset the backend mints one at
# startup (see ensure_api_token) and persists it in FILEPLUS_TOKEN_FILE, which
# frontend/main.js reads as its last fallback -- so auth is never off.
FILEPLUS_API_TOKEN = os.getenv("FILEPLUS_API_TOKEN", "")
FILEPLUS_TOKEN_FILE = Path(os.getenv("FILEPLUS_TOKEN_FILE", str(FILEPLUS_APP_DIR / ".fileplus-token")))
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

# Decision D2: writes stay in the sandbox until the author flips this -- and
# only a prod environment honours it (writes_unlocked()).
WRITE_UNLOCKED = os.getenv("WRITE_UNLOCKED", "false").lower() == "true"

AUTO_SORT_ENABLED = os.getenv("AUTO_SORT_ENABLED", "false").lower() == "true"
AUTO_SORT_CONFIDENCE_THRESHOLD = float(os.getenv("AUTO_SORT_CONFIDENCE_THRESHOLD", "0.85"))
MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", "100"))

TRASH_DIRNAME = ".FilePlusTrash"
LISTING_CAP = 10_000

# GetFileAttributes bit for a junction/symlink (winnt.h FILE_ATTRIBUTE_REPARSE_POINT).
FILE_ATTRIBUTE_REPARSE_POINT = 0x400


def ensure_api_token() -> str:
    """Return the effective API token, minting and persisting one when unset.

    FILEPLUS_API_TOKEN from the environment/.env always wins (that is how
    scripts/verify.ps1 and a packaged launcher pin a shared value). Otherwise
    the token is read from FILEPLUS_TOKEN_FILE, or freshly minted with
    secrets.token_hex(32) and written there with owner-only permissions
    (0o600 via os.open; on Windows the file also inherits the user profile's
    ACL). It is reused across restarts on purpose: frontend/main.js resolves
    the token as env -> .env -> this file, and a token that changed on every
    backend restart would leave an already-running renderer holding a stale
    one.

    Called once from the API's lifespan startup, never at import time -- so
    importing backend.config never writes to disk.
    """
    if FILEPLUS_API_TOKEN:
        return FILEPLUS_API_TOKEN
    try:
        existing = FILEPLUS_TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        existing = ""
    if existing:
        return existing
    token = secrets.token_hex(32)
    try:
        FILEPLUS_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(FILEPLUS_TOKEN_FILE), os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(token + "\n")
    except OSError:
        # A token that can't be persisted still protects this process; the
        # renderer then has to get it from the environment instead.
        pass
    return token


def is_reparse_point(path: Path | str) -> bool:
    """True when *path* is itself a junction or symlink (never followed).

    os.lstat does not follow the final component, so this answers for the
    link, not its target. Anything that can't be stat'ed (gone, denied, or a
    platform without st_file_attributes) is reported as not a reparse point.
    """
    try:
        st = os.lstat(str(path))
    except (OSError, ValueError):
        return False
    return bool(getattr(st, "st_file_attributes", 0) & FILE_ATTRIBUTE_REPARSE_POINT)


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


def _sanitize_input(path: Path | str) -> str:
    r"""Everything _canonicalize does *before* resolving: reject a
    non-absolute spelling, strip an extended-length prefix, map a loopback
    admin share to its local drive form, and refuse a component with a
    trailing space or dot. Split out so the lexical (unresolved) spelling of
    an input can be derived through exactly the same validation as the
    resolved one (see lexical_path / guard_operand).
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
    return s


def lexical_path(path: Path | str) -> Path:
    """The input's own absolute spelling, normalised but never resolved.

    Same validation as _canonicalize (via _sanitize_input) and the same
    '..'/separator collapsing, but no symlink/junction following -- so a
    junction stays the junction rather than becoming its target.
    """
    return Path(os.path.normpath(_sanitize_input(path)))


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
    s = _sanitize_input(path)

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


def writes_unlocked() -> bool:
    """True only when writes outside the root are allowed: FILEPLUS_ENV=prod
    AND WRITE_UNLOCKED=true. Read at call time so tests can monkeypatch
    either value."""
    return FILEPLUS_ENV == "prod" and WRITE_UNLOCKED


def _enforce_write_containment(resolved: Path) -> None:
    """Raise unless *resolved* is writable. See the module docstring's order.

    Split out of path_guard so guard_operand can apply the exact same
    containment rules to a second spelling of the same path (the link's own,
    unresolved one).
    """
    for root in SYSTEM_WRITE_ROOTS:
        if is_under(resolved, root):
            raise ProtectedPathError(f"'{resolved}' is inside the protected Windows system location '{root}'; FilePlus never writes there.")
    if is_under(resolved, FILEPLUS_SANDBOX_PATH):
        return  # the sandbox is always writable, even inside the app dir
    for root in PROTECTED_WRITE_ROOTS:
        if is_under(resolved, root):
            raise ProtectedPathError(f"'{resolved}' is inside the protected location '{root}'; FilePlus never writes there.")
    if not writes_unlocked():
        why = (f"FILEPLUS_ENV={FILEPLUS_ENV}; only prod can write outside the root" if FILEPLUS_ENV != "prod"
               else "WRITE_UNLOCKED=false")
        raise OutOfSandboxError(
            f"Writes are locked to the sandbox '{FILEPLUS_SANDBOX_PATH}' ({why}; WRITE_UNLOCKED applies in prod only); refused '{resolved}'."
        )


def path_guard(path: Path | str, mode: str = "read") -> Path:
    """Return the resolved path or raise. See module docstring."""
    resolved = _canonicalize(path)
    if mode == "read":
        return resolved
    if mode != "write":
        raise ValueError(f"path_guard mode must be 'read' or 'write', got {mode!r}")
    _enforce_write_containment(resolved)
    return resolved


def guard_operand(path: Path | str, mode: str = "write") -> Path:
    r"""Guard *path* and return the path a filesystem call should act *on*.

    Containment and protection decisions are always made on the fully
    resolved path (path_guard), so a junction pointing at C:\Windows is
    refused exactly as C:\Windows itself would be. The operand handed back,
    however, is the input's own lexical spelling whenever that input is a
    reparse point -- because the user asked to delete/move/rename the link
    they can see, not the directory it happens to point at. The link's own
    location must pass the same write containment check, so a junction
    outside the sandbox can't be renamed just because its target is inside.

    For every ordinary path (no reparse point anywhere in it, so the lexical
    and resolved spellings agree) this returns exactly what path_guard does.
    """
    resolved = path_guard(path, mode)
    lexical = lexical_path(path)
    if os.path.normcase(str(lexical)) == os.path.normcase(str(resolved)):
        return resolved
    if not is_reparse_point(lexical):
        return resolved  # an 8.3 name, a resolved parent symlink, a UNC remap: keep the resolved form
    if mode == "write":
        _enforce_write_containment(lexical)
    return lexical
