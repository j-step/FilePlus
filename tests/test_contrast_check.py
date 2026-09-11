# tests/test_contrast_check.py
"""contrast_check parses token blocks and enforces the Stage 1 floors."""
import pytest
from scripts.contrast_check import parse_blocks, contrast, check, FLOORS

FIXTURE = """
:root {
  --bg-content: #232428;
  --bg-chrome: #1C1D20;
  --bg-raised: #2B2C31;
  --text-primary: #E7E8EA;
  --text-secondary: #A0A3AA;
  --text-tertiary: #74777F;
  --accent: var(--accent-custom, #4CC2FF);
  --text-on-accent: #062033;
}
[data-theme="light"] {
  --bg-content: #FFFFFF;
  --bg-chrome: #F4F4F5;
  --bg-raised: #EBEBED;
  --text-primary: #1D1E21;
  --text-secondary: #5F6168;
  --text-tertiary: #82848B;
  --accent: var(--accent-custom, #0067C0);
  --text-on-accent: #FFFFFF;
}
"""


def test_parse_blocks_reads_both_themes_and_unwraps_var_fallback():
    dark, light = parse_blocks(FIXTURE)
    assert dark["--bg-content"] == "#232428"
    assert light["--bg-content"] == "#FFFFFF"
    assert dark["--accent"] == "#4CC2FF"        # fallback inside var() is used
    assert light["--accent"] == "#0067C0"


def test_contrast_matches_known_values():
    assert round(contrast("#FFFFFF", "#000000"), 1) == 21.0
    assert round(contrast("#E7E8EA", "#232428"), 1) >= 12.0


def test_check_passes_on_spec_tokens():
    failures = check(FIXTURE)
    assert failures == []


def test_check_fails_when_tertiary_is_too_dim():
    bad = FIXTURE.replace("--text-tertiary: #74777F;", "--text-tertiary: #4A4C52;")
    failures = check(bad)
    assert any("--text-tertiary" in f and "--bg-content" in f for f in failures)


def test_floors_cover_every_spec_pair():
    names = {(fg, bg) for fg, bg, _ in FLOORS}
    assert ("--text-primary", "--bg-content") in names
    assert ("--text-secondary", "--bg-chrome") in names
    assert ("--text-tertiary", "--bg-raised") in names
    assert ("--text-on-accent", "--accent") in names
