"""backend/metrics/calc.py -- pure functions, synthetic data only. No
Store, no ES, no HTTP: every test constructs plain dicts/tuples directly."""
from backend.metrics import calc


def test_compute_duration_stats_empty_input_returns_none():
    assert calc.compute_duration_stats([]) is None


def test_compute_duration_stats_single_pair():
    stats = calc.compute_duration_stats([("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:10.000Z")])
    assert stats == {"mean": 10.0, "median": 10.0, "p90": 10.0, "count": 1}


def test_compute_duration_stats_multiple_pairs():
    pairs = [
        ("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:10.000Z"),  # 10s
        ("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:20.000Z"),  # 20s
        ("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:30.000Z"),  # 30s
        ("2026-01-01T00:00:00.000Z", "2026-01-01T00:01:40.000Z"),  # 100s
    ]
    stats = calc.compute_duration_stats(pairs)
    assert stats["count"] == 4
    assert stats["mean"] == 40.0
    assert stats["median"] == 25.0  # midpoint of sorted [10, 20, 30, 100]
    assert stats["p90"] > stats["median"]  # skewed toward the 100s outlier


def test_compute_alert_to_incident_ratio_zero_incidents_returns_none():
    # Divide-by-zero must not raise, and must not silently report 0.0.
    assert calc.compute_alert_to_incident_ratio(alert_count=5, incident_count=0) is None


def test_compute_alert_to_incident_ratio_normal_case():
    assert calc.compute_alert_to_incident_ratio(alert_count=10, incident_count=4) == 2.5


def test_compute_false_positive_rate_empty_input():
    assert calc.compute_false_positive_rate([]) == {}


def test_compute_false_positive_rate_excludes_unlabeled_alerts():
    # A rule with zero labeled alerts must not appear at all -- not 0%,
    # not 100%, absent, so the caller can render "no data" honestly.
    alerts = [
        {"rule_id": "T1003_lsass_access"},  # no false_positive key
        {"rule_id": "T1003_lsass_access"},
    ]
    assert calc.compute_false_positive_rate(alerts) == {}


def test_compute_false_positive_rate_groups_by_rule_and_computes_rate():
    alerts = [
        {"rule_id": "T1003_lsass_access", "false_positive": True},
        {"rule_id": "T1003_lsass_access", "false_positive": False},
        {"rule_id": "T1003_lsass_access", "false_positive": False},
        {"rule_id": "T1059.001_encoded_powershell", "false_positive": False},
    ]
    result = calc.compute_false_positive_rate(alerts)
    assert result == {
        "T1003_lsass_access": {"fp_count": 1, "total": 3, "rate": 1 / 3},
        "T1059.001_encoded_powershell": {"fp_count": 0, "total": 1, "rate": 0.0},
    }


def test_compute_response_success_rate_empty_input():
    result = calc.compute_response_success_rate([])
    assert result == {
        "by_action": {},
        "live": {"total": 0, "succeeded": 0, "rate": None},
        "dry_run": {"total": 0, "by_status": {}},
    }


def test_compute_response_success_rate_splits_live_by_action_type():
    # Only live actions ever appear in by_action/"live" -- a dry-run action
    # is simulated and never "succeeds" or "fails" for real.
    actions = [
        {"action": "kill_process", "mode": "live", "status": "executed"},
        {"action": "kill_process", "mode": "live", "status": "failed"},
        {"action": "isolate_host", "mode": "live", "status": "executed"},
    ]
    result = calc.compute_response_success_rate(actions)
    assert result["by_action"]["kill_process"] == {"total": 2, "succeeded": 1, "rate": 0.5}
    assert result["by_action"]["isolate_host"] == {"total": 1, "succeeded": 1, "rate": 1.0}
    assert result["live"] == {"total": 3, "succeeded": 2, "rate": 2 / 3}
    assert result["dry_run"] == {"total": 0, "by_status": {}}


def test_compute_response_success_rate_dry_run_excluded_and_reported_separately():
    # Regression: an all-dry-run system (the only kind this project can
    # produce without a live VM, Phase 4) must not read as 0% success.
    actions = [
        {"action": "kill_process", "mode": "dry_run", "status": "issued"},
        {"action": "kill_process", "mode": "dry_run", "status": "issued"},
        {"action": "log", "mode": "dry_run", "status": "executed"},
    ]
    result = calc.compute_response_success_rate(actions)
    assert result["by_action"] == {}  # no live actions at all
    assert result["live"] == {"total": 0, "succeeded": 0, "rate": None}
    assert result["dry_run"] == {"total": 3, "by_status": {"issued": 2, "executed": 1}}


def test_compute_triage_stats_empty_input_returns_none():
    assert calc.compute_triage_stats([]) is None


def test_compute_triage_stats_failed_records_counted_separately_from_verdicts():
    records = [
        {"incident_id": "inc-1", "status": "failed", "verdict": None, "confidence": None, "triage_time": None},
    ]
    result = calc.compute_triage_stats(records)
    assert result["failed_count"] == 1
    assert result["verdict_counts"] == {}
    assert result["avg_confidence"] is None
    assert result["avg_latency_seconds"] is None


def test_compute_triage_stats_maps_confidence_and_computes_latency():
    # Latency is triage_time - triage_started_time (both on the record
    # itself), not a join to the incident's raised time -- an incident can
    # be arbitrarily old without that saying anything about triage speed.
    records = [
        {
            "incident_id": "inc-1", "status": "ok", "verdict": "true_positive", "confidence": "high",
            "triage_started_time": "2026-01-01T00:00:00.000Z", "triage_time": "2026-01-01T00:00:05.000Z",
        },
        {
            "incident_id": "inc-1", "status": "ok", "verdict": "true_positive", "confidence": "low",
            "triage_started_time": "2026-01-01T00:00:00.000Z", "triage_time": "2026-01-01T00:00:15.000Z",
        },
    ]
    result = calc.compute_triage_stats(records)

    assert result["verdict_counts"] == {"true_positive": 2}
    assert result["failed_count"] == 0
    assert result["total_count"] == 2
    assert result["avg_confidence"] == 2.0  # (high=3 + low=1) / 2
    assert result["avg_latency_seconds"] == 10.0  # (5s + 15s) / 2


def test_compute_triage_stats_missing_triage_started_time_skips_latency_but_keeps_verdict():
    # Records written before triage_started_time existed (or an old
    # incident's triage_time drifting far from incident_raised_time, the
    # bug this replaces) must not produce a fake/huge latency number.
    records = [
        {"incident_id": "inc-missing", "status": "ok", "verdict": "needs_review", "confidence": "medium", "triage_time": "2026-01-01T00:00:00.000Z"},
    ]
    result = calc.compute_triage_stats(records)
    assert result["verdict_counts"] == {"needs_review": 1}
    assert result["avg_confidence"] == 2.0
    assert result["avg_latency_seconds"] is None
