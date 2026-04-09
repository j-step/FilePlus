"""Nexus filesystem watcher — monitors the Everything Folder for new files.

Uses watchdog to watch a configured inbox directory. On file creation or
modification, triggers the classification pipeline and queues the file
for user review in the approval queue.

Phase 7 implementation target.
"""
import logging

from backend import config  # noqa: F401

logger = logging.getLogger(__name__)

# watchdog imported at call site to avoid hard failure if not yet installed
# from watchdog.observers import Observer
# from watchdog.events import FileSystemEventHandler


class NexusEventHandler:
    """Handles filesystem events from the watchdog Observer.

    Phase 7 implementation target.
    """

    def on_created(self, event) -> None:
        """Called when a file or directory is created."""
        # TODO: implement in Phase 7
        pass

    def on_modified(self, event) -> None:
        """Called when a file or directory is modified."""
        # TODO: implement in Phase 7
        pass

    def on_moved(self, event) -> None:
        """Called when a file or directory is moved or renamed."""
        # TODO: implement in Phase 7
        pass


def start_watcher() -> None:
    """Start the watchdog observer on the configured Everything Folder path.

    Runs in a background thread. Call stop_watcher() to halt it.
    """
    # TODO: implement in Phase 7
    pass


def stop_watcher() -> None:
    """Stop the watchdog observer and join its thread."""
    # TODO: implement in Phase 7
    pass
