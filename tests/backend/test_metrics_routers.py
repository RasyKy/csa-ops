"""GET /metrics/* against FixtureStore. Fixture data (2026-09-10 to
2026-09-13) is intentionally older than "now" during real test runs, so
range=24h/7d naturally exercise the no_data path and range=30d/all
naturally exercise the ok path, without needing special test data."""
import pytest

from backend.app.config import get_settings
from engine.response import commander

from .conftest import AGENT_KEY, DASHBOARD_KEY

DASH = {"X-API-Key": DASHBOARD_KEY}
AGENT = {"X-API-Key": AGENT_KEY}

ENDPOINTS = [
    "/metrics/summary", "/metrics/timeseries", "/metrics/top", "/metrics/mitre",
    "/metrics/response", "/metrics/triage", "/metrics/pipeline",
]


def test_every_endpoint_requires_dashboard_key(client):
    for path in ENDPOINTS:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=AGENT).status_code == 403, path


def test_every_endpoint_returns_200_with_dashboard_key(client):
    for path in ENDPOINTS:
        r = client.get(path, headers=DASH)
        assert r.status_code == 200, (path, r.text)


# --- /metrics/summary ---

def test_summary_shows_no_data_for_a_range_before_any_fixture_data(client):
    r = client.get("/metrics/summary?range=24h", headers=DASH)
    body = r.json()
    assert body["range"] == "24h"
    assert body["total_alerts"] == {"value": 0, "status": "no_data"}
    assert body["total_incidents"] == {"value": 0, "status": "no_data"}


def test_summary_shows_real_data_across_all_time(client):
    r = client.get("/metrics/summary?range=all", headers=DASH)
    body = r.json()
    assert body["since"] is None
    assert body["total_alerts"] == {"value": 8, "status": "ok"}
    assert body["total_incidents"] == {"value": 5, "status": "ok"}
    assert body["critical_incidents"] == {"value": 1, "status": "ok"}
    assert body["alert_to_incident_ratio"]["status"] == "ok"
    assert body["alert_to_incident_ratio"]["value"] == 8 / 5


def test_summary_mttd_is_always_pending_upstream(client):
    # attack_action_time does not exist anywhere in the contract yet.
    r = client.get("/metrics/summary?range=all", headers=DASH)
    assert r.json()["mttd"] == {"value": None, "status": "pending_upstream"}


def test_summary_mttr_no_data_when_no_response_actions_executed(client):
    # Fixture-mode incidents never get a response_executed_time unless a
    # test explicitly sets one (no agent runs against fixtures).
    r = client.get("/metrics/summary?range=all", headers=DASH)
    body = r.json()
    assert body["mttr"]["status"] == "no_data"
    assert body["mttr_by_scenario"] == {"value": {}, "status": "no_data"}
    assert body["mttd_by_scenario"] == {"value": {}, "status": "pending_upstream"}


def test_summary_mttr_by_scenario_groups_executed_actions(client):
    store = client.app.state.store
    settings = get_settings()

    incident = store.get_incident("inc-0003")  # credential_dump_chain
    doc = commander.handle_incident(incident, store=store, settings=settings)
    store.update_response_action(doc["action_id"], {
        "status": "executed", "response_executed_time": "2026-09-13T10:15:05.000Z",  # 2s
    })

    r = client.get("/metrics/summary?range=all", headers=DASH)
    body = r.json()
    assert body["mttr_by_scenario"]["status"] == "ok"
    scenario_stats = body["mttr_by_scenario"]["value"]
    assert scenario_stats["credential_dump_chain"]["count"] == 1
    assert scenario_stats["credential_dump_chain"]["mean"] == pytest.approx(1.999)


def test_summary_response_actions_by_mode_scoped_by_incident_raised_time(client):
    # Same fix as /metrics/response: command_issued_time is "now", not the
    # incident's time, so it must not be what range filters on.
    r = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "log", "target": {}},  # raised 2026-09-13, outside 7d
    )
    assert r.status_code == 200

    r7d = client.get("/metrics/summary?range=7d", headers=DASH)
    rall = client.get("/metrics/summary?range=all", headers=DASH)
    assert r7d.json()["response_actions_by_mode"] == {"value": {}, "status": "no_data"}
    assert rall.json()["response_actions_by_mode"]["value"] == {"dry_run": 1}


# --- /metrics/timeseries ---

def test_timeseries_empty_range_returns_no_data(client):
    r = client.get("/metrics/timeseries?range=24h", headers=DASH)
    assert r.json()["buckets"] == {"value": [], "status": "no_data"}


def test_timeseries_buckets_by_day_and_sums_to_total_alerts(client):
    r = client.get("/metrics/timeseries?range=all", headers=DASH)
    body = r.json()
    assert body["buckets"]["status"] == "ok"
    buckets = body["buckets"]["value"]
    total = sum(sum(b["severity_counts"].values()) for b in buckets)
    assert total == 8


