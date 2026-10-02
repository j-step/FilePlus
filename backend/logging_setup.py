"""File logging for the FilePlus backend.

setup_logging() sends every logger in the process (backend.*, uvicorn.*) to
<FILEPLUS_LOG_DIR>/backend.log: rotating at 5 MB, three old files kept, one
line per record with timestamp, level and module. It is called from
`python -m backend.api` (the real app and the test harness's backend), never
on import -- so pytest's in-process TestClient does not write into the
developer's logs/ folder.

What gets logged (so a failure can be read from a file instead of described):
  * every HTTP request: method, path, status, duration (backend/api.py
    middleware) -- the query string is included, the token header never is;
  * every unhandled error with its full traceback, and every mapped error
    (403/404/409/5xx) with its message;
  * every file operation with source and destination (mover._perform for
    move/rename/copy/trash/restore/mkdir/touch/attributes/folder type,
    tagger for tag add/remove, indexer for scans).
"""
from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path

LOG_FORMAT = "%(asctime)s.%(msecs)03d %(levelname)-7s %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
MAX_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 3

_MARKER = "_fileplus_backend_log"


def setup_logging(log_dir: Path, *, level: int = logging.INFO, console: bool = True) -> Path:
    """Attach the rotating backend.log handler (and, by default, a console
    handler) to the root logger. Idempotent: a second call replaces nothing
    and returns the same path. Returns the log file's path."""
    log_dir = Path(log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "backend.log"
    root = logging.getLogger()
    if any(getattr(h, _MARKER, False) for h in root.handlers):
        return log_file
    formatter = logging.Formatter(LOG_FORMAT, DATE_FORMAT)
    file_handler = logging.handlers.RotatingFileHandler(
        log_file, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8", delay=False,
    )
    file_handler.setFormatter(formatter)
    setattr(file_handler, _MARKER, True)
    root.addHandler(file_handler)
    if console:
        stream = logging.StreamHandler()
        stream.setFormatter(formatter)
        setattr(stream, _MARKER, True)
        root.addHandler(stream)
    root.setLevel(level)
    # uvicorn configures its own loggers only when given a log_config; the
    # backend starts it with log_config=None, so route them through root.
    # Its access log is redundant with the request middleware -- quieten it.
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).propagate = True
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    return log_file
