"""GET /metrics/{summary,timeseries,top,mitre,response,triage,pipeline}

Read-only: no write to alerts/incidents, no call into the response engine,
no kill-switch/dry-run state changes. engine/ai_explain is never imported
here (isolation is unaffected by this file). Every value is wrapped with a
status: "ok" (real data), "no_data" (source exists, nothing in range), or
"pending_upstream" (depends on Person A/C data that doesn't exist yet) --
never a fake zero for something that isn't built.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends

from backend.metrics import calc
from backend.metrics.coverage import parse_rule_coverage
from engine.response.safety import KillSwitch, global_mode

from ..auth import require_dashboard_key
from ..config import get_settings
from ..store import get_store

router = APIRouter(prefix="/metrics")

_RANGE_DELTAS = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
_RULES_DIR = Path("rules")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _since_for_range(range_: str) -> Optional[str]:
    delta = _RANGE_DELTAS.get(range_)
    if delta is None:  # "all", or an unrecognized value -- no lower bound
        return None
    return (datetime.now(timezone.utc) - delta).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _interval_for_range(range_: str) -> str:
    return "hour" if range_ == "24h" else "day"


def _metric(value, *, empty_is_no_data=True):
    """Wrap a value in {"value", "status"}. A falsy/empty value (0, [], {},
    None) reads as "no_data" by default -- the source exists, there's
    simply nothing in range. Callers needing different semantics (e.g.
    "pending_upstream" when the whole concept isn't built yet) build the
    dict directly instead of calling this helper."""
    is_empty = value is None or value == 0 or value == [] or value == {}
    status = "no_data" if (empty_is_no_data and is_empty) else "ok"
    return {"value": value, "status": status}


def _pending(value=None) -> dict:
    return {"value": value, "status": "pending_upstream"}


def _envelope(range_: str, since: Optional[str]) -> dict:
    return {"range": range_, "since": since, "as_of": _now()}


def _filter_by_incident_range(items: list[dict], store, since: Optional[str]) -> list[dict]:
    """Scope response_actions/incident_triage items to incidents raised in
    the selected range, joined through `incident_id` -- the same basis
    alerts/incidents/MTTR already use. Filtering on the item's own
    generation timestamp instead (command_issued_time, triage_time) drifts
    from that: both are set to "now" whenever the watcher processes a
    fixture incident, regardless of how old the incident itself is, which
    made those widgets ignore the selected range in practice."""
    if not since:
        return items
    kept = []
    for item in items:
        incident = store.get_incident(item.get("incident_id"))
        raised = incident.get("incident_raised_time") if incident else None
        if raised and raised > since:
            kept.append(item)
    return kept


def _mttr_rows(store, since: Optional[str]) -> list[dict]:
    """Same join scripts/mttr_report.py's compute_mttr_rows performs
    (response_actions -> incidents), scoped to this file rather than
    imported from scripts/ to keep that module standalone-executable. The
    shared part -- the actual mean/median/p90 math -- lives in
    backend/metrics/calc.py and is not duplicated here."""
    rows = []
    for action in store.list_all_response_actions():
        executed = action.get("response_executed_time")
        incident_id = action.get("incident_id")
        if not executed or not incident_id:
            continue
        incident = store.get_incident(incident_id)
        if incident is None:
            continue
        raised = incident.get("incident_raised_time")
        if not raised or (since and raised <= since):
            continue
        rows.append({"raised": raised, "executed": executed, "scenario": incident.get("matched_scenario")})
    return rows


def _mttr_by_scenario(rows: list[dict]) -> dict[str, dict]:
    by_scenario: dict[str, list[dict]] = {}
    for row in rows:
        key = row["scenario"] or "(none)"
        by_scenario.setdefault(key, []).append(row)
    return {
        scenario: calc.compute_duration_stats([(r["raised"], r["executed"]) for r in group])
        for scenario, group in by_scenario.items()
    }


@router.get("/summary")
def get_summary(range: str = "7d", store=Depends(get_store), _key=Depends(require_dashboard_key)):
    since = _since_for_range(range)

    total_alerts = store.count_alerts(since=since)
    total_incidents = store.count_incidents(since=since)
    critical_incidents = store.count_incidents(since=since, severity="critical")

    mttr_rows = _mttr_rows(store, since)
    mttr_stats = calc.compute_duration_stats([(r["raised"], r["executed"]) for r in mttr_rows])
    mttr_by_scenario = _mttr_by_scenario(mttr_rows)
    ratio = calc.compute_alert_to_incident_ratio(total_alerts, total_incidents)

    actions = _filter_by_incident_range(store.list_all_response_actions(), store, since)
    mode_counts: dict[str, int] = {}
    for action in actions:
        mode = action.get("mode") or "unknown"
        mode_counts[mode] = mode_counts.get(mode, 0) + 1

    return {
        **_envelope(range, since),
        "total_alerts": _metric(total_alerts),
        "total_incidents": _metric(total_incidents),
        "critical_incidents": _metric(critical_incidents),
        "mttd": _pending(),  # attack_action_time doesn't exist in the contract yet -- see docs/interfaces.md
        "mttd_by_scenario": _pending({}),
        "mttr": _metric(mttr_stats),
        "mttr_by_scenario": _metric(mttr_by_scenario),
        "alert_to_incident_ratio": _metric(ratio),
        "response_actions_by_mode": _metric(mode_counts),
    }


@router.get("/timeseries")
def get_timeseries(range: str = "7d", store=Depends(get_store), _key=Depends(require_dashboard_key)):
    since = _since_for_range(range)
    buckets = store.alerts_timeseries(since=since, interval=_interval_for_range(range))
    return {**_envelope(range, since), "buckets": _metric(buckets)}


@router.get("/top")
def get_top(range: str = "7d", store=Depends(get_store), _key=Depends(require_dashboard_key)):
    since = _since_for_range(range)
    # False-positive rate needs the raw false_positive label per alert, not
    # just a count -- fetched once here (detection quality is naturally a
    # per-rule breakdown, same as top_rules) rather than as its own endpoint.
    alerts_in_range = store.list_alerts(since=since, limit=10_000)
    fp_rate_by_rule = calc.compute_false_positive_rate(alerts_in_range)
    return {
        **_envelope(range, since),
        "top_hosts": _metric(store.alerts_top_terms("host", since=since, size=5)),
        "top_rules": _metric(store.alerts_top_terms("rule_id", since=since, size=5)),
        "top_users": _metric(store.alerts_top_terms("user", since=since, size=5)),
        "fp_rate_by_rule": _metric(fp_rate_by_rule),
    }


@router.get("/mitre")
def get_mitre(range: str = "7d", store=Depends(get_store), _key=Depends(require_dashboard_key)):
    since = _since_for_range(range)
    fired = store.alerts_by_technique_tactic(since=since)
    coverage = parse_rule_coverage(_RULES_DIR)

    fired_techniques = {row["technique"] for row in fired}
    cells = [{**row, "status": "fired"} for row in fired]
    for technique in coverage:
        if technique not in fired_techniques:
            cells.append({"technique": technique, "tactic": None, "count": 0, "status": "covered_not_fired"})

    return {
        **_envelope(range, since),
        # rules/ has no .yml files yet on this branch -- coverage is
        # genuinely unknown, not "zero", until Person A adds real rules.
        "coverage_status": "pending_upstream" if not coverage else "ok",
        "techniques": _metric(cells),
    }


@router.get("/response")
def get_response_metrics(range: str = "7d", store=Depends(get_store), _key=Depends(require_dashboard_key)):
    since = _since_for_range(range)
    actions = _filter_by_incident_range(store.list_all_response_actions(), store, since)
    success_rate = calc.compute_response_success_rate(actions)

    settings = get_settings()
    kill_switch = KillSwitch(settings.kill_switch_path)

    # success_rate["live"]/["dry_run"] are always-populated dicts (a
    # "total": 0 shape, not {}) -- the generic _metric() emptiness check
    # can't tell that apart from real data, so status is decided here on
    # the actual count, same fix as /pipeline below.
    live_stats = success_rate["live"]
    dry_run_stats = success_rate["dry_run"]

    return {
        **_envelope(range, since),
        "by_action": _metric(success_rate["by_action"]),
        "live": {"value": live_stats, "status": "no_data" if live_stats["total"] == 0 else "ok"},
        "dry_run": {"value": dry_run_stats, "status": "no_data" if dry_run_stats["total"] == 0 else "ok"},
        "kill_switch": kill_switch.is_set(),
        "response_mode": global_mode(settings.response_live),
    }


@router.get("/triage")
def get_triage_metrics(range: str = "7d", store=Depends(get_store), _key=Depends(require_dashboard_key)):
    since = _since_for_range(range)
    records = _filter_by_incident_range(store.list_all_triage(), store, since)
    stats = calc.compute_triage_stats(records)
    return {**_envelope(range, since), "stats": _metric(stats)}


@router.get("/pipeline")
def get_pipeline(store=Depends(get_store), _key=Depends(require_dashboard_key)):
    sources = ["logs-normalized", "alerts", "incidents", "incident_triage", "response_actions"]
    health = {}
    for name in sources:
        result = store.index_health(name)
        if result is None:
            health[name] = _pending()
        else:
            # _metric()'s emptiness check looks at the top-level value, but
            # here the value is always a populated {"count", ...} dict --
            # "empty" means count == 0, not "falsy dict".
            health[name] = {"value": result, "status": "no_data" if result["count"] == 0 else "ok"}
    return {**_envelope("all", None), "sources": health}
