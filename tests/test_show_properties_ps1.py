"""frontend/native/show-properties.ps1 — the Windows-mode Properties helper.

The bug this covers (pass 2 #147): the folder branch computed its parent with
``Split-Path -LiteralPath $Path -Parent``. In Windows PowerShell 5.1 ``-Parent``
belongs to the ``Path`` parameter set and ``-LiteralPath`` to the
``LiteralPath`` one, so that call is always an ``AmbiguousParameterSet``
error — Properties never opened for ANY folder, and main.js's fire-and-forget
spawn meant the user got no error either.

The script's ``-ResolveOnly`` switch runs exactly the resolution path the real
invocation does (Get-Item → parent → Shell.Application → ParseName) and then
exits instead of invoking the Properties verb, so this can assert on the real
thing without popping a modal dialog on the machine running the tests.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows-only shell helper")

SCRIPT = Path(__file__).resolve().parents[1] / "frontend" / "native" / "show-properties.ps1"


def _resolve(path: str) -> subprocess.CompletedProcess:
    powershell = shutil.which("powershell")
    if not powershell:
        pytest.skip("powershell not on PATH")
    return subprocess.run(
        [powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT),
         "-Path", path, "-ResolveOnly"],
        capture_output=True, text=True, timeout=120,
    )


def test_script_exists():
    assert SCRIPT.is_file()


def test_no_ambiguous_split_path():
    """The exact combination PowerShell 5.1 refuses must not come back."""
    text = SCRIPT.read_text(encoding="utf-8")
    for line in text.splitlines():
        code = line.split("#", 1)[0]
        if "Split-Path" in code:
            assert not ("-LiteralPath" in code and "-Parent" in code), line


def test_resolves_a_folder(tmp_path):
    folder = tmp_path / "Proj"
    folder.mkdir()
    res = _resolve(str(folder))
    assert res.returncode == 0, res.stderr
    assert f"parent={tmp_path}" in res.stdout
    assert "target=Proj" in res.stdout


def test_resolves_a_folder_with_a_trailing_separator(tmp_path):
    folder = tmp_path / "Proj"
    folder.mkdir()
    res = _resolve(str(folder) + os.sep)
    assert res.returncode == 0, res.stderr
    assert "target=Proj" in res.stdout


def test_resolves_a_file(tmp_path):
    f = tmp_path / "report.txt"
    f.write_text("hi", encoding="utf-8")
    res = _resolve(str(f))
    assert res.returncode == 0, res.stderr
    assert f"parent={tmp_path}" in res.stdout
    assert "target=report.txt" in res.stdout


def test_resolves_a_drive_root():
    """A drive root has no parent directory — its shell parent is This PC."""
    res = _resolve("C:\\")
    assert res.returncode == 0, res.stderr
    assert "parent=" in res.stdout
    # The display name, not "C:\" — which is also what the dialog's title bar
    # says, and what the script's own wait loop matches on.
    assert "target=" in res.stdout
    target = [ln for ln in res.stdout.splitlines() if ln.startswith("target=")][0]
    assert target != "target="


def test_a_missing_path_exits_non_zero(tmp_path):
    """main.js reports an early non-zero exit back to the renderer."""
    res = _resolve(str(tmp_path / "no-such-thing"))
    assert res.returncode != 0
