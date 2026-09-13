import builtins
import os

import pytest

from backend import winshell


def test_known_folders_shape():
    folders = winshell.known_folders()
    ids = [f["id"] for f in folders]
    for required in ("desktop", "downloads", "documents", "pictures", "videos", "music"):
        assert required in ids
    for f in folders:
        assert f["name"] and os.path.isabs(f["path"])


@pytest.mark.skipif(os.name != "nt", reason="windows only")
def test_known_folders_are_absolute_windows_paths():
    for f in winshell.known_folders():
        assert f["path"][1:3] == ":\\"


# ---------------------------------------------------------------------------
# Task 3: attributes, size, association, folder summary, folder type,
# extended property details -- backing GET /fs/properties and the
# attr-set/folder-type-set mutations.
# ---------------------------------------------------------------------------

def test_get_attributes_shape(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("hi")
    attrs = winshell.get_attributes(f)
    assert set(attrs) == {"bits", "read_only", "hidden", "archive", "system"}
    assert attrs["read_only"] is False


@pytest.mark.skipif(os.name != "nt", reason="SetFileAttributesW round-trip is windows only")
def test_set_attributes_round_trip(tmp_path):
    f = tmp_path / "b.txt"
    f.write_text("hi")
    before = winshell.get_attributes(f)["bits"]

    winshell.set_attributes(f, before | winshell.FILE_ATTRIBUTE_READONLY)
    assert winshell.get_attributes(f)["read_only"] is True

    winshell.set_attributes(f, before)
    after = winshell.get_attributes(f)
    assert after["read_only"] is False and after["bits"] == before


@pytest.mark.skipif(os.name != "nt", reason="SetFileAttributesW is windows only")
def test_set_attributes_raises_oserror_on_missing_path(tmp_path):
    with pytest.raises(OSError):
        winshell.set_attributes(tmp_path / "does-not-exist.txt", winshell.FILE_ATTRIBUTE_ARCHIVE)


def test_size_on_disk_is_at_least_logical_size(tmp_path):
    f = tmp_path / "c.txt"
    f.write_text("hello world")
    assert winshell.size_on_disk(f) >= f.stat().st_size


def test_size_on_disk_folder_sums_contained_files(tmp_path):
    d = tmp_path / "folder"
    d.mkdir()
    (d / "x.txt").write_text("12345")
    (d / "y.txt").write_text("1234567890")
    assert winshell.size_on_disk(d) >= 15


def test_assoc_type_description_nonempty():
    info = winshell.assoc("txt")
    assert info["type_description"]
    assert set(info) == {"type_description", "opens_with", "opens_with_exe"}


def test_assoc_unknown_extension_falls_back():
    info = winshell.assoc("thisisnotarealext")
    # Windows offers an "open with" picker for a truly unregistered
    # extension, but the shape and a non-empty description always hold.
    assert info["type_description"]


def test_contains_counts_three_files_one_folder(tmp_path):
    (tmp_path / "a.txt").write_text("1")
    (tmp_path / "b.txt").write_text("22")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "c.txt").write_text("333")
    counts = winshell.contains_counts(tmp_path)
    assert counts == {"files": 3, "folders": 1, "bytes": 6, "truncated": False}


def test_contains_counts_budget_truncation(tmp_path):
    (tmp_path / "a.txt").write_text("1")
    (tmp_path / "b.txt").write_text("2")

    ticks = iter([0.0, 10.0, 10.0, 10.0, 10.0, 10.0])

    def fake_clock():
        return next(ticks, 10.0)

    counts = winshell.contains_counts(tmp_path, budget_s=1.0, clock=fake_clock)
    assert counts["truncated"] is True


@pytest.mark.parametrize("names, expected", [
    ([("a.png", False), ("b.png", False), ("c.png", False), ("d.txt", False)], "Pictures"),
    ([("a.txt", False), ("b.txt", False), ("c.png", False)], "Documents"),
    ([], "Generic"),
    ([("sub", True), ("a.png", False)], "Pictures"),  # folders don't vote
])
def test_detect_folder_type_majority(names, expected):
    assert winshell.detect_folder_type(names) == expected


def test_write_read_restore_folder_type_round_trip(tmp_path):
    folder = tmp_path / "Pix"
    folder.mkdir()

    assert winshell.read_folder_type(folder) is None

    previous = winshell.write_folder_type(folder, "Pictures")
    assert previous is None
    assert winshell.read_folder_type(folder) == "Pictures"
    assert (folder / "desktop.ini").exists()

    winshell.restore_desktop_ini(folder, previous)
    assert not (folder / "desktop.ini").exists()
    assert winshell.read_folder_type(folder) is None


def test_write_folder_type_preserves_unrelated_sections(tmp_path):
    folder = tmp_path / "Vids"
    folder.mkdir()
    (folder / "desktop.ini").write_text(
        "[.ShellClassInfo]\nIconResource=shell32.dll,4\n[ViewState]\nMode=\n", encoding="utf-8"
    )

    previous = winshell.write_folder_type(folder, "Videos")
    assert previous is not None and b"IconResource" in previous
    assert winshell.read_folder_type(folder) == "Videos"
    text = (folder / "desktop.ini").read_text(encoding="utf-8")
    assert "IconResource=shell32.dll,4" in text

    winshell.restore_desktop_ini(folder, previous)
    assert (folder / "desktop.ini").read_bytes() == previous


@pytest.mark.skipif(os.name != "nt", reason="folder-attribute round trip is windows only")
def test_write_folder_type_sets_folder_readonly_and_ini_hidden_system(tmp_path):
    folder = tmp_path / "Music"
    folder.mkdir()
    winshell.write_folder_type(folder, "Music")
    assert winshell.get_attributes(folder)["read_only"] is True
    ini_attrs = winshell.get_attributes(folder / "desktop.ini")
    assert ini_attrs["hidden"] is True and ini_attrs["system"] is True


def test_property_details_raises_runtime_error_when_pywin32_missing(tmp_path, monkeypatch):
    """Task 3: property_details imports pywin32 lazily, inside the function,
    and must turn an ImportError into RuntimeError("pywin32 not installed")
    -- GET /fs/properties/details maps that to a 503. Simulated here by
    making the module import itself fail, so this holds even on a machine
    (like this one) where pywin32 is actually installed.
    """
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "win32com.propsys":
            raise ImportError("simulated: pywin32 not installed")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(RuntimeError, match="pywin32 not installed"):
        winshell.property_details(tmp_path)


@pytest.mark.skipif(os.name != "nt", reason="pywin32 propsys is windows only")
def test_property_details_shape_on_a_real_file(tmp_path):
    f = tmp_path / "note.txt"
    f.write_text("hello")
    details = winshell.property_details(f)
    assert isinstance(details, list) and details
    for row in details:
        assert set(row) == {"group", "name", "value"}
        assert row["group"] and row["name"] and row["value"]
