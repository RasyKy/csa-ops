"""GET /incidents, GET /incidents/{id}, GET /incidents/{id}/graph"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import require_dashboard_key
from ..metrics import DashboardVisibilityTracker, get_visibility_tracker
from ..models.graph import Graph, GraphNode
from ..models.incident import Incident
from ..store import get_store

router = APIRouter()


def _joined(store, incident: dict) -> dict:
    model = Incident(**incident)
    triage = store.get_triage(incident["incident_id"])
    last_action = store.get_latest_response_action(incident["incident_id"])
    return {
        **model.model_dump(by_alias=True),
        "triage_verdict": triage["verdict"] if triage else None,
        "last_response_action": last_action,
    }


@router.get("/incidents")
def list_incidents(
    severity: Optional[str] = None,
    host: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    since: Optional[str] = None,
    store=Depends(get_store),
    tracker: DashboardVisibilityTracker = Depends(get_visibility_tracker),
    _key=Depends(require_dashboard_key),
):
    incidents = store.list_incidents(severity=severity, host=host, limit=limit, since=since)
    for incident in incidents:
        tracker.record(incident)
    return [_joined(store, i) for i in incidents]


@router.get("/incidents/{incident_id}")
def get_incident(
    incident_id: str,
    store=Depends(get_store),
    _key=Depends(require_dashboard_key),
):
    incident = store.get_incident(incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="incident not found")

    model = Incident(**incident)
    return {
        **model.model_dump(by_alias=True),
        "triage": store.get_triage(incident_id),
        "response_history": store.list_response_actions(incident_id),
    }


@router.get("/incidents/{incident_id}/graph")
def get_incident_graph(
    incident_id: str,
    store=Depends(get_store),
    _key=Depends(require_dashboard_key),
):
    incident = store.get_incident(incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="incident not found")

    model = Incident(**incident)
    alerts = store.get_alerts_by_ids(model.alert_ids)
    rule_titles = {a["rule_id"]: a["rule_title"] for a in alerts}

    nodes = [
        GraphNode(
            event_id=n.event_id,
            pid=n.pid,
            ppid=n.ppid,
            image=n.image,
            technique=n.technique,
            rule_id=n.rule_id,
            rule_title=rule_titles.get(n.rule_id) if n.rule_id else None,
            is_trigger=n.rule_id is not None,
        )
        for n in model.chain.nodes
    ]
    graph = Graph(nodes=nodes, edges=model.chain.edges)
    return graph.model_dump(by_alias=True)
