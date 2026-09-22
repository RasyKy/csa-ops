"""In-memory Store implementation loaded from fixtures/. Default when STORE_BACKEND=fixtures."""
import json
from datetime import datetime
from pathlib import Path
from typing import Optional


class FixtureStore:
    def __init__(
        self,
        fixtures_dir: str = "fixtures",
        intake_state_path: str = "./data/intake_state.json",
        response_actions_path: str = "./data/response_actions.json",
        incident_triage_path: str = "./data/incident_triage.json",
    ):
        fixtures_dir = Path(fixtures_dir)
        self._alerts: list[dict] = json.loads((fixtures_dir / "alerts.json").read_text())
        self._incidents: list[dict] = json.loads((fixtures_dir / "incidents.json").read_text())
        self._intake_state_path = Path(intake_state_path)

        self._response_actions_path = Path(response_actions_path)
        if self._response_actions_path.exists():
            self._response_actions: list[dict] = json.loads(self._response_actions_path.read_text())
        else:
            self._response_actions = []

        self._incident_triage_path = Path(incident_triage_path)
        if self._incident_triage_path.exists():
            self._triage: dict[str, dict] = json.loads(self._incident_triage_path.read_text())
        else:
            self._triage = {}

    def list_alerts(self, *, severity=None, host=None, limit=50, since=None):
        items = _filtered(self._alerts, severity=severity, host=host, since=since, since_field="timestamp")
        items.sort(key=lambda a: a["timestamp"], reverse=True)
        return items[:limit]

    def list_incidents(self, *, severity=None, host=None, limit=50, since=None, order="desc"):
        items = _filtered(
            self._incidents, severity=severity, host=host, since=since, since_field="incident_raised_time"
        )
        items.sort(key=lambda i: i["incident_raised_time"], reverse=(order == "desc"))
        return items[:limit]

    def get_incident(self, incident_id: str) -> Optional[dict]:
        return next((i for i in self._incidents if i["incident_id"] == incident_id), None)

    def get_alerts_by_ids(self, alert_ids: list[str]) -> list[dict]:
        wanted = set(alert_ids)
        return [a for a in self._alerts if a["alert_id"] in wanted]

    def get_triage(self, incident_id: str) -> Optional[dict]:
        return self._triage.get(incident_id)

    def save_triage(self, triage: dict) -> None:
        self._triage[triage["incident_id"]] = triage
        self._persist_triage()

    def list_response_actions(self, incident_id: str) -> list[dict]:
        return [a for a in self._response_actions if a["incident_id"] == incident_id]

    def get_latest_response_action(self, incident_id: str) -> Optional[dict]:
        history = self.list_response_actions(incident_id)
        return history[-1] if history else None

    def list_all_response_actions(self) -> list[dict]:
        return list(self._response_actions)

    def get_response_action(self, action_id: str) -> Optional[dict]:
        return next((a for a in self._response_actions if a["action_id"] == action_id), None)

    def save_response_action(self, action: dict) -> None:
        self._response_actions.append(action)
        self._persist_response_actions()

    def update_response_action(self, action_id: str, updates: dict) -> Optional[dict]:
        action = self.get_response_action(action_id)
        if action is None:
            return None
        action.update(updates)
        self._persist_response_actions()
        return action

    def list_pending_commands(self, host: str) -> list[dict]:
        return [a for a in self._response_actions if a["host"] == host and a["status"] == "issued"]

    def _persist_response_actions(self) -> None:
        self._response_actions_path.parent.mkdir(parents=True, exist_ok=True)
        self._response_actions_path.write_text(json.dumps(self._response_actions))

    def _persist_triage(self) -> None:
        self._incident_triage_path.parent.mkdir(parents=True, exist_ok=True)
        self._incident_triage_path.write_text(json.dumps(self._triage))

    def get_intake_state(self) -> dict:
        if self._intake_state_path.exists():
            return json.loads(self._intake_state_path.read_text())
        return {"watermark": None, "processed_ids": []}

    def save_intake_state(self, state: dict) -> None:
        self._intake_state_path.parent.mkdir(parents=True, exist_ok=True)
        self._intake_state_path.write_text(json.dumps(state))

    # --- Metrics page ---

    def count_alerts(self, *, since=None, severity=None) -> int:
        return len(_filtered(self._alerts, severity=severity, host=None, since=since, since_field="timestamp"))

    def count_incidents(self, *, since=None, severity=None) -> int:
        return len(_filtered(
            self._incidents, severity=severity, host=None, since=since, since_field="incident_raised_time"
        ))

    def alerts_timeseries(self, *, since, interval: str) -> list[dict]:
        items = _filtered(self._alerts, severity=None, host=None, since=since, since_field="timestamp")
        buckets: dict[str, dict[str, int]] = {}
        for alert in items:
            bucket = _bucket_key(alert["timestamp"], interval)
            counts = buckets.setdefault(bucket, {})
            counts[alert["severity"]] = counts.get(alert["severity"], 0) + 1
        return [{"bucket": b, "severity_counts": counts} for b, counts in sorted(buckets.items())]

    def alerts_top_terms(self, field: str, *, since=None, size: int = 5) -> list[dict]:
        items = _filtered(self._alerts, severity=None, host=None, since=since, since_field="timestamp")
        return _top_terms(items, field, size)

    def alerts_by_technique_tactic(self, *, since=None) -> list[dict]:
        items = _filtered(self._alerts, severity=None, host=None, since=since, since_field="timestamp")
        counts: dict[tuple[str, Optional[str]], int] = {}
        for alert in items:
            technique = alert.get("technique")
            if not technique:
                continue
            key = (technique, alert.get("tactic"))
            counts[key] = counts.get(key, 0) + 1
        ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
        return [{"technique": t, "tactic": tac, "count": c} for (t, tac), c in ranked]

    def list_all_triage(self, *, since=None) -> list[dict]:
        items = list(self._triage.values())
        if since:
            items = [t for t in items if t.get("triage_time") and t["triage_time"] > since]
        return items

    def index_health(self, index_name: str) -> Optional[dict]:
        sources: dict[str, tuple[list[dict], str]] = {
            "alerts": (self._alerts, "timestamp"),
            "incidents": (self._incidents, "incident_raised_time"),
            "incident_triage": (list(self._triage.values()), "triage_time"),
            "response_actions": (self._response_actions, "command_issued_time"),
        }
        if index_name not in sources:
            # e.g. "logs-normalized" -- ingestion's index, B has never owned
            # it or a fixture for it, so fixture mode genuinely can't answer.
            return None
        items, ts_field = sources[index_name]
        if not items:
            return {"count": 0, "latest_timestamp": None}
        timestamps = [i[ts_field] for i in items if i.get(ts_field)]
        return {"count": len(items), "latest_timestamp": max(timestamps) if timestamps else None}


def _bucket_key(timestamp: str, interval: str) -> str:
    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if interval == "hour":
        dt = dt.replace(minute=0, second=0, microsecond=0)
    else:
        dt = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _top_terms(items: list[dict], field: str, size: Optional[int]) -> list[dict]:
    counts: dict[str, int] = {}
    for item in items:
        key = item.get(field)
        if key is None:
            continue
        counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    if size is not None:
        ranked = ranked[:size]
    return [{"key": k, "count": c} for k, c in ranked]


def _filtered(items: list[dict], *, severity, host, since, since_field: str) -> list[dict]:
    result = list(items)
    if severity:
        result = [i for i in result if i["severity"] == severity]
    if host:
        result = [i for i in result if i["host"] == host]
    if since:
        result = [i for i in result if i[since_field] > since]
    return result
