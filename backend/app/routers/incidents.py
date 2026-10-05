"""GET /incidents, GET /incidents/{id}, GET /incidents/{id}/graph,
GET /incidents/{id}/report"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from engine.ai_explain import explain as ai_explain

from ..auth import require_dashboard_key
from ..metrics import DashboardVisibilityTracker, get_visibility_tracker
from ..models.case import Case
from ..models.graph import Graph, GraphNode
from ..models.incident import Incident
from ..reports.incident_report import build_incident_report_markdown
from ..reports.pdf_renderer import render_pdf_from_html, report_markdown_to_html
from ..store import get_case_store, get_store
from ..store.case_store import CaseStore

logger = logging.getLogger("csa_ops.reports")

router = APIRouter()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _joined(store, incident: dict) -> dict:
    model = Incident(**incident)
    triage = store.get_triage(incident["incident_id"])
    last_action = store.get_latest_response_action(incident["incident_id"])
    return {
        **model.model_dump(by_alias=True),
        "triage_verdict": triage["verdict"] if triage else None,
        "triage_status": triage["status"] if triage else None,
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
    triage = store.get_triage(incident_id)
    return {
        **model.model_dump(by_alias=True),
        "triage": ai_explain.annotate_staleness(triage) if triage is not None else None,
        "response_history": store.list_response_actions(incident_id),
    }


def _case_for_report(cases: CaseStore, incident_id: str) -> Optional[dict]:
    """The incident's case (the virtual default when none is stored) as a plain
    dict, or None when the case file cannot be read. A report never depends on
    case data: None just means the Case section is left out. Read only."""
    try:
        path = cases.path
        if path.exists():
            raw = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                return None
            for value in raw.values():  # the same validity rule the store applies on load
                Case(**value)
        return cases.get(incident_id).model_dump(mode="json")
    except Exception as exc:
        logger.warning("report: case data unavailable for %s (%s); leaving out the Case section", incident_id, exc)
        return None


@router.get("/incidents/{incident_id}/report")
def get_incident_report(
    incident_id: str,
    format: Optional[str] = Query("md"),
    include_case: bool = Query(True),
    store=Depends(get_store),
    cases: CaseStore = Depends(get_case_store),
    _key=Depends(require_dashboard_key),
):
    """Read-only report (Markdown or PDF) for one incident -- assembles data that's
    already written (incident, triage, response history, alert rule
    titles), never computes or stores anything new."""
    fmt = (format or "md").lower()
    if fmt not in ("md", "pdf"):
        raise HTTPException(status_code=400, detail="format must be 'md' or 'pdf'")

    incident = store.get_incident(incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="incident not found")

    triage = store.get_triage(incident_id)
    if triage is not None:
        triage = ai_explain.annotate_staleness(triage)
    response_history = store.list_response_actions(incident_id)

    alert_ids = Incident(**incident).alert_ids
    alerts = store.get_alerts_by_ids(alert_ids)
    rule_titles = {a["rule_id"]: a["rule_title"] for a in alerts}

    case = _case_for_report(cases, incident_id) if include_case else None

    generated_time = _utcnow()
    try:
        markdown = build_incident_report_markdown(
            incident, triage, response_history, rule_titles, generated_time, case=case
        )
    except Exception:
        if case is None:
            raise
        logger.exception("report: the Case section failed for %s; exporting without it", incident_id)
        markdown = build_incident_report_markdown(
            incident, triage, response_history, rule_titles, generated_time
        )

    date = generated_time[:10]
    if fmt == "pdf":
        html_doc = report_markdown_to_html(markdown)
        pdf_bytes = render_pdf_from_html(html_doc)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{incident_id}-{date}.pdf"'},
        )

    return Response(
        content=markdown,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{incident_id}-{date}.md"'},
    )


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
            event_type=n.event_type,
            host=n.host,
            detail=n.detail,
        )
        for n in model.chain.nodes
    ]
    graph = Graph(nodes=nodes, edges=model.chain.edges)
    return graph.model_dump(by_alias=True)
