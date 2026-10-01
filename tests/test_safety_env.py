"""Dev harness phase 2: tests and dev runs can never touch real files.

FILEPLUS_ENV is dev (default) | test | prod. In dev and test the single write
guard (backend.config.path_guard / guard_operand, which every mutation in
backend/mover.py calls) refuses any target outside FILEPLUS_ROOT (alias of
FILEPLUS_SANDBOX_PATH) -- even with WRITE_UNLOCKED=true. Only prod honours
WRITE_UNLOCKED.
"""
import ast
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.config as _config
from backend.config import OutOfSandboxError, ProtectedPathError, guard_operand, path_guard

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture
def outside(tmp_path):
    """A real, writable, unprotected folder that is NOT the root."""
    d = tmp_path / "outside-root"
    d.mkdir()
    (d / "real.txt").write_text("precious", encoding="utf-8")
    return d


@pytest.mark.parametrize("env", ["dev", "test"])
@pytest.mark.parametrize("unlocked", [False, True])
def test_guard_blocks_writes_outside_root_in_dev_and_test(sandbox, outside, monkeypatch, env, unlocked):
    monkeypatch.setattr(_config, "FILEPLUS_ENV", env)
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", unlocked)
    for guard in (path_guard, guard_operand):
        with pytest.raises(OutOfSandboxError) as exc:
            guard(outside / "real.txt", "write")
        assert f"FILEPLUS_ENV={env}" in str(exc.value)
    assert not _config.writes_unlocked()


@pytest.mark.parametrize("env", ["dev", "test", "prod"])
def test_guard_allows_writes_inside_root_in_every_env(sandbox, monkeypatch, env):
    monkeypatch.setattr(_config, "FILEPLUS_ENV", env)
    target = sandbox / "inside.txt"
    assert path_guard(target, "write") == target.resolve()


def test_prod_needs_write_unlocked_too(sandbox, outside, monkeypatch):
    monkeypatch.setattr(_config, "FILEPLUS_ENV", "prod")
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", False)
    with pytest.raises(OutOfSandboxError, match="WRITE_UNLOCKED=false"):
        path_guard(outside / "real.txt", "write")
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    assert path_guard(outside / "real.txt", "write") == (outside / "real.txt").resolve()


def test_system_roots_stay_protected_even_in_unlocked_prod(sandbox, outside, monkeypatch):
    monkeypatch.setattr(_config, "FILEPLUS_ENV", "prod")
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [outside])
    with pytest.raises(ProtectedPathError):
        path_guard(outside / "real.txt", "write")


def test_reads_are_never_restricted(sandbox, outside):
    assert path_guard(outside / "real.txt", "read") == (outside / "real.txt").resolve()


def test_api_refuses_a_move_outside_root_and_leaves_the_file(sandbox, db, outside, monkeypatch):
    """End to end: the test env really protects a real file from the API."""
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)  # ignored outside prod
    from backend.api import app
    with TestClient(app) as client:
        r = client.post("/fs/rename", json={"path": str(outside / "real.txt"), "new_name": "gone.txt"})
        assert r.status_code == 403 and "FILEPLUS_ENV=test" in r.json()["detail"]
        r = client.post("/fs/trash", json={"paths": [str(outside / "real.txt")]})
        assert r.status_code == 200, r.text  # a batch answers per item
        body = r.json()
        assert body["ops"] == [] and len(body["errors"]) == 1
        assert body["errors"][0]["error"].startswith("OutOfSandboxError") and "FILEPLUS_ENV=test" in body["errors"][0]["error"]
        h = client.get("/health").json()
        assert h["env"] == "test" and h["write_unlocked"] is False
    assert (outside / "real.txt").read_text(encoding="utf-8") == "precious"
    assert not (outside / "gone.txt").exists()


def _import_config(env: dict) -> subprocess.CompletedProcess:
    full = {k: v for k, v in os.environ.items() if not k.startswith(("FILEPLUS_", "WRITE_UNLOCKED"))}
    full.update(env)
    return subprocess.run(
        [sys.executable, "-c", "import backend.config as c; print(c.FILEPLUS_ENV); print(c.FILEPLUS_SANDBOX_PATH)"],
        cwd=REPO, env=full, capture_output=True, text=True, timeout=60,
    )


