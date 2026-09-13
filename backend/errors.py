"""RefusedError — split out of backend.mover so backend.winshell can raise it too.

backend.mover imports backend.winshell; if RefusedError stayed defined only
in backend.mover, backend.winshell raising it (e.g. write_folder_type
refusing an unparseable desktop.ini) would need to import backend.mover,
creating an import cycle (mover -> winshell -> mover). backend.mover
re-exports RefusedError from here, so every existing `mover.RefusedError`
reference — the api.py exception handler, mover.py's own internal raises —
keeps resolving to this exact same class, unchanged.
"""
from __future__ import annotations


class RefusedError(Exception):
    """A mutation refuses to proceed (not a naming/policy/conflict error)."""
