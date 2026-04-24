"""FilePlus configuration — loads all env vars from .env via python-dotenv."""
from dotenv import load_dotenv
import os
from pathlib import Path

load_dotenv()


class OutOfSandboxError(Exception):
    """Raised when SAFETY_MODE is True and a path escapes the sandbox."""


FILEPLUS_SANDBOX_PATH = Path(os.getenv("FILEPLUS_SANDBOX_PATH", r"C:\FilePlusTestSandbox"))
FILEPLUS_DB_PATH = Path(os.getenv("FILEPLUS_DB_PATH", r"C:\Dev\FilePlus\fileplus.db"))
FILEPLUS_EVERYTHING_PATH = Path(os.getenv("FILEPLUS_EVERYTHING_PATH", r"C:\Everything"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

SAFETY_MODE = os.getenv("SAFETY_MODE", "true").lower() == "true"
AUTO_SORT_ENABLED = os.getenv("AUTO_SORT_ENABLED", "false").lower() == "true"
AUTO_SORT_CONFIDENCE_THRESHOLD = float(os.getenv("AUTO_SORT_CONFIDENCE_THRESHOLD", "0.85"))
MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", "100"))


def path_guard(path: Path) -> Path:
    """Return *path* resolved, or raise OutOfSandboxError if it escapes the sandbox.

    Called by every module that touches the filesystem. No-op when SAFETY_MODE
    is False (production after validation).
    """
    resolved = Path(path).resolve()
    if SAFETY_MODE:
        try:
            resolved.relative_to(FILEPLUS_SANDBOX_PATH.resolve())
        except ValueError:
            raise OutOfSandboxError(
                f"Path '{path}' is outside sandbox '{FILEPLUS_SANDBOX_PATH}'. "
                "Set SAFETY_MODE=false in .env only after sandbox validation."
            )
    return resolved
