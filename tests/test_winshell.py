import builtins
import codecs
import ctypes
import os
import time

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


def test_size_on_disk_missing_file_raises_cleanly(tmp_path):
    with pytest.raises(FileNotFoundError):
        winshell.size_on_disk(tmp_path / "does-not-exist.txt")


@pytest.mark.skipif(os.name != "nt", reason="GetCompressedFileSizeW composition is windows only")
def test_size_on_disk_composes_high_low_as_unsigned(tmp_path, monkeypatch):
    """A DWORD low value with the top bit set (0x80000000) must compose as a
    large *positive* number, not go negative -- the bug this guards against
    is ctypes defaulting GetCompressedFileSizeW's return to a signed 32-bit
    int, which corrupts exactly this case. high=1, low=0x80000000 ->
    (1 << 32) | 0x80000000 = 6_442_450_944 bytes (~6 GiB).
    """
    def fake_get_compressed_file_size(path, high_ptr):
        high_ptr._obj.value = 1
        return 0x80000000

    monkeypatch.setattr(winshell._kernel32, "GetCompressedFileSizeW", fake_get_compressed_file_size)
    f = tmp_path / "sparse.bin"
    f.write_bytes(b"x")

    actual = winshell.size_on_disk(f)
    assert actual > 0, "must not go negative"
    assert actual >= 6_442_450_944


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

    previous, folder_bits_before = winshell.write_folder_type(folder, "Pictures")
    assert previous is None
    assert winshell.read_folder_type(folder) == "Pictures"
    assert (folder / "desktop.ini").exists()

    winshell.restore_desktop_ini(folder, previous, folder_bits_before)
    assert not (folder / "desktop.ini").exists()
    assert winshell.read_folder_type(folder) is None


def test_write_folder_type_preserves_unrelated_sections(tmp_path):
    folder = tmp_path / "Vids"
    folder.mkdir()
    (folder / "desktop.ini").write_text(
        "[.ShellClassInfo]\nIconResource=shell32.dll,4\n[ViewState]\nMode=\n", encoding="utf-8"
    )

    previous, folder_bits_before = winshell.write_folder_type(folder, "Videos")
    assert previous is not None and b"IconResource" in previous
    assert winshell.read_folder_type(folder) == "Videos"
    text = (folder / "desktop.ini").read_text(encoding="utf-8")
    assert "IconResource=shell32.dll,4" in text

    winshell.restore_desktop_ini(folder, previous, folder_bits_before)
    assert (folder / "desktop.ini").read_bytes() == previous


@pytest.mark.skipif(os.name != "nt", reason="folder-attribute round trip is windows only")
def test_write_folder_type_sets_folder_readonly_and_ini_hidden_system(tmp_path):
    folder = tmp_path / "Music"
    folder.mkdir()
    winshell.write_folder_type(folder, "Music")
    assert winshell.get_attributes(folder)["read_only"] is True
    ini_attrs = winshell.get_attributes(folder / "desktop.ini")
    assert ini_attrs["hidden"] is True and ini_attrs["system"] is True


@pytest.mark.skipif(os.name != "nt", reason="folder-attribute round trip is windows only")
def test_restore_desktop_ini_preserves_preexisting_folder_readonly(tmp_path):
    """Fix round 1: the folder's own READONLY bit -- if something other than
    FilePlus had already set it before write_folder_type ever ran -- must
    survive an undo (restore_desktop_ini) unchanged, not get cleared just
    because *previous* (the ini) was None.
    """
    folder = tmp_path / "AlreadyRO"
    folder.mkdir()
    winshell.set_attributes(folder, winshell.get_attributes(folder)["bits"] | winshell.FILE_ATTRIBUTE_READONLY)
    assert winshell.get_attributes(folder)["read_only"] is True

    previous, folder_bits_before = winshell.write_folder_type(folder, "Pictures")
    assert winshell.get_attributes(folder)["read_only"] is True  # still true, just for a different reason now

    winshell.restore_desktop_ini(folder, previous, folder_bits_before)
    assert winshell.get_attributes(folder)["read_only"] is True, \
        "folder was read-only before FilePlus touched it; undo must not clear that"
    assert not (folder / "desktop.ini").exists()


