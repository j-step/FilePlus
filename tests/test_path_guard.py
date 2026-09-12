"""path_guard: reads anywhere; writes sandboxed until WRITE_UNLOCKED; system roots never."""
import os
import socket
import time
from pathlib import Path

import pytest

import backend.config as _config
from backend.config import path_guard, OutOfSandboxError, ProtectedPathError, BadPathError


def test_read_allows_any_path(sandbox, tmp_path):
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    assert path_guard(outside, "read") == outside.resolve()
    assert path_guard(Path("C:/Windows"), "read") == Path("C:/Windows").resolve()


def test_write_inside_sandbox_allowed_when_locked(sandbox):
    target = sandbox / "a" / "b.txt"
    assert path_guard(target, "write") == target.resolve()


def test_write_outside_sandbox_refused_when_locked(sandbox, tmp_path):
    outside = tmp_path / "elsewhere" / "x.txt"
    with pytest.raises(OutOfSandboxError) as e:
        path_guard(outside, "write")
    assert "WRITE_UNLOCKED" in str(e.value)


def test_write_outside_sandbox_allowed_when_unlocked(sandbox, tmp_path, monkeypatch):
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    outside = tmp_path / "elsewhere" / "x.txt"
    assert path_guard(outside, "write") == outside.resolve()


def test_protected_roots_refused_even_when_unlocked(sandbox, tmp_path, monkeypatch):
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    fake_windows = tmp_path / "Windows"
    fake_windows.mkdir()
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [fake_windows])
    with pytest.raises(ProtectedPathError):
        path_guard(fake_windows / "System32" / "evil.dll", "write")


def test_sandbox_inside_protected_app_dir_is_still_writable(sandbox, monkeypatch):
    # The sandbox lives inside the repo, which is itself a protected root.
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [sandbox.parent])
    assert path_guard(sandbox / "ok.txt", "write") == (sandbox / "ok.txt").resolve()


def test_case_insensitive_containment(sandbox):
    upper = Path(str(sandbox).upper()) / "F.TXT"
    assert path_guard(upper, "write")  # no exception


def test_unknown_mode_rejected(sandbox):
    with pytest.raises(ValueError):
        path_guard(sandbox / "x", "delete")


# ---------------------------------------------------------------------------
# C1 -- canonicalisation: strip \\?\ prefixes, refuse drive-relative paths and
# components that end with a space or a dot (Win32 accepts these spellings
# but silently normalises them away, which would defeat containment checks).
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("spelling", [
    "{win} \\evil",           # trailing space on a path component
    "\\\\?\\{win}\\evil",     # extended-length prefix
    "{win}.\\evil",           # trailing dot on a path component
])
def test_evasive_spellings_never_return_write(tmp_path, monkeypatch, spelling):
    win = tmp_path / "Win"
    win.mkdir()
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [win])
    candidate = spelling.format(win=str(win))
    with pytest.raises((ProtectedPathError, ValueError)):
        path_guard(candidate, "write")


def test_extended_length_prefix_canonicalised_inside_sandbox(sandbox):
    candidate = "\\\\?\\" + str(sandbox / "ok.txt")
    assert path_guard(candidate, "write") == (sandbox / "ok.txt").resolve()


def test_is_under_drive_root():
    assert _config.is_under(Path("C:/Windows/x"), Path("C:/")) is True


# ---------------------------------------------------------------------------
# I4 -- guard ordering: SYSTEM_WRITE_ROOTS win even over the sandbox exemption.
# ---------------------------------------------------------------------------

def test_system_root_wins_even_inside_sandbox(tmp_path, monkeypatch):
    win = tmp_path / "Win"
    win.mkdir()
    sandbox_dir = win / "sb"
    sandbox_dir.mkdir()
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [win])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [win])
    monkeypatch.setattr(_config, "FILEPLUS_SANDBOX_PATH", sandbox_dir)
    with pytest.raises(ProtectedPathError):
        path_guard(sandbox_dir / "x.txt", "write")


# ---------------------------------------------------------------------------
# Task 0 -- Stage 2A audit item (1): the absolute-input check was dead code
# because Path.resolve() absolutises a drive-relative or relative spelling
# before it can be rejected. Reject it up front, in both modes, before any
# resolving happens.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("spelling", ["C:foo", "foo"])
def test_drive_relative_and_relative_paths_refused_in_both_modes(spelling):
    with pytest.raises(BadPathError):
        path_guard(spelling, "read")
    with pytest.raises(BadPathError):
        path_guard(spelling, "write")


