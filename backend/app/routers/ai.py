"""GET /ai/triage/{id}, POST /ai/explain/{id}"""
from fastapi import APIRouter, Depends, HTTPException

from engine.ai_explain import explain as ai_explain

from ..auth import require_dashboard_key
from ..store import get_store

router = APIRouter()


@router.get("/ai/triage/{incident_id}")
def get_triage(
    incident_id: str,
    store=Depends(get_store),
    _key=Depends(require_dashboard_key),
):
    if store.get_incident(incident_id) is None:
        raise HTTPException(status_code=404, detail="incident not found")

    triage = store.get_triage(incident_id)
    if triage is None:
        raise HTTPException(status_code=404, detail="incident has not been triaged yet")
    return ai_explain.annotate_staleness(triage)


@router.post("/ai/explain/{incident_id}")
def post_explain(
    incident_id: str,
    force: bool = False,
    store=Depends(get_store),
    _key=Depends(require_dashboard_key),
):
    incident = store.get_incident(incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="incident not found")

    triage = store.get_triage(incident_id)
    if triage is None:
        raise HTTPException(status_code=409, detail="incident has not been triaged yet")
    if triage.get("status") != "ok":
        raise HTTPException(status_code=409, detail="triage failed; nothing to explain")

    if triage.get("explain") and not force:
        # Cached on the triage doc -- no repeat LLM call. Even a stale
        # cached explain is returned as-is here (annotated with is_stale
        # so the dashboard can show a notice); only an explicit
        # force=true request (the dashboard's "Regenerate" button)
        # recomputes it. No path here ever regenerates on its own.
        return ai_explain.annotate_staleness(triage)

    try:
        response_actions = store.list_response_actions(incident_id)
        result = ai_explain.explain_incident(incident, triage, response_actions)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"explain failed: {exc}") from exc

    triage["explain"] = result.model_dump()
    store.save_triage(triage)
    return ai_explain.annotate_staleness(triage)
