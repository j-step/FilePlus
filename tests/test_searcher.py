"""Tests for backend.searcher: match_spans and the budgeted search_tree walk."""
import os

import pytest

from backend.searcher import match_spans, search_tree, SearchFilters


@pytest.fixture
def tree(tmp_path):
    """a/doc-01.txt, a/b/doc-02.md, a/.hidden/doc-03.txt, img.PNG."""
    root = tmp_path / "tree"
    (root / "a" / "b").mkdir(parents=True)
    (root / "a" / ".hidden").mkdir(parents=True)
    (root / "a" / "doc-01.txt").write_text("one")
    (root / "a" / "b" / "doc-02.md").write_text("two")
    (root / "a" / ".hidden" / "doc-03.txt").write_text("three")
    (root / "img.PNG").write_bytes(b"\x89PNG\r\n\x1a\n")
    return root


def test_match_spans_all_words_case_insensitive():
    assert match_spans("Doc-01 Final.TXT", ["doc", "final"], False) == [(0, 3), (7, 12)]
    assert match_spans("Doc-01.txt", ["doc", "zzz"], False) is None
    assert match_spans("readme", [], False) == []


def test_whole_word():
    assert match_spans("my doc.txt", ["doc"], True) == [(3, 6)]
    assert match_spans("mydoc.txt", ["doc"], True) is None


def test_match_spans_merges_overlapping_word_hits():
    # "doc" and "doc-01" both hit at offset 0; the spans must merge, not duplicate.
    assert match_spans("doc-01.txt", ["doc", "doc-01"], False) == [(0, 6)]


def test_search_tree_finds_nested_and_skips_hidden(tree):
    r = search_tree(tree, SearchFilters(q="doc"))
    names = sorted(x["name"] for x in r["results"])
    assert names == ["doc-01.txt", "doc-02.md"]
    r2 = search_tree(tree, SearchFilters(q="doc", hidden=True))
    assert len(r2["results"]) == 3


def test_type_and_ext_filters(tree):
    assert [x["name"] for x in search_tree(tree, SearchFilters(type="image"))["results"]] == ["img.PNG"]
    assert [x["name"] for x in search_tree(tree, SearchFilters(ext="md"))["results"]] == ["doc-02.md"]
    assert [x["name"] for x in search_tree(tree, SearchFilters(type="folder"))["results"]] == ["a", "b"]


def test_result_item_shape(tree):
    r = search_tree(tree, SearchFilters(q="img"))
    assert len(r["results"]) == 1
    item = r["results"][0]
    assert set(item) == {"path", "name", "is_dir", "size", "modified", "created", "accessed", "ext", "match"}
    assert item["name"] == "img.PNG"
    assert item["is_dir"] is False
    assert item["ext"] == "png"
    assert item["path"] == str(tree / "img.PNG")
    assert isinstance(item["modified"], float) and isinstance(item["created"], float)


def test_size_and_date_filters(tree):
    doc_size = len((tree / "a" / "doc-01.txt").read_bytes())  # "one" and "two" are both 3 bytes
    assert search_tree(tree, SearchFilters(q="doc", min_size=doc_size + 1))["results"] == []
    assert search_tree(tree, SearchFilters(q="doc", min_size=doc_size))["results"] != []
    import time
    future = time.time() + 3600
    assert search_tree(tree, SearchFilters(q="doc", modified_after=future))["results"] == []


def test_budget_truncates(tree):
    ticks = iter([0.0, 0.0, 10.0, 10.0, 10.0, 10.0])
    r = search_tree(tree, SearchFilters(q=""), budget_s=1.0, clock=lambda: next(ticks))
    assert r["truncated"] is True


def test_budget_truncates_mid_directory_with_many_entries(tmp_path):
    """A single directory with thousands of entries and no subdirectories to
    requeue must still get its budget re-checked *inside* the entry loop --
    otherwise the per-directory check (at the top of the while loop) would
    only fire again after the whole directory had already been scanned,
    defeating the budget for exactly the shape of directory it matters most
    for."""
    d = tmp_path / "many"
    d.mkdir()
    for i in range(3000):
        (d / f"f{i:05d}.txt").write_text("x")

    calls = {"n": 0}

    def clock():
        calls["n"] += 1
        return 0.0 if calls["n"] < 100 else 10.0

    r = search_tree(d, SearchFilters(q=""), budget_s=1.0, clock=clock)
    assert r["truncated"] is True
    assert r["walked"] < 3000


def test_limit_truncates(tree):
    r = search_tree(tree, SearchFilters(q=""), limit=2)
    assert len(r["results"]) == 2 and r["truncated"] is True