def test_env_defaults_to_dev_and_rejects_unknown_values(tmp_path):
    ok = _import_config({"FILEPLUS_SANDBOX_PATH": str(tmp_path)})
    assert ok.returncode == 0 and ok.stdout.splitlines()[0] == "dev"
    bad = _import_config({"FILEPLUS_ENV": "staging"})
    assert bad.returncode != 0 and "FILEPLUS_ENV must be one of" in bad.stderr


def test_fileplus_root_is_an_alias_and_conflicts_are_refused(tmp_path):
    r = _import_config({"FILEPLUS_ROOT": str(tmp_path / "a")})
    assert r.returncode == 0 and r.stdout.splitlines()[1] == str(tmp_path / "a")
    same = _import_config({"FILEPLUS_ROOT": str(tmp_path / "a"), "FILEPLUS_SANDBOX_PATH": str(tmp_path / "a")})
    assert same.returncode == 0
    clash = _import_config({"FILEPLUS_ROOT": str(tmp_path / "a"), "FILEPLUS_SANDBOX_PATH": str(tmp_path / "b")})
    assert clash.returncode != 0 and "disagree" in clash.stderr


# ── Centralisation: nothing outside the guarded module mutates user files ───

# Calls that create, change, move or delete something on disk.
_MUTATING_ATTRS = {
    "write_text", "write_bytes", "unlink", "rmdir", "mkdir", "touch", "rename", "replace",
    "move", "copy", "copy2", "copyfile", "copytree", "rmtree", "remove", "makedirs",
    "SetFileAttributesW", "send2trash", "_send2trash",
}
# module -> functions allowed to mutate, and why they are safe:
_ALLOWED = {
    "mover.py": None,  # every public mutation calls _aguard/_aguard_operand (path_guard) first
    "winshell.py": {"set_attributes", "write_folder_type", "restore_desktop_ini"},  # only called from mover, after its guard
    "config.py": {"ensure_api_token"},  # the app's own token file
    "database.py": {"init_db"},  # the app's own database folder
    "logging_setup.py": {"setup_logging"},  # the app's own log folder
}


def _mutations(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for node in ast.walk(fn):
            if isinstance(node, ast.Call):
                f = node.func
                name = f.attr if isinstance(f, ast.Attribute) else f.id if isinstance(f, ast.Name) else None
                # str.replace(...) has two args and a str receiver; Path.replace/os.replace
                # are the ones that matter, so skip the obvious string helpers.
                if name == "replace" and isinstance(f, ast.Attribute) and not (
                        isinstance(f.value, ast.Name) and f.value.id == "os"):
                    continue
                # mover.rename(...) / mover.mkdir(...) are calls INTO the guarded
                # module (the API routes), not filesystem calls of their own.
                if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id == "mover":
                    continue
                if name in _MUTATING_ATTRS:
                    yield fn.name, name, node.lineno


def test_file_mutations_live_only_in_the_guarded_modules():
    offenders = []
    for py in sorted((REPO / "backend").glob("*.py")):
        for fn, call, line in _mutations(py):
            allowed = _ALLOWED.get(py.name, set())
            if allowed is None or fn in allowed:
                continue
            offenders.append(f"backend/{py.name}:{line} {fn}() calls {call}()")
    assert not offenders, "file mutations outside the guarded modules:\n" + "\n".join(offenders)


def test_winshell_writers_are_only_called_from_mover():
    callers = []
    for py in sorted((REPO / "backend").glob("*.py")):
        if py.name in ("winshell.py", "mover.py"):
            continue
        text = py.read_text(encoding="utf-8")
        for fn in _ALLOWED["winshell.py"]:
            if f"winshell.{fn}(" in text:
                callers.append(f"backend/{py.name} calls winshell.{fn}")
    assert not callers, callers
