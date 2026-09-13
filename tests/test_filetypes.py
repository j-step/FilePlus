from backend import filetypes as ft


def test_family_and_group_lookup():
    assert ft.family_for("PNG") == "image"
    assert ft.family_for(".py") == "code-py"
    assert ft.family_for("zzz") == "generic"
    assert ft.type_group_for("mp4") == "video"
    assert ft.type_group_for("docx") == "document"
    assert ft.type_group_for("", is_dir=True) == "folder"
    assert ft.type_group_for("ttf") == "other"


def test_every_family_in_exactly_one_group_or_other():
    grouped = [f for fams in ft.GROUPS.values() for f in fams]
    assert len(grouped) == len(set(grouped))
    for fam in ft.FAMILIES:
        assert fam in grouped or fam in ("font", "database", "generic")


def test_no_extension_in_two_families():
    seen = {}
    for fam, exts in ft.FAMILIES.items():
        for e in exts:
            assert e == e.lower() and not e.startswith(".")
            assert e not in seen, f"{e} in {fam} and {seen[e]}"
            seen[e] = fam


def test_generated_js_is_current(tmp_path):
    import subprocess, sys, pathlib
    src = pathlib.Path("frontend/src/filetypes.js").read_text(encoding="utf-8")
    out = tmp_path / "filetypes.js"
    subprocess.run([sys.executable, "scripts/build_filetypes.py", str(out)], check=True)
    assert out.read_text(encoding="utf-8") == src, "run: py -3 scripts/build_filetypes.py"
