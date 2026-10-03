"""The sandbox generator must be deterministic and cover every fixture class."""
from pathlib import Path

import pytest

from backend.hasher import hash_file
from scripts.gen_sandbox import build, EXPECTED_FILES, MARKER


def _listing(root: Path) -> list[tuple[str, int]]:
    return sorted(
        (str(p.relative_to(root)), p.stat().st_size)
        for p in root.rglob("*") if p.is_file() and p.name != MARKER
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


def test_rebuild_over_marked_tree_succeeds(tmp_path):
    root = tmp_path / "gen"
    build(root)
    stats = build(root)
    assert stats["files"] == EXPECTED_FILES
    assert len(_listing(root)) == EXPECTED_FILES


def test_refuses_to_remove_unmarked_nonempty_dir(tmp_path):
    precious = tmp_path / "precious"
    precious.mkdir()
    guarded = precious / "do-not-delete.txt"
    guarded.write_text("precious data\n")
    with pytest.raises(RuntimeError):
        build(precious)
    assert guarded.exists()


def test_messy_classes_for_the_dev_harness(tmp_path):
    """Dev harness phase 3: screenshots, an MSI, files with no extension, a
    very long name, and large dummy files are all present by default."""
    from scripts.gen_sandbox import LONG_NAME, DUMMY_BIG_BYTES
    root = tmp_path / "gen"
    build(root)
    shots = sorted(p.name for p in (root / "Screenshots").iterdir())
    assert len(shots) == 3 and all(n.startswith("Screenshot 2026-") and n.endswith(".png") for n in shots)
    assert (root / "Downloads" / "FilePlusSetup-1.2.0.msi").read_bytes()[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    no_ext = [p for p in root.rglob("*") if p.is_file() and p.suffix == "" and not p.name.startswith(".")]
    assert {p.name for p in no_ext} >= {"LICENSE", "Makefile"}
    long_file = root / "Downloads" / LONG_NAME
    assert long_file.exists() and len(LONG_NAME) >= 100
    for name in ("disk-image.iso", "raw-footage.mp4"):
        assert (root / "Downloads" / name).stat().st_size == DUMMY_BIG_BYTES
    assert (root / "Empty").is_dir() and not any((root / "Empty").iterdir())


def test_fixture_tree_fixture_is_fresh_and_inside_the_sandbox(fixture_tree, sandbox):
    assert fixture_tree.parent == sandbox
    assert len(_listing(fixture_tree)) == EXPECTED_FILES


def test_default_out_comes_from_config(monkeypatch, tmp_path):
    """Pass-2 #101: the default --out is <config sandbox>/_gen, so a .env
    FILEPLUS_ROOT override moves the dev fixture tree with the backend."""
    from backend import config
    from scripts.gen_sandbox import default_out
    monkeypatch.setattr(config, "FILEPLUS_SANDBOX_PATH", tmp_path / "elsewhere")
    assert default_out() == tmp_path / "elsewhere" / "_gen"


def test_rebuild_clears_a_read_only_leftover(tmp_path):
    """Pass-2 #100: a test that died with a fixture file read-only must not
    wedge the next rebuild."""
    import os
    import stat
    root = tmp_path / "gen"
    build(root)
    victim = root / "Documents" / "doc-00.txt"
    os.chmod(victim, stat.S_IREAD)
    try:
        assert build(root)["files"] == EXPECTED_FILES
        assert os.access(root / "Documents" / "doc-00.txt", os.W_OK)
    finally:
        if victim.exists():
            os.chmod(victim, stat.S_IWRITE | stat.S_IREAD)