def test_skips_protected_roots(tree, monkeypatch):
    """A protected directory discovered mid-walk is pruned.

    Set through the real config root lists rather than by stubbing
    is_protected_read: search_tree normalises those roots once per walk and
    tests the discovered (already-resolved) subdirectories against them with
    a string prefix, instead of paying a Path.resolve() per directory.
    """
    from backend import searcher
    monkeypatch.setattr(searcher.config, "SYSTEM_WRITE_ROOTS", [])
    monkeypatch.setattr(searcher.config, "PROTECTED_WRITE_ROOTS", [tree / "a" / "b"])
    assert all(x["name"] != "doc-02.md" for x in search_tree(tree, SearchFilters(q="doc"))["results"])


def test_a_protected_walk_root_returns_nothing(tree, monkeypatch):
    from backend import searcher
    monkeypatch.setattr(searcher.config, "SYSTEM_WRITE_ROOTS", [tree])
    monkeypatch.setattr(searcher.config, "PROTECTED_WRITE_ROOTS", [tree])
    r = search_tree(tree, SearchFilters(q="doc"))
    assert r["results"] == [] and r["walked"] == 0


def test_the_sandbox_is_never_treated_as_protected(tree, monkeypatch):
    """is_protected_read exempts the sandbox even when it sits inside a
    protected (non-system) root -- the cheap in-walk check must agree."""
    from backend import searcher
    monkeypatch.setattr(searcher.config, "SYSTEM_WRITE_ROOTS", [])
    monkeypatch.setattr(searcher.config, "PROTECTED_WRITE_ROOTS", [tree / "a" / "b"])
    monkeypatch.setattr(searcher.config, "FILEPLUS_SANDBOX_PATH", tree / "a" / "b")
    names = {x["name"] for x in search_tree(tree, SearchFilters(q="doc"))["results"]}
    assert "doc-01.txt" in names and "doc-02.md" in names


def test_cancel_event_stops_the_walk(tree):
    """An aborted search must stop walking, not run to completion in a worker
    thread the next search then queues behind."""
    import threading

    cancel = threading.Event()
    cancel.set()
    r = search_tree(tree, SearchFilters(q="doc"), cancel=cancel)
    assert r["results"] == [] and r["truncated"] is True and r["walked"] == 0


def test_cancel_mid_walk_returns_partial_results(tree):
    import threading

    cancel = threading.Event()
    seen = {"n": 0}

    def clock():
        # Cancel once the walk is under way; the clock hook is the only
        # per-entry callback search_tree offers a test.
        seen["n"] += 1
        if seen["n"] > 4:
            cancel.set()
        return 0.0

    r = search_tree(tree, SearchFilters(q="doc"), clock=clock, cancel=cancel)
    assert r["truncated"] is True
    assert len(r["results"]) < 3


def test_skips_reparse_points(tmp_path, monkeypatch):
    """A junction/reparse point cannot be created portably in a test, so this
    fakes an os.scandir entry carrying the Windows FILE_ATTRIBUTE_REPARSE_POINT
    bit (0x400) with is_symlink() reporting False -- exactly what a real NTFS
    junction looks like -- and confirms search_tree drops it rather than
    following it."""
    from backend import searcher

    real_dir = tmp_path / "has-a-junction"
    real_dir.mkdir()

    class FakeStat:
        st_size = 0
        st_mtime = 0.0
        st_ctime = 0.0
        st_file_attributes = 0x400  # FILE_ATTRIBUTE_REPARSE_POINT, no HIDDEN bit

    class FakeEntry:
        name = "link-to-somewhere"
        path = str(real_dir / "link-to-somewhere")

        def is_symlink(self):
            return False  # junctions aren't reported as symlinks

        def is_dir(self, follow_symlinks=False):
            return True

        def stat(self, follow_symlinks=False):
            return FakeStat()

    class FakeScandirIterator:
        """Mimics the context-manager protocol real os.scandir() returns,
        since search_tree does `with os.scandir(directory) as entries:`."""
        def __init__(self, entries):
            self._entries = entries

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def __iter__(self):
            return iter(self._entries)

    real_scandir = os.scandir

    def fake_scandir(path):
        if str(path) == str(real_dir):
            return FakeScandirIterator([FakeEntry()])
        return real_scandir(path)

    monkeypatch.setattr(searcher.os, "scandir", fake_scandir)
    r = search_tree(real_dir, SearchFilters(q=""))
    assert r["results"] == []
    assert r["walked"] == 0


def test_live_result_carries_accessed(tree):
    """Stage 2D §6.3: live-stat results carry accessed beside created."""
    item = search_tree(tree, SearchFilters(q="img"))["results"][0]
    assert isinstance(item["accessed"], float) and isinstance(item["created"], float)
    assert abs(item["accessed"] - (tree / "img.PNG").stat().st_atime) < 2
