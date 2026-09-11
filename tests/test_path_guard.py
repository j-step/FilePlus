"""path_guard: reads anywhere; writes sandboxed until WRITE_UNLOCKED; system roots never."""
import os
import socket
from pathlib import Path

import psutil
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

def _first_non_loopback_ipv4() -> str | None:
    for addrs in psutil.net_if_addrs().values():
        for a in addrs:
            if a.family == socket.AF_INET and not a.address.startswith("127."):
                return a.address
    return None


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
    ip = _first_non_loopback_ipv4()
    if ip is None:
        pytest.skip("no non-loopback IPv4 interface on this machine")
    system_root = Path(os.environ["SystemRoot"])
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [system_root])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(f"\\\\{ip}\\C$\\Windows\\x", "write")


def test_normal_unc_host_is_not_remapped(sandbox):
    # A non-loopback, non-local UNC host is never a local admin share in
    # disguise; it's refused by the ordinary out-of-sandbox rule like any
    # other outside path. ".invalid" (RFC 2606) can never resolve, so this
    # never triggers a real (and possibly slow/hanging) DNS lookup.
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
