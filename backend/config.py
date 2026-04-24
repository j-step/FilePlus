"""FilePlus configuration — loads all env vars from .env via python-dotenv."""
from dotenv import load_dotenv
import os
from pathlib import Path

load_dotenv()

FILEPLUS_SANDBOX_PATH = Path(os.getenv("FILEPLUS_SANDBOX_PATH", r"C:\FilePlusTestSandbox"))
FILEPLUS_DB_PATH = Path(os.getenv("FILEPLUS_DB_PATH", r"C:\Dev\nexus\fileplus.db"))
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
SAFETY_MODE = os.getenv("SAFETY_MODE", "true").lower() == "true"
AUTO_SORT_ENABLED = os.getenv("AUTO_SORT_ENABLED", "false").lower() == "true"
AUTO_SORT_CONFIDENCE_THRESHOLD = float(os.getenv("AUTO_SORT_CONFIDENCE_THRESHOLD", "0.85"))
MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", "100"))


def path_guard(path: Path) -> None:
    """Raise ValueError if path is outside sandbox when SAFETY_MODE is enabled."""
    if SAFETY_MODE:
        try:
            Path(path).resolve().relative_to(FILEPLUS_SANDBOX_PATH.resolve())
        except ValueError:
            raise ValueError(
                f"SAFETY_MODE is enabled. Path '{path}' is outside sandbox "
                f"'{FILEPLUS_SANDBOX_PATH}'. "
                "Set SAFETY_MODE=false in .env to allow operations on real filesystem."
            )
