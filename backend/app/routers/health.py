"""GET /health -- reports store backend, kill switch state, and response mode."""
from fastapi import APIRouter

from engine.response.safety import KillSwitch, global_mode

from ..config import get_settings

router = APIRouter()


@router.get("/health")
def health():
    settings = get_settings()
    kill_switch = KillSwitch(settings.kill_switch_path)
    return {
        "store": settings.store_backend,
        "kill_switch": kill_switch.is_set(),
        "response_mode": global_mode(settings.response_live),
    }
