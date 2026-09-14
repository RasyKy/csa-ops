"""Graph shape returned by GET /incidents/{id}/graph -- {nodes, edges} for the dashboard."""
from typing import Optional

from pydantic import BaseModel

from .incident import ChainEdge


class GraphNode(BaseModel):
    event_id: str
    pid: int
    ppid: int
    image: str
    technique: Optional[str] = None
    rule_id: Optional[str] = None
    rule_title: Optional[str] = None
    is_trigger: bool


class Graph(BaseModel):
    nodes: list[GraphNode]
    edges: list[ChainEdge]
