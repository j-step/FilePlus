"""scripts/clear_logs.py empties the three logs and drops their rotations."""
from scripts.clear_logs import clear_logs


def test_clear_logs_truncates_and_removes_rotations(tmp_path):
    for name in ("backend.log", "main.log", "renderer.log"):
        (tmp_path / name).write_text("old line\n", encoding="utf-8")
    (tmp_path / "backend.log.1").write_text("older\n", encoding="utf-8")
    (tmp_path / "main.log.1").write_text("older\n", encoding="utf-8")
    (tmp_path / "keep.txt").write_text("not a log\n", encoding="utf-8")

    assert clear_logs(tmp_path) == []

    for name in ("backend.log", "main.log", "renderer.log"):
        assert (tmp_path / name).read_text(encoding="utf-8") == ""
    assert not (tmp_path / "backend.log.1").exists()
    assert not (tmp_path / "main.log.1").exists()
    assert (tmp_path / "keep.txt").exists()


def test_clear_logs_missing_dir_is_a_no_op(tmp_path):
    assert clear_logs(tmp_path / "nope") == []
