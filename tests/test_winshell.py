import os, pytest
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
