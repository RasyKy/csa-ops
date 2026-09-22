"""Pure metric calculations for the metrics page. No ES, no HTTP, no Store
dependency -- every function takes plain data in and returns plain data
out, so it's testable with synthetic input alone.

MTTD and MTTR are both "duration between two ISO timestamps" -- the same
shape scripts/mttr_report.py already computes for MTTR, generalized here
so that script can import instead of keeping its own copy of the math.
"""
import math
from datetime import datetime
from typing import Optional

_CONFIDENCE_SCALE = {"low": 1, "medium": 2, "high": 3}


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Linear interpolation between closest ranks, matching numpy's default
    'linear' method. `sorted_values` must be non-empty and sorted."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * (pct / 100)
    f, c = math.floor(k), math.ceil(k)
    if f == c:
        return sorted_values[int(k)]
    return sorted_values[f] * (c - k) + sorted_values[c] * (k - f)


def compute_duration_stats(pairs: list[tuple[str, str]]) -> Optional[dict]:
    """`pairs` of (start_iso, end_iso) -- e.g. (incident_raised_time,
    response_executed_time) for MTTR, or (attack_action_time,
    incident_raised_time) for MTTD once that field exists. Empty input
    returns None rather than a fake zero -- callers must render that as
    "no data", not "0 seconds"."""
    if not pairs:
        return None
    durations = sorted((_parse_ts(end) - _parse_ts(start)).total_seconds() for start, end in pairs)
    return {
        "mean": sum(durations) / len(durations),
        "median": _percentile(durations, 50),
        "p90": _percentile(durations, 90),
        "count": len(durations),
    }


def compute_alert_to_incident_ratio(alert_count: int, incident_count: int) -> Optional[float]:
    if incident_count == 0:
        return None
    return alert_count / incident_count


def compute_false_positive_rate(alerts: list[dict]) -> dict[str, dict]:
    """Grouped by rule_id. Only alerts that actually carry a
    `false_positive` label (True or False, not absent) count toward a
    rule's total -- a rule with zero labeled alerts doesn't appear in the
    result at all, rather than being assumed 0% or 100%."""
    by_rule: dict[str, list[bool]] = {}
    for alert in alerts:
        label = alert.get("false_positive")
        if label is None:
            continue
        rule_id = alert.get("rule_id", "unknown")
        by_rule.setdefault(rule_id, []).append(bool(label))

    return {
        rule_id: {
            "fp_count": sum(labels),
            "total": len(labels),
            "rate": sum(labels) / len(labels),
        }
        for rule_id, labels in by_rule.items()
    }


def compute_response_success_rate(actions: list[dict]) -> dict:
    """A dry-run action is simulated -- it never "succeeds" or "fails" in
    the real-world sense (CLAUDE.md rule 2), so folding it into the same
    success rate as live actions is misleading: an issued-but-unconfirmed
    dry-run (no agent has reported a result) reads as a 0% failure rate
    instead of "nothing live has run yet". Success rate ("succeeded" means
    status == "executed", the only status representing a completed,
    confirmed action per docs/interfaces.md 4.5) is computed from live
    actions only; dry-run actions are broken out separately by status."""

    def _rate(group: list[dict]) -> dict:
        total = len(group)
        succeeded = sum(1 for a in group if a.get("status") == "executed")
        return {"total": total, "succeeded": succeeded, "rate": (succeeded / total) if total else None}

    live_actions = [a for a in actions if a.get("mode") == "live"]
    dry_run_actions = [a for a in actions if a.get("mode") == "dry_run"]

    by_action: dict[str, list[dict]] = {}
    for action in live_actions:
        by_action.setdefault(action.get("action") or "unknown", []).append(action)

    dry_run_by_status: dict[str, int] = {}
    for action in dry_run_actions:
        status = action.get("status") or "unknown"
        dry_run_by_status[status] = dry_run_by_status.get(status, 0) + 1

    return {
        "by_action": {key: _rate(group) for key, group in by_action.items()},
        "live": _rate(live_actions),
        "dry_run": {"total": len(dry_run_actions), "by_status": dry_run_by_status},
    }


def compute_triage_stats(triage_records: list[dict]) -> Optional[dict]:
    """Latency is triage_time (finish) minus triage_started_time (start) --
    both timestamps `triage_incident()` itself captures around the LLM
    call, not a join against the incident's raised time. The incident can
    be arbitrarily old (a replayed fixture, a backlog item); how long the
    incident has existed says nothing about how fast triage itself ran.
    Records written before `triage_started_time` existed lack it and are
    skipped for latency, not treated as instant."""
    if not triage_records:
        return None

    verdict_counts: dict[str, int] = {}
    confidence_values: list[int] = []
    latencies: list[float] = []
    failed_count = 0

    for record in triage_records:
        if record.get("status") != "ok":
            failed_count += 1
            continue

        verdict = record.get("verdict")
        if verdict:
            verdict_counts[verdict] = verdict_counts.get(verdict, 0) + 1

        confidence = _CONFIDENCE_SCALE.get(record.get("confidence"))
        if confidence is not None:
            confidence_values.append(confidence)

        started = record.get("triage_started_time")
        finished = record.get("triage_time")
        if started and finished:
            latencies.append((_parse_ts(finished) - _parse_ts(started)).total_seconds())

    return {
        "verdict_counts": verdict_counts,
        "failed_count": failed_count,
        "total_count": len(triage_records),
        "avg_confidence": (sum(confidence_values) / len(confidence_values)) if confidence_values else None,
        "avg_latency_seconds": (sum(latencies) / len(latencies)) if latencies else None,
    }
