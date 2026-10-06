"""Pure case metrics: how analyst verdicts compare with the AI's, case status
counts, time to resolve, and analyst verdicts per detection rule.

Plain data in, plain data out: no I/O, no store, no HTTP. The inputs are lists
and dicts shaped like the incident, triage and case documents (cases as
Case.model_dump(mode="json")). Case data is bookkeeping: nothing here feeds
detection, correlation, scoring, response actions or AI output.
"""
import math
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

CONFUSION_KEYS = (
    "ai_malicious_analyst_malicious",
    "ai_malicious_analyst_benign",
    "ai_benign_analyst_malicious",
    "ai_benign_analyst_benign",
)

_ANALYST_VERDICTS = ("true_positive", "false_positive", "benign_activity", "undetermined")


def side_of_ai(verdict: Any) -> Optional[str]:
    """malicious, benign or uncertain; None for a missing or unknown verdict."""
    if verdict in ("true_positive", "likely_true_positive"):
        return "malicious"
    if verdict in ("false_positive", "likely_false_positive"):
        return "benign"
    if verdict == "needs_review":
        return "uncertain"
    return None


def side_of_analyst(verdict: Any) -> Optional[str]:
    """malicious or benign; None for undetermined, missing or unknown."""
    if verdict == "true_positive":
        return "malicious"
    if verdict in ("false_positive", "benign_activity"):
        return "benign"
    return None


def _case_of(cases_by_id: Any, incident_id: Any) -> Optional[dict]:
    if not isinstance(cases_by_id, dict):
        return None
    case = cases_by_id.get(incident_id)
    return case if isinstance(case, dict) else None


def _is_resolved(case: Optional[dict]) -> bool:
    return bool(case) and case.get("status") == "resolved"


def _incident_ids(incidents: Iterable[Any]) -> list[str]:
    return [i["incident_id"] for i in incidents or [] if isinstance(i, dict) and isinstance(i.get("incident_id"), str)]


def compute_ai_agreement(incidents: list, triage_by_id: dict, cases_by_id: dict) -> dict:
    """Resolved cases only (a reopened case is investigating, so it does not
    count). Every resolved case lands in exactly one of scored, ai_uncertain or
    unscored, so resolved_total == scored + ai_uncertain + unscored.

    unscored: the analyst said undetermined, or the AI has no usable verdict
    (no triage record, a failed run, or no verdict)."""
    confusion = {key: 0 for key in CONFUSION_KEYS}
    resolved_total = scored = agree = disagree = ai_uncertain = unscored = 0
    triage_by_id = triage_by_id if isinstance(triage_by_id, dict) else {}

    for incident_id in _incident_ids(incidents):
        case = _case_of(cases_by_id, incident_id)
        if not _is_resolved(case):
            continue
        resolved_total += 1

        analyst = side_of_analyst(case.get("verdict"))
        triage = triage_by_id.get(incident_id)
        ai = None
        if isinstance(triage, dict) and triage.get("status") != "failed":
            ai = side_of_ai(triage.get("verdict"))

        if analyst is None or ai is None:
            unscored += 1
        elif ai == "uncertain":
            ai_uncertain += 1
        else:
            scored += 1
            confusion[f"ai_{ai}_analyst_{analyst}"] += 1
            if ai == analyst:
                agree += 1
            else:
                disagree += 1

    return {
        "resolved_total": resolved_total,
        "scored": scored,
        "agree": agree,
        "disagree": disagree,
        "ai_uncertain": ai_uncertain,
        "unscored": unscored,
        "confusion": confusion,
    }


def compute_status_counts(incidents: list, cases_by_id: dict) -> dict:
    """open, investigating and resolved counts over the given incidents. An
    incident without a stored case, or with an unknown status, is open."""
    counts = {"open": 0, "investigating": 0, "resolved": 0}
    for incident_id in _incident_ids(incidents):
        case = _case_of(cases_by_id, incident_id)
        status = case.get("status") if case else None
        counts[status if status in ("investigating", "resolved") else "open"] += 1
    return counts


def _parse_time(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Linear interpolation between closest ranks (numpy's default)."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * (pct / 100)
    lower, upper = math.floor(k), math.ceil(k)
    if lower == upper:
        return sorted_values[int(k)]
    return sorted_values[lower] * (upper - k) + sorted_values[upper] * (k - lower)


def _median(sorted_values: list[float]) -> float:
    n = len(sorted_values)
    middle = n // 2
    return sorted_values[middle] if n % 2 else (sorted_values[middle - 1] + sorted_values[middle]) / 2


def compute_resolve_times(cases_by_id: dict, incident_ids: Iterable[str]) -> dict:
    """For each resolved case: seconds from its first event to its LAST resolved
    event (a case that was reopened and resolved again counts to the second
    resolution). Cases with missing or unparseable times, or an end before the
    start, are skipped. Empty input gives count 0 and null values."""
    values: list[float] = []
    for incident_id in incident_ids or []:
        case = _case_of(cases_by_id, incident_id)
        if not _is_resolved(case):
            continue
        events = case.get("events")
        if not isinstance(events, list):
            continue
        events = [e for e in events if isinstance(e, dict)]
        if not events:
            continue
        start = _parse_time(events[0].get("time"))
        resolved = [e for e in events if e.get("type") == "resolved"]
        end = _parse_time(resolved[-1].get("time")) if resolved else None
        if start is None or end is None:
            continue
        seconds = (end - start).total_seconds()
        if seconds < 0:
            continue
        values.append(seconds)

    if not values:
        return {"count": 0, "median_seconds": None, "p90_seconds": None, "values_seconds": None}
    values.sort()
    return {
        "count": len(values),
        "median_seconds": _median(values),
        "p90_seconds": _percentile(values, 90),
        "values_seconds": values,
    }


def compute_verdicts_by_rule(alerts: list, incidents: list, cases_by_id: dict) -> dict:
    """{rule_id: {true_positive, false_positive, benign_activity, undetermined,
    total}}. Each alert of an incident whose case is resolved counts once under
    its rule_id with the incident's analyst verdict (joined through
    incident.alert_ids). Alerts that cannot be found are skipped."""
    alerts_by_id = {a["alert_id"]: a for a in alerts or [] if isinstance(a, dict) and "alert_id" in a}
    result: dict[str, dict] = {}

    for incident in incidents or []:
        if not isinstance(incident, dict):
            continue
        case = _case_of(cases_by_id, incident.get("incident_id"))
        if not _is_resolved(case):
            continue
        verdict = case.get("verdict")
        if verdict not in _ANALYST_VERDICTS:
            continue
        alert_ids = incident.get("alert_ids")
        if not isinstance(alert_ids, list):
            continue
        for alert_id in dict.fromkeys(a for a in alert_ids if isinstance(a, str)):
            alert = alerts_by_id.get(alert_id)
            rule_id = alert.get("rule_id") if alert else None
            if not isinstance(rule_id, str) or not rule_id:
                continue
            row = result.setdefault(
                rule_id,
                {"true_positive": 0, "false_positive": 0, "benign_activity": 0, "undetermined": 0, "total": 0},
            )
            row[verdict] += 1
            row["total"] += 1
    return result