# ---------------------------------------------------------------------------
# Task 0 -- Stage 2A audit item (2), fix round: loopback admin-share UNC
# spellings resolve to UNC form and used to bypass SYSTEM_WRITE_ROOTS string
# containment when unlocked, since containment compared local-drive roots
# against a UNC string. They must be mapped back to their local drive
# spelling before containment checks run. "This host is me" is decided
# dynamically (named loopback hosts, our own hostname/COMPUTERNAME, the
# ipv6-literal.net encoding, or a resolved address that is loopback or one
# of our own interface addresses) -- not just a fixed string list -- so an
# IP-literal or ipv6-literal.net spelling of the same local box is caught
# too. ADMIN$ (-> %SystemRoot%) is mapped alongside the single-drive-letter
# form (C$, D$, ...).
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "LOCALHOST"])
def test_loopback_admin_share_maps_to_protected_local_drive(host, monkeypatch):
    system_root = Path(os.environ["SystemRoot"])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(f"\\\\{host}\\C$\\Windows\\x", "write")


def test_loopback_admin_share_by_computername(monkeypatch):
    computername = os.environ.get("COMPUTERNAME")
    if not computername:
        pytest.skip("COMPUTERNAME is not set in this environment")
    system_root = Path(os.environ["SystemRoot"])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(f"\\\\{computername}\\C$\\Windows\\x", "write")


def test_admin_dollar_share_maps_to_systemroot(monkeypatch):
    system_root = Path(os.environ["SystemRoot"])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(r"\\localhost\ADMIN$\System32\x", "write")


def test_ipv6_literal_loopback_admin_share(monkeypatch):
    # "0--1.ipv6-literal.net" is Windows' NetBIOS-safe encoding of ::1
    # ("-" stands in for ":") -- a real spelling `net use` accepts for the
    # local machine over the loopback stack.
    system_root = Path(os.environ["SystemRoot"])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(r"\\0--1.ipv6-literal.net\C$\Windows\x", "write")


def test_own_lan_ip_admin_share(monkeypatch):
    # Deterministic version of the old real-network-probing test (Task 8a
    # item 5): a real machine may have zero non-loopback IPv4 interfaces (so
    # the old test could only skip), and probing psutil.net_if_addrs() for a
    # real address made the test's outcome depend on this machine's network
    # config. Monkeypatching _local_interface_addresses -- the one thing
    # _is_local_host consults for a bare-IP match -- exercises the exact
    # same "this LAN IP is one of ours" code path without touching the real
    # network at all. 203.0.113.5 is TEST-NET-3 (RFC 5737): guaranteed never
    # a real interface address, so it can never accidentally match for a
    # reason other than the monkeypatch.
    fake_lan_ip = "203.0.113.5"
    monkeypatch.setattr(_config, "_local_interface_addresses", lambda: {fake_lan_ip})
    system_root = Path(os.environ["SystemRoot"])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(f"\\\\{fake_lan_ip}\\C$\\Windows\\x", "write")


def test_normal_unc_host_is_not_remapped(sandbox, monkeypatch):
    # A non-loopback, non-local UNC host is never a local admin share in
    # disguise; it's refused by the ordinary out-of-sandbox rule like any
    # other outside path. ".invalid" (RFC 2606) can never resolve, so this
    # never triggers a real (and possibly slow/hanging) DNS lookup -- but
    # this test doesn't rely on that alone: _resolve_host_addrs is
    # monkeypatched to guarantee no test in this suite ever touches a real
    # resolver, regardless of which code path might call it.
    monkeypatch.setattr(_config, "_resolve_host_addrs", lambda host, timeout=2.0: [])
    with pytest.raises(OutOfSandboxError):
        path_guard(r"\\fileserver.invalid\share\x", "write")


# ---------------------------------------------------------------------------
# Task 0 fix round -- minor: after stripping an extended-length \\?\ prefix,
# the *stripped* spelling must already be a drive- or UNC-rooted absolute
# path. Without this check, a bogus \\?\Volume{GUID}\... device path (not a
# drive letter, not UNC) strips down to a relative-looking string that
# Path.resolve() then silently reinterprets against the process's cwd,
# producing some unrelated absolute path instead of failing.
# ---------------------------------------------------------------------------

def test_bogus_volume_guid_extended_path_is_rejected(sandbox):
    with pytest.raises(BadPathError):
        path_guard(r"\\?\Volume{bogus}\Windows\x", "write")


