"""Claude Code Stop hook: don't let a turn end with broken code.

Registered in .claude/settings.json (hooks -> Stop). Claude Code runs it when
Claude is about to stop and passes a JSON object on stdin.

  * `stop_hook_active` true  -> exit 0. Claude is already continuing because
    of this hook; blocking again could loop forever.
  * no changed code files     -> exit 0. A chat-only turn is never blocked.
    "Code" = anything under backend/, frontend/, scripts/ or tests/ with a
    code extension, per `git status` (staged, unstaged or untracked).
  * otherwise run, in order, stopping at the first failure:
        py -3 -m pytest -q                 (backend tests)
        npm run test:smoke  (in frontend/) (Electron launch smoke; the
                                            harness starts its own backend)
  * failure -> a short summary, the failing output's tail and the tails of
    the test logs (artifacts/logs) on stderr, exit 2: Claude Code blocks the
    stop and shows that text to Claude.
  * success -> exit 0.

Run by hand the same way:  echo {} | py -3 scripts/verify.py
The full gate (contrast, menu/icon/filetypes gates, every Electron test) is
still scripts/verify.ps1 -- this hook is the fast subset.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CODE_DIRS = ("backend/", "frontend/", "scripts/", "tests/")
CODE_EXTS = {".py", ".js", ".html", ".css", ".ps1", ".json"}
IGNORED_PARTS = ("node_modules/", "__pycache__/", "test-results/", "package-lock.json")
LOG_DIR = ROOT / "artifacts" / "logs"
TAIL = 40


def read_hook_input(raw: str) -> dict:
    """The stdin JSON, or {} when run by hand with nothing (or garbage) piped in."""
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def parse_porcelain(text: str) -> list[str]:
    """Paths from `git status --porcelain=v1` output (renames: the new path)."""
    paths = []
    for line in text.splitlines():
        if len(line) < 4:
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        paths.append(path.strip().strip('"').replace("\\", "/"))
    return paths


def is_code_file(path: str) -> bool:
    if not path.startswith(CODE_DIRS) or any(part in path for part in IGNORED_PARTS):
        return False
    return Path(path).suffix.lower() in CODE_EXTS


def changed_code_files(root: Path = ROOT) -> list[str]:
    out = subprocess.run(["git", "status", "--porcelain=v1", "--untracked-files=all"],
                         cwd=root, capture_output=True, text=True, encoding="utf-8")
    if out.returncode != 0:
        return []  # not a git checkout: nothing to judge, never block on that
    return [p for p in parse_porcelain(out.stdout) if is_code_file(p)]


def _tail(text: str, n: int = TAIL) -> str:
    """Last n meaningful lines: blank lines and pytest's progress rows
    ("....F..  [ 42%]") carry no information for whoever reads the failure."""
    lines = [l for l in text.splitlines()
             if l.strip() and not (l.rstrip().endswith("%]") and set(l.split("[")[0].strip()) <= set(".FExsX"))]
    return "\n".join(lines[-n:])


def _log_tails() -> str:
    parts = []
    for name, keep in (("backend.log", ("WARNING", "ERROR", "Traceback", "  File ")),
                       ("renderer.log", ("ERROR", "WARNING")),
                       ("main.log", ("ERROR", "WARNING"))):
        f = LOG_DIR / name
        if not f.exists():
            continue
        lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
        hits = [l for l in lines if any(k in l for k in keep)][-15:]
        if hits:
            parts.append(f"--- {f.relative_to(ROOT)} (warnings/errors, last {len(hits)}) ---\n" + "\n".join(hits))
    return "\n".join(parts)


def run_step(name: str, cmd: list[str], cwd: Path) -> tuple[bool, str, float]:
    started = time.monotonic()
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          shell=(os.name == "nt" and cmd[0] == "npm"), env={**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"})
    return proc.returncode == 0, (proc.stdout or "") + (proc.stderr or ""), time.monotonic() - started


STEPS = [
    ("backend tests (py -3 -m pytest -q)",
     ["py", "-3", "-m", "pytest", "-q", "-p", "no:cacheprovider", "--color=no", "--tb=short", "-rfE"], ROOT),
    ("Electron smoke (npm run test:smoke)", ["npm", "run", "test:smoke"], ROOT / "frontend"),
]


def main(stdin_text: str | None = None) -> int:
    hook = read_hook_input(sys.stdin.read() if stdin_text is None else stdin_text)
    if hook.get("stop_hook_active"):
        return 0
    changed = changed_code_files()
    if not changed:
        return 0
    for name, cmd, cwd in STEPS:
        ok, output, secs = run_step(name, cmd, cwd)
        if not ok:
            msg = [
                f"verify.py: {name} FAILED ({secs:.0f} s) -- do not stop; fix this first.",
                f"Changed code files: {', '.join(changed[:8])}{' ...' if len(changed) > 8 else ''}",
                f"--- last {TAIL} lines of output ---",
                _tail(output),
            ]
            logs = _log_tails()
            if logs:
                msg.append(logs)
            msg.append("Full gate: powershell -ExecutionPolicy Bypass -File scripts/verify.ps1")
            print("\n".join(msg), file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
