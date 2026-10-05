"""Analyst cases: GET /cases, GET /cases/assignees, GET/PATCH /incidents/{id}/case,
POST /incidents/{id}/case/notes|resolve|reopen.

Bookkeeping only. These endpoints never call the response engine, never write
alerts or incidents, and never touch triage or explain data (docs/cases.md).
"""
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse

from ..auth import require_dashboard_key
from ..config import Settings, get_settings
from ..models.case import (
    DEFAULT_ACTOR,
    MAX_ACTOR_CHARS,
    UNASSIGNED,
    Case,
    CasePatch,
    CaseStatus,
    CaseSummary,
    NoteBody,
    ReopenBody,
    ResolveBody,
)
from ..store import get_case_store, get_store
from ..store.case_store import CaseConflict, CaseStore

router = APIRouter()


def get_actor(x_actor: Optional[str] = Header(default=None)) -> str:
    if x_actor is None:
        return DEFAULT_ACTOR
    actor = x_actor.strip()
    if not 1 <= len(actor) <= MAX_ACTOR_CHARS:
        raise HTTPException(status_code=422, detail=f"X-Actor must be 1 to {MAX_ACTOR_CHARS} characters")
    return actor


def _require_incident(store, incident_id: str) -> None:
    if store.get_incident(incident_id) is None:
        raise HTTPException(status_code=404, detail="incident not found")


def _conflict(exc: CaseConflict) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={"detail": exc.message, "case": exc.case.model_dump(mode="json")},
    )


def _assignee_or_422(name: Optional[str], settings: Settings) -> Optional[str]:
    """Map a requested assignee to the stored value: None for Unassigned, else
    the configured name. Anything outside CASE_ASSIGNEES is a 422."""
    if name is None or name == UNASSIGNED:
        return None
    if name not in settings.case_assignees:
        raise HTTPException(status_code=422, detail=f"assignee must be one of {settings.case_assignees}")
    return name


@router.get("/cases/assignees")
def list_assignees(settings: Settings = Depends(get_settings), _key=Depends(require_dashboard_key)) -> list[str]:
    return settings.case_assignees


@router.get("/cases")
def list_cases(
    status: Optional[CaseStatus] = None,
    assignee: Optional[str] = None,
    cases: CaseStore = Depends(get_case_store),
    settings: Settings = Depends(get_settings),
    _key=Depends(require_dashboard_key),
) -> list[CaseSummary]:
    by_assignee = assignee is not None
    wanted = None if assignee is None or assignee.strip() == UNASSIGNED else assignee.strip()
    return cases.list_summaries(
        status=status.value if status else None, assignee=wanted, by_assignee=by_assignee
    )


@router.get("/incidents/{incident_id}/case")
def get_case(
    incident_id: str,
    store=Depends(get_store),
    cases: CaseStore = Depends(get_case_store),
    _key=Depends(require_dashboard_key),
) -> Case:
    _require_incident(store, incident_id)
    return cases.get(incident_id)


@router.patch("/incidents/{incident_id}/case")
def patch_case(
    incident_id: str,
    body: CasePatch,
    actor: str = Depends(get_actor),
    store=Depends(get_store),
    cases: CaseStore = Depends(get_case_store),
    settings: Settings = Depends(get_settings),
    _key=Depends(require_dashboard_key),
):
    _require_incident(store, incident_id)
    set_assignee = "assignee" in body.model_fields_set
    assignee = _assignee_or_422(body.assignee, settings) if set_assignee else None
    try:
        return cases.update(
            incident_id, actor=actor, status=body.status, assignee=assignee,
            set_assignee=set_assignee, expected_version=body.expected_version,
        )
    except CaseConflict as exc:
        return _conflict(exc)


@router.post("/incidents/{incident_id}/case/notes")
def add_note(
    incident_id: str,
    body: NoteBody,
    actor: str = Depends(get_actor),
    store=Depends(get_store),
    cases: CaseStore = Depends(get_case_store),
    _key=Depends(require_dashboard_key),
):
    _require_incident(store, incident_id)
    try:
        return cases.add_note(incident_id, actor=actor, text=body.text, expected_version=body.expected_version)
    except CaseConflict as exc:
        return _conflict(exc)


@router.post("/incidents/{incident_id}/case/resolve")
def resolve_case(
    incident_id: str,
    body: ResolveBody,
    actor: str = Depends(get_actor),
    store=Depends(get_store),
    cases: CaseStore = Depends(get_case_store),
    _key=Depends(require_dashboard_key),
):
    _require_incident(store, incident_id)
    try:
        return cases.resolve(
            incident_id, actor=actor, verdict=body.verdict, note=body.note,
            expected_version=body.expected_version,
        )
    except CaseConflict as exc:
        return _conflict(exc)


@router.post("/incidents/{incident_id}/case/reopen")
def reopen_case(
    incident_id: str,
    body: ReopenBody = ReopenBody(),
    actor: str = Depends(get_actor),
    store=Depends(get_store),
    cases: CaseStore = Depends(get_case_store),
    _key=Depends(require_dashboard_key),
):
    _require_incident(store, incident_id)
    try:
        return cases.reopen(incident_id, actor=actor, expected_version=body.expected_version)
    except CaseConflict as exc:
        return _conflict(exc)
