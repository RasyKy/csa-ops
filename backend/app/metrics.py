"""NFR-4 measurement: how long after an incident is raised does it first
appear in a GET /incidents response. Logged as an estimate of
dashboard_visible_time; not persisted, since it's an operational metric,
not one of the data contracts in docs/interfaces.md.
"""
import logging
from datetime import datetime, timezone

from fastapi import Request

logger = logging.getLogger("csa_ops.metrics")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


class DashboardVisibilityTracker:
    """Records the first time each incident_id is returned by GET /incidents
    and logs the gap from incident_raised_time to that moment."""

    def __init__(self):
        self._first_seen: dict[str, str] = {}

    def record(self, incident: dict) -> None:
        incident_id = incident["incident_id"]
        if incident_id in self._first_seen:
            return

        now = _now()
        self._first_seen[incident_id] = now

        raised = incident.get("incident_raised_time")
        if not raised:
            return

        gap_seconds = (_parse(now) - _parse(raised)).total_seconds()
        logger.info(
            "NFR-4 dashboard_visible_time: incident=%s raised=%s first_seen_via_api=%s gap=%.3fs",
            incident_id, raised, now, gap_seconds,
        )


def get_visibility_tracker(request: Request) -> DashboardVisibilityTracker:
    return request.app.state.visibility_tracker