@pytest.mark.skipif(os.name != "nt", reason="folder-attribute round trip is windows only")
def test_restore_desktop_ini_clears_readonly_when_not_set_before(tmp_path):
    folder = tmp_path / "NotRO"
    folder.mkdir()
    assert winshell.get_attributes(folder)["read_only"] is False

    previous, folder_bits_before = winshell.write_folder_type(folder, "Pictures")
    assert winshell.get_attributes(folder)["read_only"] is True

    winshell.restore_desktop_ini(folder, previous, folder_bits_before)
    assert winshell.get_attributes(folder)["read_only"] is False


def test_write_folder_type_bom_aware_utf16le_preserves_comment_and_section(tmp_path):
    """Fix round 1: an existing desktop.ini can be UTF-16LE (with BOM) --
    Explorer writes ANSI most of the time but this shows up in the wild.
    write_folder_type must decode it correctly (not garble it into
    unparseable noise), and preserve the unrelated [.ShellClassInfo] section
    AND a comment line via string surgery, not a configparser re-dump (which
    silently drops comments).
    """
    folder = tmp_path / "Utf16"
    folder.mkdir()
    original_text = (
        "[.ShellClassInfo]\r\n"
        "; a hand-written comment\r\n"
        "IconResource=shell32.dll,4\r\n"
    )
    data = codecs.BOM_UTF16_LE + original_text.encode("utf-16-le")
    (folder / "desktop.ini").write_bytes(data)

    previous, folder_bits_before = winshell.write_folder_type(folder, "Pictures")
    assert previous == data

    new_bytes = (folder / "desktop.ini").read_bytes()
    new_text = new_bytes.decode("utf-8")
    assert "; a hand-written comment" in new_text
    assert "IconResource=shell32.dll,4" in new_text
    assert winshell.read_folder_type(folder) == "Pictures"

    winshell.restore_desktop_ini(folder, previous, folder_bits_before)
    assert (folder / "desktop.ini").read_bytes() == data


def test_write_folder_type_refuses_unparseable_ini(tmp_path):
    folder = tmp_path / "Corrupt"
    folder.mkdir()
    garbage = b"this is not a section header\nkey=value with no [section] above it\n"
    (folder / "desktop.ini").write_bytes(garbage)

    with pytest.raises(winshell.RefusedError, match="desktop.ini could not be parsed"):
        winshell.write_folder_type(folder, "Pictures")

    assert (folder / "desktop.ini").read_bytes() == garbage, "must not overwrite on refusal"


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


@pytest.mark.skipif(os.name != "nt", reason="pywin32 propsys is windows only")
def test_property_details_caches_by_path_and_mtime(tmp_path, monkeypatch):
    """Fix round 1, spec §5.3: property_details caches by (path, mtime) so a
    second request for the same, unchanged file doesn't re-pay the COM
    property-store cost; a changed mtime busts the cache.
    """
    from win32com.propsys import propsys

    calls = []
    real_get_store = propsys.SHGetPropertyStoreFromParsingName

    def counting_get_store(*args, **kwargs):
        calls.append(1)
        return real_get_store(*args, **kwargs)

    monkeypatch.setattr(propsys, "SHGetPropertyStoreFromParsingName", counting_get_store)
    winshell._property_details_cache.clear()

    f = tmp_path / "cached.txt"
    f.write_text("hello")

    winshell.property_details(f)
    winshell.property_details(f)
    assert len(calls) == 1, "second call at the same mtime must be a cache hit"

    future = time.time() + 5
    os.utime(f, (future, future))
    winshell.property_details(f)
    assert len(calls) == 2, "a changed mtime must bust the cache"


@pytest.mark.skipif(os.name != "nt", reason="pywin32 propsys is windows only")
def test_property_details_cache_is_bounded_fifo(tmp_path, monkeypatch):
    """Past _PROPERTY_DETAILS_CACHE_MAX entries, the oldest inserted is
    evicted first (FIFO, not LRU -- nothing here re-requests an earlier
    file to give it a recency bump before it would be evicted).
    """
    monkeypatch.setattr(winshell, "_PROPERTY_DETAILS_CACHE_MAX", 3)
    winshell._property_details_cache.clear()

    files = []
    for i in range(5):
        f = tmp_path / f"f{i}.txt"
        f.write_text(str(i))
        files.append(f)
        winshell.property_details(f)

    assert len(winshell._property_details_cache) == 3
    cached_paths = {k[0] for k in winshell._property_details_cache}
    assert str(files[0]) not in cached_paths and str(files[1]) not in cached_paths
    assert str(files[4]) in cached_paths


