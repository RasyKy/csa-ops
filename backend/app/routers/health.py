"""GET /health -- reports store backend, kill switch state, and response mode."""
from typing import Optional

from fastapi import APIRouter, Depends

from engine.response.safety import KillSwitch, global_mode

from ..auth import require_dashboard_key_in_production
from ..config import get_settings

router = APIRouter()


@router.get("/health")
def health(_: Optional[str] = Depends(require_dashboard_key_in_production)):
    settings = get_settings()
    kill_switch = KillSwitch(settings.kill_switch_path)
    return {
        "store": settings.store_backend,
        "kill_switch": kill_switch.is_set(),
        "response_mode": global_mode(settings.response_live),
    }


@router.get("/healthz")
def healthz():
    return {"status": "ok"}
