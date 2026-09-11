# scripts/contrast_check.py
"""WCAG contrast gate for the FilePlus token set.

Usage:  py -3 scripts/contrast_check.py frontend/src/styles.css
Exit 0 when every pair in FLOORS meets its ratio in both the dark (:root)
and light ([data-theme="light"]) blocks; exit 1 and print the misses otherwise.
Only literal hex values are evaluated; `var(--x, #hex)` uses the fallback hex;
color-mix() and bare var() are skipped.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# (foreground token, background token, minimum ratio) — spec §3.2
FLOORS = [
    ("--text-primary", "--bg-content", 7.0),
    ("--text-secondary", "--bg-content", 4.5),
    ("--text-secondary", "--bg-chrome", 4.5),
    ("--text-tertiary", "--bg-content", 3.0),
    ("--text-tertiary", "--bg-chrome", 3.0),
    ("--text-tertiary", "--bg-raised", 3.0),
    ("--text-on-accent", "--accent", 4.5),
]

_HEX = re.compile(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
_DECL = re.compile(r"(--[a-z0-9-]+)\s*:\s*([^;]+);")


def _block(css: str, selector: str) -> str:
    start = css.index(selector)
    open_brace = css.index("{", start)
    depth, i = 0, open_brace
    while i < len(css):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return css[open_brace + 1:i]
        i += 1
    raise ValueError(f"unterminated block for {selector}")


def _hex_of(value: str) -> str | None:
    m = _HEX.search(value)
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h.upper()


def parse_blocks(css: str) -> tuple[dict[str, str], dict[str, str]]:
    """Return (dark, light) maps of token -> #RRGGBB for hex-valued tokens."""
    out = []
    for selector in (":root", '[data-theme="light"]'):
        tokens: dict[str, str] = {}
        for name, value in _DECL.findall(_block(css, selector)):
            h = _hex_of(value)
            if h:
                tokens[name] = h
        out.append(tokens)
    dark, light = out
    # light inherits anything it does not redefine
    merged_light = {**dark, **light}
    return dark, merged_light


def _lum(hex_color: str) -> float:
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(fg: str, bg: str) -> float:
    l1, l2 = sorted((_lum(fg), _lum(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def check(css: str) -> list[str]:
    failures: list[str] = []
    for theme, tokens in zip(("dark", "light"), parse_blocks(css)):
        for fg, bg, floor in FLOORS:
            if fg not in tokens or bg not in tokens:
                failures.append(f"{theme}: {fg} or {bg} has no literal hex value")
                continue
            ratio = contrast(tokens[fg], tokens[bg])
            if ratio < floor:
                failures.append(
                    f"{theme}: {fg} {tokens[fg]} on {bg} {tokens[bg]} = {ratio:.2f}:1 (floor {floor}:1)"
                )
    return failures


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    css = Path(argv[1]).read_text(encoding="utf-8")
    failures = check(css)
    if failures:
        print("contrast_check: FAIL")
        for f in failures:
            print("  " + f)
        return 1
    print("contrast_check: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