# ---------------------------------------------------------------------------
# Pass 2 (Windows-icon sharpness, design steps 3-4): shell_image renders the
# shell's own image for a path at exactly px x px through
# IShellItemImageFactory::GetImage -- the interface Explorer's views draw
# with -- so a folder, a known folder, an extension-less file and a .lnk all
# get the icon Explorer shows, not Chromium's grouped-by-extension guess.
# ---------------------------------------------------------------------------

import io
import re
from pathlib import Path

nt_only = pytest.mark.skipif(os.name != "nt", reason="IShellItemImageFactory is windows only")


def _png_size(data: bytes):
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    return img.size, img.mode, img


@nt_only
@pytest.mark.parametrize("px", [16, 20, 24, 28, 40, 48, 96, 144])
def test_shell_image_exact_size(px):
    png = winshell.shell_image(Path(r"C:\Windows"), px)
    assert png and png[:8] == b"\x89PNG\r\n\x1a\n"
    size, mode, img = _png_size(png)
    assert size == (px, px)
    assert mode == "RGBA"
    assert img.getpixel((0, 0))[3] == 0, "a folder icon's corner is transparent"
    assert img.getextrema()[3][1] == 255, "and its body is opaque"


@nt_only
def test_shell_image_clamps_px():
    assert _png_size(winshell.shell_image(Path(r"C:\Windows"), 4))[0] == (8, 8)
    assert _png_size(winshell.shell_image(Path(r"C:\Windows"), 10000))[0] == (512, 512)


@nt_only
def test_shell_image_dir_differs_from_extensionless_file(tmp_path):
    (tmp_path / "d").mkdir()
    (tmp_path / "Makefile").write_text("all:\n")
    d = winshell.shell_image(tmp_path / "d", 16)
    f = winshell.shell_image(tmp_path / "Makefile", 16)
    assert d and f
    assert d != f  # the Chromium regression this replaces: one drive glyph for both


@nt_only
def test_shell_image_txt_differs_from_dir(tmp_path):
    (tmp_path / "d").mkdir()
    (tmp_path / "a.txt").write_text("hi")
    assert winshell.shell_image(tmp_path / "a.txt", 24) != winshell.shell_image(tmp_path / "d", 24)


@nt_only
def test_shell_image_lnk_resolves_target(tmp_path):
    win32com = pytest.importorskip("win32com.client")
    shell = win32com.Dispatch("WScript.Shell")
    lnk = shell.CreateShortcut(str(tmp_path / "np.lnk"))
    lnk.TargetPath = r"C:\Windows\notepad.exe"
    lnk.Save()
    (tmp_path / "a.txt").write_text("hi")
    via_lnk = winshell.shell_image(tmp_path / "np.lnk", 32)
    assert via_lnk
    assert via_lnk != winshell.shell_image(tmp_path / "a.txt", 32)
    assert via_lnk == winshell.shell_image(Path(r"C:\Windows\notepad.exe"), 32)


@nt_only
def test_shell_image_missing_path_is_none(tmp_path):
    assert winshell.shell_image(tmp_path / "missing.txt", 16) is None


@nt_only
def test_shell_image_forward_slashes():
    assert _png_size(winshell.shell_image(Path("C:/Windows"), 16))[0] == (16, 16)


@nt_only
def test_shell_image_on_sta_executor():
    fut = winshell.icon_executor().submit(winshell.shell_image, Path(r"C:\Windows"), 16)
    png = fut.result(timeout=10)
    assert png and png[:8] == b"\x89PNG\r\n\x1a\n"


