"""FilePlus tagging engine — manages tags and auto-tagging rules.

Handles three tag types:
- system: automatically assigned by the indexer (e.g. 'image', 'large-file')
- ai: assigned by the classifier with a confidence score
- user: manually assigned via the UI

Phase 2 implementation target.
"""
import logging

from backend import config  # noqa: F401
from backend import database  # noqa: F401

logger = logging.getLogger(__name__)


async def apply_tags(file_id: int, tags: list[str]) -> None:
    """Attach a list of tag names to a file, creating tags that don't exist.

    Args:
        file_id: Primary key of the file in the files table.
        tags: List of tag name strings to apply.
    """
    # TODO: implement in Phase 2
    pass


async def get_tags(file_id: int) -> list[dict]:
    """Return all tags attached to a file.

    Args:
        file_id: Primary key of the file.

    Returns:
        List of dicts with keys: id, name, color, tag_group, tag_type.
    """
    # TODO: implement in Phase 2
    pass


async def auto_tag(file_id: int) -> None:
    """Apply system-level auto-tags based on file metadata rules.

    Examples: tag as 'duplicate' if hash matches another file,
    tag as 'large-file' if size > threshold, tag by extension category.

    Args:
        file_id: Primary key of the file.
    """
    # TODO: implement in Phase 2
    pass