# ---------------------------------------------------------------------------
# Task 8a, fix round 1 [Critical] -- _map_loopback_admin_share matches the
# raw string with _ADMIN_SHARE_RE, which requires a single canonical
# backslash between segments. A spelling with duplicated separators (any mix
# of "\" and "/") is exactly as much a loopback admin share as the canonical
# form -- Windows itself collapses these when it actually resolves a path --
# but would fail to match, leaving the path UNC straight through
# Path.resolve() (which does NOT collapse a duplicated separator back into
# the canonical form for a host it can't reach) and out the other side of
# _canonicalize still as a UNC string. is_under's string containment check
# against SYSTEM_WRITE_ROOTS (local-drive paths) then never matches a UNC
# string, so all four spellings below used to sail straight through
# ProtectedPathError while write-unlocked. All four must canonicalize to the
# exact same local path as the canonical single-separator spelling and be
# refused.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("spelling", [
    r"\\localhost\C$\Windows\evil.txt",          # canonical (baseline control)
    "\\\\localhost\\\\C$\\Windows\\evil.txt",     # duplicated separator before the share
    "//localhost//C$//Windows//evil.txt",         # forward slashes, duplicated throughout
    "\\\\?\\UNC\\localhost\\\\C$\\Windows\\evil.txt",  # extended-length UNC + duplicated separator
])
def test_duplicated_separator_admin_share_spellings_still_blocked(spelling, monkeypatch):
    system_root = Path(os.environ["SystemRoot"])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(spelling, "write")


def test_map_loopback_admin_share_defence_in_depth_after_resolve(monkeypatch):
    # A UNC string that _map_loopback_admin_share's pre-resolve check somehow
    # missed, but that Path.resolve() nonetheless produces (or leaves)
    # exactly as a loopback admin share, is caught by the post-resolve
    # re-check in _canonicalize. Simulated here by monkeypatching
    # _map_loopback_admin_share itself to refuse the pre-resolve string but
    # accept the resolved one, so this test doesn't depend on inventing a
    # real spelling the pre-resolve normalisation can't already handle.
    real_map = _config._map_loopback_admin_share
    calls = []

    def spy_map(raw):
        calls.append(raw)
        if len(calls) == 1:
            return None  # pretend the pre-resolve attempt found nothing
        return real_map(raw)

    monkeypatch.setattr(_config, "_map_loopback_admin_share", spy_map)
    system_root = Path(os.environ["SystemRoot"])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(r"\\localhost\C$\Windows\evil.txt", "write")
    assert len(calls) == 2, "the post-resolve defence-in-depth re-check must have run"


# ---------------------------------------------------------------------------
# Task 8a, fix round 1 [Minor] -- _ADMIN_SHARE_RE's rest group was `.*`, so a
# share name that merely starts with "C$"/"ADMIN$" but isn't actually that
# share (e.g. a real remote share literally named "C$foo") got misparsed as
# the admin share with a mangled rest, mapping to the wrong local path
# entirely. The rest group must require either end-of-string or an actual
# path separator right after the share token.
# ---------------------------------------------------------------------------

def test_non_admin_share_that_merely_starts_with_dollar_is_not_remapped():
    assert _config._map_loopback_admin_share(r"\\localhost\C$foo\bar") is None
    assert _config._map_loopback_admin_share(r"\\localhost\ADMIN$x\y") is None


# ---------------------------------------------------------------------------
# Task 8a, fix round 1 [Important] -- the trailing space/dot component check
# now runs pre-resolve, so it must not misfire on a legitimate "." or ".."
# navigation component (which doesn't end with a space or a dot as an
# *evasive* spelling -- it just literally is ".." or ".").
# ---------------------------------------------------------------------------

def test_dotdot_component_is_not_rejected_and_resolves_normally(sandbox):
    base = Path(os.environ["SystemRoot"]).parent / "Users" / "x"
    assert _config._canonicalize(r"C:\Users\x\..\x") == base.resolve()


# ---------------------------------------------------------------------------
# Task 8a, fix round 1 [Minor] -- \\?\UNC\ must be recognised case-
# insensitively; Windows itself doesn't care about the case of that literal
# token, and \\?\unc\... previously fell into the plain \\?\ branch, stripped
# to a bare "unc\server\share\x" (neither drive- nor UNC-rooted), and was
# wrongly rejected with BadPathError.
# ---------------------------------------------------------------------------

def test_extended_length_unc_prefix_is_case_insensitive(monkeypatch):
    system_root = Path(os.environ["SystemRoot"])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard("\\\\?\\unc\\localhost\\C$\\Windows\\evil.txt", "write")


# ---------------------------------------------------------------------------
# Task 8a item (1) -- guard resolve order: the loopback admin-share mapping
# (and the \\?\ prefix strip / trailing space-or-dot check) must run on the
# raw string before Path.resolve() ever sees a UNC form. Resolving a UNC path
# opens an SMB session, which can take ~20s to fail against an unroutable or
# firewalled host -- including this machine's own LAN address. Proven here by
# recording every Path.resolve() call's argument and asserting none of them
# is a UNC (``\\...``) spelling for a loopback admin share.
# ---------------------------------------------------------------------------

