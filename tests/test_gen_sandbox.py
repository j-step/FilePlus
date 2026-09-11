"""The sandbox generator must be deterministic and cover every fixture class."""
import os
from pathlib import Path

from backend.hasher import hash_file
from scripts.gen_sandbox import build, EXPECTED_FILES


def _listing(root: Path) -> list[tuple[str, int]]:
    return sorted(
        (str(p.relative_to(root)), p.stat().st_size)
        for p in root.rglob("*") if p.is_file()
    )


def test_build_produces_expected_counts(tmp_path):
    stats = build(tmp_path / "gen")
    assert stats["files"] == EXPECTED_FILES
    assert stats["dirs"] >= 10
    assert stats["duplicates"] == 3
    assert stats["hidden"] == 2
    assert len(_listing(tmp_path / "gen")) == EXPECTED_FILES


def test_build_is_deterministic(tmp_path):
    build(tmp_path / "a")
    build(tmp_path / "b")
    assert _listing(tmp_path / "a") == _listing(tmp_path / "b")
    ha = hash_file(tmp_path / "a" / "Documents" / "report-2025.txt")
    hb = hash_file(tmp_path / "b" / "Documents" / "report-2025.txt")
    assert ha == hb


def test_duplicates_share_a_hash(tmp_path):
    root = tmp_path / "gen"
    build(root)
    original = root / "Documents" / "report-2025.txt"
    copies = [
        root / "Downloads" / "report-2025.txt",
        root / "Documents" / "old" / "report-2025 (1).txt",
        root / "Desktop" / "report-2025 - Copy.txt",
    ]
    for c in copies:
        assert c.exists(), c
        assert hash_file(c) == hash_file(original)


def test_hidden_files_carry_windows_hidden_attribute(tmp_path):
    root = tmp_path / "gen"
    build(root)
    for name in (".hidden-config", "thumbs.db"):
        attrs = (root / name).stat().st_file_attributes
        assert attrs & 0x2, f"{name} is not hidden"


def test_special_names_and_depth(tmp_path):
    root = tmp_path / "gen"
    build(root)
    assert (root / "Documents" / "Rechnung_Müller.txt").exists()
    assert (root / "Documents" / "ノート.md").exists()
    assert (root / "Documents" / "café menu.txt").exists()
    assert (root / "Projects" / "a" / "b" / "c" / "d" / "e" / "f" / "deep.txt").exists()
    assert (root / "Downloads" / "movie.mkv.crdownload").exists()
    assert (root / "Pictures" / "IMG_0001.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_large_flag_adds_one_sparse_file(tmp_path):
    root = tmp_path / "gen"
    stats = build(root, large=True)
    big = root / "Videos" / "large-render.mov"
    assert stats["files"] == EXPECTED_FILES + 1
    assert big.stat().st_size == 101 * 1024 * 1024
