"""Alert document (docs/interfaces.md 4.2). A writes, B reads."""
from typing import Optional

from pydantic import BaseModel


class Alert(BaseModel):
    alert_id: str
    timestamp: str
    rule_id: str
    rule_title: str
    technique: str
    tactic: str
    severity: str
    host: str
    user: str
    event_id: str
    pid: int
    ppid: int
    image: str
    command_line: Optional[str] = None
