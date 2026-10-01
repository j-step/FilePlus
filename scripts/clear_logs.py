"""Wipe the FilePlus log files before a test run.

    py -3 scripts/clear_logs.py              # the dev logs (FILEPLUS_LOG_DIR or <repo>/logs)
    py -3 scripts/clear_logs.py --dir PATH   # any other log folder (the test harness: artifacts/logs)

Empties backend.log, main.log and renderer.log and deletes their rotated
copies (backend.log.1, main.log.1, ...). A file another process still holds
open (a running backend's RotatingFileHandler on Windows) cannot be deleted,
so the current files are truncated in place rather than removed; a file that
cannot even be truncated is reported and skipped, never fatal.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

LOG_NAMES = ("backend.log", "main.log", "renderer.log")


def clear_logs(log_dir: Path) -> list[str]:
    """Truncate the three logs and delete their rotations. Returns the names
    of files that could not be cleared (normally empty)."""
    log_dir = Path(log_dir)
    if not log_dir.is_dir():
        return []
    failed: list[str] = []
    for name in LOG_NAMES:
        for rotated in log_dir.glob(name + ".*"):
            try:
                rotated.unlink()
            except OSError:
                failed.append(rotated.name)
        current = log_dir / name
        if current.exists():
            try:
                with open(current, "w", encoding="utf-8"):
                    pass
            except OSError:
                failed.append(current.name)
    return failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dir", type=Path, default=None, help="log folder (default: FILEPLUS_LOG_DIR / <repo>/logs)")
    args = parser.parse_args(argv)
    if args.dir is None:
        from backend.config import FILEPLUS_LOG_DIR
        args.dir = FILEPLUS_LOG_DIR
    failed = clear_logs(args.dir)
    for name in failed:
        print(f"clear_logs: could not clear {name} (in use?)", file=sys.stderr)
    print(f"clear_logs: {args.dir}" + (f" ({len(failed)} skipped)" if failed else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