@nt_only
def test_shell_image_retries_e_pending(monkeypatch, tmp_path):
    """GetImage answers E_PENDING (0x8000000A) while another thread is
    filling the shell's icon cache -- measured: the second and third of three
    concurrent first calls on a fresh STA pool. That is "not yet", not "no
    image": shell_image retries it, so a folder never ends up with a
    definitive null (and the FilePlus sprite) for the whole session (Stage 2D
    Task 4)."""
    (tmp_path / "d").mkdir()
    real = winshell._GETIMAGE
    calls = {"n": 0}

    def factory(ptr):
        get_image = real(ptr)

        def flaky(*args):
            calls["n"] += 1
            if calls["n"] <= 2:
                return ctypes.c_long(0x8000000A - (1 << 32)).value  # E_PENDING as a signed HRESULT
            return get_image(*args)
        return flaky

    monkeypatch.setattr(winshell, "_GETIMAGE", factory)
    monkeypatch.setattr(winshell, "_E_PENDING_RETRY_S", 0.001)
    png = winshell.shell_image(tmp_path / "d", 16)
    assert png and png[:8] == b"\x89PNG\r\n\x1a\n"
    assert calls["n"] == 3


@nt_only
def test_shell_image_gives_up_on_endless_e_pending(monkeypatch, tmp_path):
    (tmp_path / "d").mkdir()
    calls = {"n": 0}

    def factory(_ptr):
        def pending(*_args):
            calls["n"] += 1
            return ctypes.c_long(0x8000000A - (1 << 32)).value
        return pending

    monkeypatch.setattr(winshell, "_GETIMAGE", factory)
    monkeypatch.setattr(winshell, "_E_PENDING_RETRY_S", 0.001)
    assert winshell.shell_image(tmp_path / "d", 16) is None
    assert calls["n"] == winshell._E_PENDING_TRIES


def test_shell_image_is_none_off_windows(monkeypatch, tmp_path):
    monkeypatch.setattr(winshell.os, "name", "posix")
    assert winshell.shell_image(tmp_path, 16) is None


def test_per_path_icon_exts_match_frontend():
    js = (Path(__file__).resolve().parents[1] / "frontend" / "iconCache.js").read_text(encoding="utf-8")
    m = re.search(r"PER_PATH_SHELL_EXTS = new Set\(\[(.*?)\]\)", js)
    assert m, "frontend/iconCache.js must define PER_PATH_SHELL_EXTS"
    js_set = {s.strip().strip("'\"") for s in m.group(1).split(",") if s.strip()}
    assert js_set == set(winshell.PER_PATH_ICON_EXTS)


def test_shell_icon_key(tmp_path):
    k = winshell.shell_icon_key
    assert k(tmp_path / "x", True, 16) != k(tmp_path / "x", False, 16)
    assert k(tmp_path / "a.txt", False, 16) == k(tmp_path / "b.txt", False, 16)
    assert k(tmp_path / "a.txt", False, 16) != k(tmp_path / "a.txt", False, 24)
    assert k(tmp_path / "a.lnk", False, 16) != k(tmp_path / "b.lnk", False, 16)
    assert k(tmp_path / "A.EXE", False, 16) == k(tmp_path / "a.exe", False, 16)
    assert k(tmp_path / "D", True, 16) == k(tmp_path / "d", True, 16)


@nt_only
def test_shell_image_cached_dedupes_and_bounds(tmp_path, monkeypatch):
    winshell._icon_cache.clear()
    monkeypatch.setattr(winshell, "_ICON_CACHE_MAX", 2)
    calls = []
    real = winshell.shell_image

    def counting(path, px, icon_only=True):
        calls.append((str(path), px))
        return real(path, px, icon_only)

    monkeypatch.setattr(winshell, "shell_image", counting)
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.txt").write_text("b")
    key = winshell.shell_icon_key(tmp_path / "a.txt", False, 16)
    first = winshell.shell_image_cached(key, tmp_path / "a.txt", 16)
    second = winshell.shell_image_cached(key, tmp_path / "b.txt", 16)  # same ext key -> hit, b never rendered
    assert first == second and len(calls) == 1
    # a miss (no image) is NOT cached: a transient failure must not pin "no icon" for the session
    # (.zzz, not .txt -- a .txt would be a hit on the shared ext key just rendered above)
    missing_key = winshell.shell_icon_key(tmp_path / "missing.zzz", False, 16)
    assert winshell.shell_image_cached(missing_key, tmp_path / "missing.zzz", 16) is None
    assert missing_key not in winshell._icon_cache
    # bounded: a third distinct success evicts the oldest
    for px in (20, 24):
        winshell.shell_image_cached(winshell.shell_icon_key(tmp_path / "a.txt", False, px), tmp_path / "a.txt", px)
    assert len(winshell._icon_cache) == 2
    assert key not in winshell._icon_cache