def test_loopback_admin_share_resolve_never_sees_unc_form(monkeypatch):
    calls = []
    real_resolve = Path.resolve

    def spy_resolve(self, *a, **kw):
        calls.append(str(self))
        return real_resolve(self, *a, **kw)

    monkeypatch.setattr(Path, "resolve", spy_resolve)
    resolved = path_guard(r"\\localhost\C$\Windows\x", "read")
    assert resolved == (Path(os.environ["SystemRoot"]) / "x").resolve()
    unc_calls = [c for c in calls if c.startswith("\\\\")]
    assert unc_calls == [], f"Path.resolve() was called on a UNC form: {unc_calls}"


def test_loopback_admin_share_by_own_lan_ip_resolve_never_sees_unc_form(monkeypatch):
    # Same proof, but for the "bare LAN IP" path through _is_local_host (as
    # opposed to the "named loopback host" short-circuit above) -- this is
    # the exact case that could stall for ~20s before this reordering, since
    # _is_local_host itself has to run (a bounded getaddrinfo/interface
    # check) before the admin-share mapping is known, and the old code
    # called resolve() on the raw UNC path before ever reaching that check.
    fake_lan_ip = "203.0.113.5"
    monkeypatch.setattr(_config, "_local_interface_addresses", lambda: {fake_lan_ip})
    calls = []
    real_resolve = Path.resolve

    def spy_resolve(self, *a, **kw):
        calls.append(str(self))
        return real_resolve(self, *a, **kw)

    monkeypatch.setattr(Path, "resolve", spy_resolve)
    resolved = path_guard(f"\\\\{fake_lan_ip}\\C$\\Windows\\x", "read")
    assert resolved == (Path(os.environ["SystemRoot"]) / "x").resolve()
    unc_calls = [c for c in calls if c.startswith("\\\\")]
    assert unc_calls == [], f"Path.resolve() was called on a UNC form: {unc_calls}"


# ---------------------------------------------------------------------------
# Task 8a item (2) -- ipv6-literal.net decoding: the old blanket
# ``endswith(".ipv6-literal.net")`` match treated ANY ipv6-literal.net host
# as local, including a foreign address. Decode (strip suffix, "-" -> ":",
# "s" -> "%") and classify like any other address instead.
# ---------------------------------------------------------------------------

def test_ipv6_literal_loopback_is_local():
    assert _config._is_local_host("0--1.ipv6-literal.net") is True


def test_ipv6_literal_foreign_address_is_not_local():
    # 2001:db8::1 is the documentation/example prefix (RFC 3849) -- never
    # loopback, never one of our own interface addresses.
    assert _config._is_local_host("2001-db8--1.ipv6-literal.net") is False


def test_ipv6_literal_malformed_is_not_local_and_does_not_raise():
    assert _config._is_local_host("not-a-real-address.ipv6-literal.net") is False


def test_ipv6_literal_own_interface_address_is_local(monkeypatch):
    # A non-loopback IPv6 interface address of ours, spelled the
    # ipv6-literal.net way, is local -- not just the hardcoded loopback case.
    monkeypatch.setattr(_config, "_local_interface_addresses", lambda: {"2001:db8::1"})
    assert _config._is_local_host("2001-db8--1.ipv6-literal.net") is True


# ---------------------------------------------------------------------------
# Task 8a item (3) -- lookup thread robustness: the bounded getaddrinfo
# thread must swallow any exception (not just socket.gaierror) and must
# never block path_guard longer than its timeout.
# ---------------------------------------------------------------------------

def test_resolve_host_addrs_swallows_non_oserror_exception(monkeypatch):
    def boom(host, port):
        raise ValueError("not actually a socket error, but must not escape")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    assert _config._resolve_host_addrs("whatever", timeout=1.0) == []


def test_resolve_host_addrs_is_bounded_by_timeout(monkeypatch):
    def slow(host, port):
        time.sleep(2.0)
        return [(socket.AF_INET, None, None, "", ("127.0.0.1", 0))]

    monkeypatch.setattr(socket, "getaddrinfo", slow)
    start = time.time()
    result = _config._resolve_host_addrs("whatever", timeout=0.1)
    elapsed = time.time() - start
    assert result == []
    assert elapsed < 1.0, f"_resolve_host_addrs did not honour its timeout: {elapsed}s"


def test_is_local_host_never_hangs_on_a_slow_lookup(monkeypatch):
    # _is_local_host calls _resolve_host_addrs at its default 2.0s bound
    # (unlike the two tests above, which pass an explicit short timeout), so
    # this asserts it's bounded by *that* default, not left to hang
    # indefinitely against a lookup that never returns in time.
    def slow(host, port):
        time.sleep(5.0)
        raise OSError("simulated hang-then-fail")

    monkeypatch.setattr(socket, "getaddrinfo", slow)
    start = time.time()
    assert _config._is_local_host("some-unresolvable-host.example") is False
    assert time.time() - start < 3.0
