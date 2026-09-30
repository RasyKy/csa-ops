"""Pydantic output models for triage verdicts and explain sections."""
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field

Verdict = Literal["true_positive", "likely_true_positive", "needs_review", "likely_false_positive", "false_positive"]
Confidence = Literal["low", "medium", "high"]


class TriageVerdict(BaseModel):
    """What the LLM itself produces -- strict and enum-constrained (CLAUDE.md rule 9)."""

    verdict: Verdict
    confidence: Confidence
    reason: str = Field(max_length=200)


# Explain's free-text fields have no enum backstop the way TriageVerdict's
# verdict/confidence do, so a successful prompt injection here has no
# structural ceiling on its own -- these caps are that ceiling. Exceeding
# any of them fails validation the same way an invalid verdict does
# (discarded, not truncated -- CLAUDE.md rule 9).
_BoundedItem = Annotated[str, Field(max_length=300)]


class ExplainContent(BaseModel):
    """What the LLM produces for explain -- the five sections minus generated_time."""

    summary: str = Field(max_length=600)
    objective: str = Field(max_length=600)
    notable_details: list[_BoundedItem] = Field(max_length=6)
    next_steps: list[_BoundedItem] = Field(max_length=6)
    caveats: list[_BoundedItem] = Field(max_length=6)


class Explain(ExplainContent):
    generated_time: str
    # Populated by explain.py's post-hoc grounding check (grounding.py),
    # never by the model itself -- entities the explanation mentions that
    # don't appear anywhere in what it was given. Empty list, not absent,
    # for old cached explain docs written before this field existed.
    ungrounded_mentions: list[str] = []
    # Stamped by explain.py from prompts.EXPLAIN_PROMPT_VERSION at
    # generation time. None means this doc predates version tracking
    # entirely -- explain.py's annotate_staleness() always treats that as
    # stale, same as any other version mismatch.
    prompt_version: Optional[int] = None


class IncidentTriage(BaseModel):
    """The full incident_triage document (docs/interfaces.md 4.5)."""

    incident_id: str
    triage_time: str
    triage_started_time: Optional[str] = None
    verdict: Optional[Verdict] = None
    confidence: Optional[Confidence] = None
    reason: Optional[str] = None
    model: str
    status: Literal["ok", "failed"]
    explain: Optional[Explain] = None
