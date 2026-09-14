"""Incident document (docs/interfaces.md 4.3). A writes, B reads."""
from typing import Optional

from pydantic import BaseModel, Field


class ChainNode(BaseModel):
    event_id: str
    pid: int
    ppid: int
    image: str
    command_line: Optional[str] = None
    timestamp: str
    technique: Optional[str] = None
    rule_id: Optional[str] = None


class ChainEdge(BaseModel):
    from_: str = Field(alias="from")
    to: str
    relation: str

    model_config = {"populate_by_name": True}


class Chain(BaseModel):
    nodes: list[ChainNode] = []
    edges: list[ChainEdge] = []


class Targets(BaseModel):
    pids: list[int] = []
    remote_ips: list[str] = []
    file_paths: list[str] = []


class Incident(BaseModel):
    incident_id: str
    incident_raised_time: str
    host: str
    user: str
    severity: str
    risk_score: int
    matched_scenario: Optional[str] = None
    techniques: list[str] = []
    tactics: list[str] = []
    alert_ids: list[str] = []
    chain: Chain
    targets: Targets
