"""path_guard: reads anywhere; writes sandboxed until WRITE_UNLOCKED; system roots never."""
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
# Task 0 -- Stage 2A audit item (2): loopback admin-share UNC spellings
# (\\localhost\C$\..., \\127.0.0.1\C$\..., \\<COMPUTERNAME>\C$\...) resolve
# to UNC form and used to bypass SYSTEM_WRITE_ROOTS string containment when
# unlocked, since containment compared local-drive roots against a UNC
# string. They must be mapped back to their local drive spelling before
# containment checks run.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "LOCALHOST"])
def test_loopback_admin_share_maps_to_protected_local_drive(host, monkeypatch):
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [Path("C:/Windows")])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [Path("C:/Windows")])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(f"\\\\{host}\\C$\\Windows\\x", "write")


def test_loopback_admin_share_by_computername(monkeypatch):
    import os
    computername = os.environ.get("COMPUTERNAME", "TESTHOST")
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [Path("C:/Windows")])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [Path("C:/Windows")])
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    with pytest.raises(ProtectedPathError):
        path_guard(f"\\\\{computername}\\C$\\Windows\\x", "write")


def test_normal_unc_host_is_not_remapped(sandbox):
    # A non-loopback UNC host is never a local admin share in disguise; it's
    # refused by the ordinary out-of-sandbox rule like any other outside path.
    with pytest.raises(OutOfSandboxError):
        path_guard(r"\\fileserver\share\x", "write")
