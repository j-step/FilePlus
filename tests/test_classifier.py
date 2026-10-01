"""backend.classifier is a stub until Stage 3 (Sort) of the roadmap
(docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md, Stage 3):
rules -> tier 1 -> tier 2 with confidence thresholds, model IDs and tier
order from config only.

strict xfail: when classify() is implemented this test XPASSes, which fails
the run on purpose -- remove the marker and grow the real tests then.
"""
import pytest

from backend import classifier


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="classifier is a Stage 3 stub (roadmap Stage 3: rules -> tier 1 -> tier 2)")
async def test_classify_returns_category_confidence_and_source(tmp_path):
    f = tmp_path / "invoice-2026-09.pdf"
    f.write_bytes(b"%PDF-1.4\n")
    result = await classifier.classify(f)
    assert isinstance(result, dict)
    assert isinstance(result["category"], str) and result["category"]
    assert 0.0 <= result["confidence"] <= 1.0
    assert result["source"] in ("rules", "local", "cloud")
