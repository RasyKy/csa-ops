"""Analyst case documents (docs/interfaces.md, Cases). B owns these.

Case data is bookkeeping for people. It never feeds detection, correlation,
scoring, response actions or AI output.
"""
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

MAX_NOTE_CHARS = 2000
MAX_RESOLUTION_NOTE_CHARS = 1000
MAX_ACTOR_CHARS = 64
DEFAULT_ACTOR = "analyst"
UNASSIGNED = "Unassigned"


class CaseStatus(str, Enum):
    open = "open"
    investigating = "investigating"
    resolved = "resolved"


class Verdict(str, Enum):
    true_positive = "true_positive"
    false_positive = "false_positive"
    benign_activity = "benign_activity"
    undetermined = "undetermined"


class CaseEventType(str, Enum):
    created = "created"
    status_changed = "status_changed"
    assignee_changed = "assignee_changed"
    note_added = "note_added"
    resolved = "resolved"
    reopened = "reopened"


class CaseEvent(BaseModel):
    id: str
    time: str
    actor: str
    type: CaseEventType
    data: dict[str, Any] = {}


class Case(BaseModel):
    incident_id: str
    status: CaseStatus = CaseStatus.open
    assignee: Optional[str] = None
    verdict: Optional[Verdict] = None
    resolution_note: Optional[str] = None
    resolved_time: Optional[str] = None
    updated_time: Optional[str] = None
    events: list[CaseEvent] = []
    version: int = 0


class CaseSummary(BaseModel):
    incident_id: str
    status: CaseStatus
    assignee: Optional[str] = None
    verdict: Optional[Verdict] = None
    updated_time: Optional[str] = None
    resolved_time: Optional[str] = None
    version: int


def _strip(value: Any) -> Any:
    return value.strip() if isinstance(value, str) else value


class CasePatch(BaseModel):
    """status and assignee are both optional; an omitted field is left alone.
    An explicit null assignee means Unassigned."""

    status: Optional[CaseStatus] = None
    assignee: Optional[str] = None
    expected_version: Optional[int] = Field(default=None, ge=0)

    @field_validator("assignee", mode="before")
    @classmethod
    def _trim_assignee(cls, value: Any) -> Any:
        return _strip(value)


class NoteBody(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_NOTE_CHARS)
    expected_version: Optional[int] = Field(default=None, ge=0)

    @field_validator("text", mode="before")
    @classmethod
    def _trim_text(cls, value: Any) -> Any:
        return _strip(value)


class ResolveBody(BaseModel):
    verdict: Verdict
    note: Optional[str] = Field(default=None, max_length=MAX_RESOLUTION_NOTE_CHARS)
    expected_version: Optional[int] = Field(default=None, ge=0)

    @field_validator("note", mode="before")
    @classmethod
    def _trim_note(cls, value: Any) -> Any:
        value = _strip(value)
        return value or None


class ReopenBody(BaseModel):
    expected_version: Optional[int] = Field(default=None, ge=0)
