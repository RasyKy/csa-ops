"""ExplainContent's output caps -- pure pydantic validation, no LLM call.
These exist because explain's free-text fields have no enum backstop the
way TriageVerdict's verdict/confidence do (see prompt-injection audit
finding): a successful injection here would otherwise have no structural
ceiling."""
import pytest
from pydantic import ValidationError

from engine.ai_explain.schemas import ExplainContent

BASE = {
    "summary": "s", "objective": "o",
    "notable_details": [], "next_steps": [], "caveats": [],
}


def test_accepts_exactly_the_boundary_values():
    ExplainContent(**{
        **BASE,
        "summary": "x" * 600,
        "objective": "x" * 600,
        "notable_details": ["x" * 300] * 6,
    })  # must not raise


def test_rejects_summary_over_600_chars():
    with pytest.raises(ValidationError):
        ExplainContent(**{**BASE, "summary": "x" * 601})


def test_rejects_objective_over_600_chars():
    with pytest.raises(ValidationError):
        ExplainContent(**{**BASE, "objective": "x" * 601})


def test_rejects_a_list_item_over_300_chars():
    with pytest.raises(ValidationError):
        ExplainContent(**{**BASE, "next_steps": ["x" * 301]})


def test_rejects_more_than_6_items_in_a_list():
    with pytest.raises(ValidationError):
        ExplainContent(**{**BASE, "caveats": ["x"] * 7})
