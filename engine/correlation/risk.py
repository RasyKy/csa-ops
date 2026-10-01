"""Risk scoring, incident severity, and scenario classification (FR10).

The risk score of a cluster is the sum of its alerts' severity weights, plus a
small bonus when the cluster contains first-time behavioural activity (FR8
feeding FR10). An incident is raised when the score reaches RAISE_THRESHOLD.

matched_scenario is derived from which techniques fired, using the scenario
names Person B's engine/response/policy.yaml keys off (credential_dump_chain,
lateral_movement_chain, exfiltration_chain, malware_drop_chain). A cluster
whose techniques match none of these has matched_scenario = null, which the
policy handles by falling back to the severity default.
"""
from __future__ import annotations

SEVERITY_WEIGHTS = {"low": 5, "medium": 15, "high": 30, "critical": 50}
SEVERITY_ORDER = ["low", "medium", "high", "critical"]
FIRST_TIME_BONUS = 5
RAISE_THRESHOLD = 5

# Scenario name -> technique prefixes that imply it, in priority order. The
# first scenario with a matching technique wins.
_SCENARIO_RULES = [
    ("credential_dump_chain", ("T1003",)),
    ("lateral_movement_chain", ("T1021", "T1047")),
    ("exfiltration_chain", ("T1048",)),
    ("malware_drop_chain", ("T1105",)),
]


def severity_weight(severity: str) -> int:
    return SEVERITY_WEIGHTS.get(severity, 0)


def risk_score(alerts: list[dict], first_time_count: int = 0) -> int:
    base = sum(severity_weight(a.get("severity")) for a in alerts)
    return base + FIRST_TIME_BONUS * first_time_count


def incident_severity(alerts: list[dict]) -> str:
    """The most severe alert severity in the cluster (most severe wins)."""
    present = [a.get("severity") for a in alerts if a.get("severity") in SEVERITY_ORDER]
    if not present:
        return "low"
    return max(present, key=SEVERITY_ORDER.index)


def classify_scenario(techniques: list[str]) -> str | None:
    for scenario, prefixes in _SCENARIO_RULES:
        if any(t.startswith(prefixes) for t in techniques):
            return scenario
    return None


def should_raise(score: int, threshold: int = RAISE_THRESHOLD) -> bool:
    return score >= threshold
