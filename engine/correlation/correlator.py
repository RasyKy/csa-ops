"""Correlator: turn alerts + events into incidents (FR9 + FR10).

Clusters linked events (linker.py), and for every cluster that contains at
least one alert and whose risk score reaches the threshold, builds an incident
document (docs/interfaces.md 4.3), stamps incident_raised_time -- the shared
timestamp that closes MTTD and opens MTTR (NFR-8) -- and logs it.

A run also reports the raw-alert-to-incident ratio (FR23): the noise reduction
correlation achieves by collapsing many alerts into fewer incidents.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

from . import risk
from .linker import build_chain, cluster_events

logger = logging.getLogger("csa_ops.correlation")


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class CorrelationRun:
    incidents: list[dict] = field(default_factory=list)
    raw_alert_count: int = 0

    @property
    def incident_count(self) -> int:
        return len(self.incidents)

    @property
    def noise_reduction_ratio(self) -> float:
        """Raw alerts per incident (FR23). 1.0 means no reduction; higher is
        more noise collapsed. Zero incidents -> 0.0 by convention."""
        if not self.incidents:
            return 0.0
        return self.raw_alert_count / self.incident_count


class Correlator:
    def __init__(
        self,
        *,
        window_seconds: float = 300,
        threshold: int = risk.RAISE_THRESHOLD,
        id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
        clock: Callable[[], str] = _utcnow,
    ):
        self.window_seconds = window_seconds
        self.threshold = threshold
        self._id_factory = id_factory
        self._clock = clock

    def correlate(
        self,
        events: list[dict],
        alerts: list[dict],
        first_time_event_ids: Optional[set] = None,
    ) -> CorrelationRun:
        first_time_event_ids = first_time_event_ids or set()
        alerts_by_event_id = {a.get("event_id"): a for a in alerts if a.get("event_id") is not None}
        run = CorrelationRun(raw_alert_count=len(alerts))

        for cluster in cluster_events(events, self.window_seconds):
            cluster_alerts = [
                alerts_by_event_id[e.get("event_id")]
                for e in cluster
                if e.get("event_id") in alerts_by_event_id
            ]
            if not cluster_alerts:
                continue  # benign lineage, no rule fired -> not an incident

            first_time_count = sum(1 for e in cluster if e.get("event_id") in first_time_event_ids)
            score = risk.risk_score(cluster_alerts, first_time_count)
            if not risk.should_raise(score, self.threshold):
                continue

            run.incidents.append(self._build_incident(cluster, cluster_alerts, score))

        logger.info(
            "correlation raised %d incident(s) from %d alert(s) (noise reduction %.2f:1)",
            run.incident_count, run.raw_alert_count, run.noise_reduction_ratio,
        )
        return run

    def _build_incident(self, cluster: list[dict], cluster_alerts: list[dict], score: int) -> dict:
        triggering = max(cluster_alerts, key=lambda a: risk.severity_weight(a.get("severity")))
        techniques = sorted({a.get("technique") for a in cluster_alerts if a.get("technique")})
        tactics = sorted({a.get("tactic") for a in cluster_alerts if a.get("tactic")})
        raised_time = self._clock()
        incident_id = self._id_factory()

        incident = {
            "incident_id": incident_id,
            "incident_raised_time": raised_time,
            "host": triggering.get("host"),
            "user": triggering.get("user"),
            "severity": risk.incident_severity(cluster_alerts),
            "risk_score": score,
            "matched_scenario": risk.classify_scenario(techniques),
            "techniques": techniques,
            "tactics": tactics,
            "alert_ids": sorted(a.get("alert_id") for a in cluster_alerts if a.get("alert_id")),
            "chain": build_chain(cluster, {a.get("event_id"): a for a in cluster_alerts}),
            "targets": _targets(cluster, cluster_alerts),
        }
        logger.info(
            "incident %s raised at %s: host=%s severity=%s score=%d scenario=%s techniques=%s",
            incident_id, raised_time, incident["host"], incident["severity"], score,
            incident["matched_scenario"], techniques,
        )
        return incident


def _targets(cluster: list[dict], cluster_alerts: list[dict]) -> dict:
    alert_event_ids = {a.get("event_id") for a in cluster_alerts}
    pids = sorted(
        {
            e.get("pid")
            for e in cluster
            if e.get("event_id") in alert_event_ids and e.get("pid") is not None
        }
    )
    remote_ips = sorted(
        {e.get("dest_ip") for e in cluster if e.get("event_type") == "network_connection" and e.get("dest_ip")}
    )
    file_paths = sorted(
        {e.get("file_path") for e in cluster if e.get("event_type") == "file_event" and e.get("file_path")}
    )
    return {"pids": pids, "remote_ips": remote_ips, "file_paths": file_paths}
