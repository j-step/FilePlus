"""Nexus AI classifier — categorises files using local LLM or cloud fallback.

Classification pipeline:
1. Try local Ollama (llama3.1:8b) — zero cost, private
2. Fall back to Claude API if Ollama is unavailable or returns low confidence

Returns a category string and a confidence float (0.0–1.0).

Phase 3 implementation target.
"""
import logging
from pathlib import Path

from backend import config  # noqa: F401

logger = logging.getLogger(__name__)

# aiohttp imported at call site to avoid hard failure if not yet installed
# import aiohttp


async def classify_local(file_path: Path) -> dict:
    """Send file metadata to local Ollama and return classification.

    Args:
        file_path: Absolute path to the file.

    Returns:
        Dict with keys: category (str), confidence (float).
    """
    # TODO: implement in Phase 3
    pass


async def classify_cloud(file_path: Path) -> dict:
    """Send file metadata to Claude API and return classification.

    Used as fallback when Ollama is unavailable or confidence is too low.

    Args:
        file_path: Absolute path to the file.

    Returns:
        Dict with keys: category (str), confidence (float).
    """
    # TODO: implement in Phase 3
    pass


async def classify(file_path: Path) -> dict:
    """Classify a file, trying local first then falling back to cloud.

    Args:
        file_path: Absolute path to the file.

    Returns:
        Dict with keys: category (str), confidence (float), source ('local'|'cloud').
    """
    # TODO: implement in Phase 3
    pass
