"""Pydantic output models for triage verdicts and explain sections."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

Verdict = Literal["true_positive", "likely_true_positive", "needs_review", "likely_false_positive", "false_positive"]
Confidence = Literal["low", "medium", "high"]


class TriageVerdict(BaseModel):
    """What the LLM itself produces -- strict and enum-constrained (CLAUDE.md rule 9)."""

    verdict: Verdict
    confidence: Confidence
    reason: str = Field(max_length=200)


class ExplainContent(BaseModel):
    """What the LLM produces for explain -- the five sections minus generated_time."""

    summary: str
    objective: str
    notable_details: list[str]
    next_steps: list[str]
    caveats: list[str]


class Explain(ExplainContent):
    generated_time: str


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
