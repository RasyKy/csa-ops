"""GET /agent/commands, POST /agent/results"""
import asyncio
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from engine.response.safety import KillSwitch

from ..auth import require_agent_key
from ..config import get_settings
from ..store import get_store

router = APIRouter()

_LONG_POLL_INTERVAL_SECONDS = 0.1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@router.get("/agent/commands")
async def get_agent_commands(
    host: str,
    store=Depends(get_store),
    _key=Depends(require_agent_key),
):
    settings = get_settings()
    kill_switch = KillSwitch(settings.kill_switch_path)
    timeout = settings.agent_long_poll_seconds

    elapsed = 0.0
    while True:
        # Kill switch is authoritative: no command is issued to the agent while it's set
        # (CLAUDE.md rule 3), even if commands are already sitting in the queue.
        if kill_switch.is_set():
            return {"commands": [], "kill_switch": True}

        pending = store.list_pending_commands(host)
        if pending or elapsed >= timeout:
            now = _now()
            received = [
                store.update_response_action(cmd["action_id"], {"status": "received", "agent_received_time": now})
                for cmd in pending
            ]
            return {"commands": received, "kill_switch": False}

        await asyncio.sleep(_LONG_POLL_INTERVAL_SECONDS)
        elapsed += _LONG_POLL_INTERVAL_SECONDS


class AgentResult(BaseModel):
    action_id: str
    status: Literal["executed", "failed", "blocked_by_kill_switch"]
    response_executed_time: Optional[str] = None
    result: Optional[str] = None


@router.post("/agent/results")
def post_agent_results(
    body: AgentResult,
    store=Depends(get_store),
    _key=Depends(require_agent_key),
):
    updated = store.update_response_action(
        body.action_id,
        {"status": body.status, "response_executed_time": body.response_executed_time, "result": body.result},
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="action not found")
    return updated
