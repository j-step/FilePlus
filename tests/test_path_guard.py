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
