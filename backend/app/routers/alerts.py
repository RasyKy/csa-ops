"""GET /alerts?severity=&host=&limit=&since="""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..auth import require_dashboard_key
from ..models.alert import Alert
from ..store import get_store

router = APIRouter()


@router.get("/alerts")
def list_alerts(
    severity: Optional[str] = None,
    host: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    since: Optional[str] = None,
    store=Depends(get_store),
    _key=Depends(require_dashboard_key),
):
    alerts = store.list_alerts(severity=severity, host=host, limit=limit, since=since)
    return [Alert(**a).model_dump() for a in alerts]
