"""path_guard: reads anywhere; writes sandboxed until WRITE_UNLOCKED; system roots never."""
from pathlib import Path
import pytest

import backend.config as _config
from backend.config import path_guard, OutOfSandboxError, ProtectedPathError


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
