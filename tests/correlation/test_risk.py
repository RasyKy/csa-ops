"""Tests for risk scoring, incident severity, and scenario classification (FR10)."""
import pytest

from engine.correlation import risk


def _alert(severity, technique="T1059.001", tactic="execution"):
    return {"severity": severity, "technique": technique, "tactic": tactic}


def test_risk_score_sums_severity_weights():
    alerts = [_alert("high"), _alert("medium")]
    assert risk.risk_score(alerts) == 30 + 15


def test_first_time_activity_adds_bonus():
    alerts = [_alert("low")]
    assert risk.risk_score(alerts, first_time_count=2) == 5 + 2 * risk.FIRST_TIME_BONUS


def test_incident_severity_is_most_severe_alert():
    assert risk.incident_severity([_alert("low"), _alert("critical"), _alert("high")]) == "critical"


@pytest.mark.parametrize("techniques,expected", [
    (["T1003.001"], "credential_dump_chain"),
    (["T1021.002"], "lateral_movement_chain"),
    (["T1047"], "lateral_movement_chain"),
    (["T1048"], "exfiltration_chain"),
    (["T1105"], "malware_drop_chain"),
    (["T1012"], None),
    (["T1547.001"], None),
])
def test_scenario_classification(techniques, expected):
    assert risk.classify_scenario(techniques) == expected


def test_credential_dump_wins_when_multiple_scenarios_present():
    # priority order: credential dump beats lateral movement
    assert risk.classify_scenario(["T1021.002", "T1003.001"]) == "credential_dump_chain"


def test_scenario_names_match_person_b_policy():
    """Every scenario this classifier can emit must be a key Person B's
    policy.yaml knows, or the response engine falls through to severity."""
    import yaml
    from pathlib import Path

    policy_path = Path(__file__).resolve().parents[2] / "engine" / "response" / "policy.yaml"
    by_scenario = yaml.safe_load(policy_path.read_text())["by_scenario"]
    emitted = {scenario for scenario, _ in risk._SCENARIO_RULES}
    assert emitted <= set(by_scenario), f"scenarios not in policy: {emitted - set(by_scenario)}"


def test_threshold():
    assert risk.should_raise(5, threshold=5) is True
    assert risk.should_raise(4, threshold=5) is False