# --- /metrics/top ---

def test_top_returns_no_data_for_empty_range(client):
    r = client.get("/metrics/top?range=7d", headers=DASH)
    body = r.json()
    assert body["top_hosts"] == {"value": [], "status": "no_data"}


def test_top_hosts_ranked_by_count(client):
    r = client.get("/metrics/top?range=all", headers=DASH)
    body = r.json()
    top_hosts = body["top_hosts"]["value"]
    assert top_hosts[0] in [{"key": "WS02", "count": 2}, {"key": "WS04", "count": 2}, {"key": "WS01", "count": 2}]
    assert sum(h["count"] for h in top_hosts) == 8


def test_fp_rate_by_rule_reflects_labeled_alerts(client):
    r = client.get("/metrics/top?range=all", headers=DASH)
    fp_rates = r.json()["fp_rate_by_rule"]
    assert fp_rates["status"] == "ok"
    by_rule = fp_rates["value"]
    # T1059.001 has 2 labeled alerts (one FP, one not) -- 50%.
    assert by_rule["T1059.001_encoded_powershell"] == {"fp_count": 1, "total": 2, "rate": 0.5}
    # T1046 (the >30d-old fixture) is entirely false-positive.
    assert by_rule["T1046_port_scan"] == {"fp_count": 1, "total": 1, "rate": 1.0}
    # T1047 has one labeled alert, correctly not a false positive.
    assert by_rule["T1047_wmi_lateral_movement"] == {"fp_count": 0, "total": 1, "rate": 0.0}
    # Rules with zero labeled alerts (e.g. T1003) must not appear at all.
    assert "T1003_lsass_access" not in by_rule


def test_range_30d_vs_all_distinguishes_the_older_fixture(client):
    # inc-0005/alert-0005 (2026-08-01) is >30 days before a real test run's
    # "now" -- 30d must exclude it, all must include it, proving range
    # filtering actually has a working upper boundary, not just an on/off
    # "any fixture data at all" switch.
    r30 = client.get("/metrics/summary?range=30d", headers=DASH)
    rall = client.get("/metrics/summary?range=all", headers=DASH)

    assert r30.json()["total_alerts"]["value"] == 7
    assert rall.json()["total_alerts"]["value"] == 8
    assert r30.json()["total_incidents"]["value"] == 4
    assert rall.json()["total_incidents"]["value"] == 5


# --- /metrics/mitre ---

def test_mitre_coverage_status_pending_upstream_when_rules_dir_empty(client):
    # rules/ genuinely has no .yml files on this branch.
    r = client.get("/metrics/mitre?range=all", headers=DASH)
    body = r.json()
    assert body["coverage_status"] == "pending_upstream"
    assert all(cell["status"] == "fired" for cell in body["techniques"]["value"])


def test_mitre_techniques_come_from_fired_alerts(client):
    r = client.get("/metrics/mitre?range=all", headers=DASH)
    techniques = {cell["technique"] for cell in r.json()["techniques"]["value"]}
    assert "T1003" in techniques
    assert "T1059.001" in techniques


# --- /metrics/response ---

def test_response_metrics_reflects_kill_switch_and_mode(client):
    r = client.get("/metrics/response?range=all", headers=DASH)
    body = r.json()
    assert body["kill_switch"] is False
    assert body["response_mode"] == "dry_run"


def test_response_metrics_no_data_before_any_action_issued(client):
    r = client.get("/metrics/response?range=all", headers=DASH)
    body = r.json()
    assert body["by_action"] == {"value": {}, "status": "no_data"}


def test_response_metrics_dry_run_actions_reported_separately_not_as_failures(client):
    # INTAKE_ENABLED=false in the client fixture, so nothing is issued
    # automatically -- issue one manually to exercise the non-empty path.
    # The response engine's own default is dry-run (RESPONSE_LIVE unset).
    r = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "log", "target": {}},
    )
    assert r.status_code == 200

    r = client.get("/metrics/response?range=all", headers=DASH)
    body = r.json()
    # Regression: a dry-run-only system must not read as 0% success --
    # by_action/live are scoped to live actions only, and there are none.
    assert body["by_action"] == {"value": {}, "status": "no_data"}
    assert body["live"] == {"value": {"total": 0, "succeeded": 0, "rate": None}, "status": "no_data"}
    assert body["dry_run"]["status"] == "ok"
    assert body["dry_run"]["value"] == {"total": 1, "by_status": {"issued": 1}}


