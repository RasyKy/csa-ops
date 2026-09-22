"""GET /response/actions, POST /response/actions (manual), GET/POST /response/config"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from engine.response import commander, decision
from engine.response.safety import KillSwitch, global_mode

from ..auth import require_dashboard_key
from ..config import get_settings
from ..store import get_store

router = APIRouter()


@router.get("/response/actions")
def list_response_actions(
    incident_id: Optional[str] = None,
    host: Optional[str] = None,
    store=Depends(get_store),
    _key=Depends(require_dashboard_key),
):
    actions = store.list_all_response_actions()
    if incident_id:
        actions = [a for a in actions if a["incident_id"] == incident_id]
    if host:
        actions = [a for a in actions if a["host"] == host]
    actions.sort(key=lambda a: a["command_issued_time"], reverse=True)
    return actions


class ManualAction(BaseModel):
    incident_id: str
    action: str
    target: dict = {}


@router.post("/response/actions")
def post_manual_action(
    body: ManualAction,
    store=Depends(get_store),
    _key=Depends(require_dashboard_key),
):
    if body.action not in decision.all_actions():
        raise HTTPException(status_code=422, detail=f"unknown action {body.action!r}")

    incident = store.get_incident(body.incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="incident not found")

    settings = get_settings()
    return commander.issue_manual_action(
        store=store, settings=settings, incident=incident, action=body.action, target=body.target
    )


class KillSwitchUpdate(BaseModel):
    kill_switch: bool


@router.get("/response/config")
def get_response_config(_key=Depends(require_dashboard_key)):
    settings = get_settings()
    kill_switch = KillSwitch(settings.kill_switch_path)
    return {"kill_switch": kill_switch.is_set(), "response_mode": global_mode(settings.response_live)}


@router.post("/response/config")
def post_response_config(
    body: KillSwitchUpdate,
    _key=Depends(require_dashboard_key),
):
    settings = get_settings()
    kill_switch = KillSwitch(settings.kill_switch_path)
    if body.kill_switch:
        kill_switch.set()
    else:
        kill_switch.clear()
    return {"kill_switch": kill_switch.is_set(), "response_mode": global_mode(settings.response_live)}