def test_response_metrics_scoped_by_incident_raised_time_not_command_issued_time(client):
    # inc-0003's incident_raised_time is 2026-09-13 -- outside a real test
    # run's 7d window. The manually-issued action's own command_issued_time
    # is "now" (today), which must NOT be what determines range membership,
    # or a stale/replayed incident's action would always pass any range.
    r = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "log", "target": {}},
    )
    assert r.status_code == 200

    r7d = client.get("/metrics/response?range=7d", headers=DASH)
    rall = client.get("/metrics/response?range=all", headers=DASH)
    assert r7d.json()["dry_run"] == {"value": {"total": 0, "by_status": {}}, "status": "no_data"}
    assert rall.json()["dry_run"]["value"]["total"] == 1


# --- /metrics/triage ---

def test_triage_metrics_no_data_before_any_triage_saved(client):
    r = client.get("/metrics/triage?range=all", headers=DASH)
    assert r.json()["stats"] == {"value": None, "status": "no_data"}


def test_triage_metrics_reflects_saved_triage(client):
    store = client.app.state.store
    store.save_triage({
        "incident_id": "inc-0003",
        "triage_started_time": "2026-09-13T10:15:50.000Z", "triage_time": "2026-09-13T10:16:00.000Z",
        "verdict": "true_positive", "confidence": "high", "reason": "clear",
        "model": "openai/deepseek-chat", "status": "ok", "explain": None,
    })

    r = client.get("/metrics/triage?range=all", headers=DASH)
    stats = r.json()["stats"]
    assert stats["status"] == "ok"
    assert stats["value"]["verdict_counts"] == {"true_positive": 1}
    assert stats["value"]["avg_confidence"] == 3.0


def test_triage_avg_latency_uses_triage_started_time_not_incident_raised_time(client):
    # Regression: the incident was raised long before triage ran (the norm
    # for replayed fixtures) -- latency must reflect how long the LLM call
    # actually took (10s here), not incident-age (which would read as
    # hours/days and swamp the metric, e.g. the reported "444.1h" bug).
    store = client.app.state.store
    store.save_triage({
        "incident_id": "inc-0003",  # incident_raised_time: 2026-09-13T10:15:03.001Z
        "triage_started_time": "2026-09-22T05:42:15.000Z", "triage_time": "2026-09-22T05:42:25.000Z",
        "verdict": "true_positive", "confidence": "high", "reason": "clear",
        "model": "openai/deepseek-chat", "status": "ok", "explain": None,
    })

    r = client.get("/metrics/triage?range=all", headers=DASH)
    assert r.json()["stats"]["value"]["avg_latency_seconds"] == 10.0


def test_triage_metrics_scoped_by_incident_raised_time_not_triage_time(client):
    # Mirrors the same fix for /metrics/response: a triage record's own
    # triage_time is "now" whenever it's (re-)run, regardless of how old
    # the underlying incident is -- range must scope by the incident.
    store = client.app.state.store
    store.save_triage({
        "incident_id": "inc-0003",  # incident_raised_time: 2026-09-13T10:15:03.001Z, outside 7d
        "triage_started_time": "2026-09-22T05:42:15.000Z", "triage_time": "2026-09-22T05:42:25.000Z",
        "verdict": "true_positive", "confidence": "high", "reason": "clear",
        "model": "openai/deepseek-chat", "status": "ok", "explain": None,
    })

    r7d = client.get("/metrics/triage?range=7d", headers=DASH)
    rall = client.get("/metrics/triage?range=all", headers=DASH)
    assert r7d.json()["stats"] == {"value": None, "status": "no_data"}
    assert rall.json()["stats"]["status"] == "ok"


# --- /metrics/pipeline ---

def test_pipeline_reports_pending_upstream_for_logs_normalized(client):
    # FixtureStore has never owned or fixtured this index.
    r = client.get("/metrics/pipeline", headers=DASH)
    body = r.json()
    assert body["sources"]["logs-normalized"] == {"value": None, "status": "pending_upstream"}


def test_pipeline_reports_ok_for_alerts_and_incidents(client):
    r = client.get("/metrics/pipeline", headers=DASH)
    body = r.json()
    assert body["sources"]["alerts"]["status"] == "ok"
    assert body["sources"]["alerts"]["value"]["count"] == 8
    assert body["sources"]["incidents"]["value"]["count"] == 5


def test_pipeline_reports_no_data_for_never_written_b_owned_indices(client):
    # incident_triage/response_actions exist as concepts but are empty in
    # a fresh fixture-mode store until something writes to them.
    r = client.get("/metrics/pipeline", headers=DASH)
    body = r.json()
    assert body["sources"]["incident_triage"] == {"value": {"count": 0, "latest_timestamp": None}, "status": "no_data"}
    assert body["sources"]["response_actions"] == {"value": {"count": 0, "latest_timestamp": None}, "status": "no_data"}
