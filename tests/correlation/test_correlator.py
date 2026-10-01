"""Tests for the Correlator (FR9 + FR10): incident shape validates against
Person B's Incident model, threshold gating, incident_raised_time, FR23 ratio."""
from backend.app.models.incident import Incident
from engine.correlation.correlator import Correlator


def _alert(alert_id, event_id, severity, technique, tactic):
    return {"alert_id": alert_id, "event_id": event_id, "severity": severity,
            "technique": technique, "tactic": tactic, "host": "WS01", "user": "CORP\\alice"}


def _ev(event_id, pid, ppid, etype="process_start", **extra):
    return {"event_id": event_id, "pid": pid, "parent_pid": ppid, "event_type": etype,
            "host": "WS01", "user": "CORP\\alice", "timestamp": "2026-09-20T09:00:00.000Z",
            "process_name": f"proc{pid}.exe", "command_line": "cmd", **extra}


def _fixed_correlator():
    ids = iter(f"inc-{i}" for i in range(100))
    return Correlator(id_factory=lambda: next(ids), clock=lambda: "2026-09-20T09:00:05.000Z")


def test_incident_validates_against_person_b_model():
    events = [_ev("e1", 100, 4), _ev("e2", 200, 100, etype="process_access", target_process_name="lsass.exe")]
    alerts = [_alert("al1", "e2", "high", "T1003.001", "credential_access")]
    run = _fixed_correlator().correlate(events, alerts)
    assert run.incident_count == 1
    incident = run.incidents[0]
    model = Incident(**incident)  # raises if the 4.3 contract is violated
    assert model.incident_id == "inc-0"
    assert model.incident_raised_time == "2026-09-20T09:00:05.000Z"
    assert model.matched_scenario == "credential_dump_chain"
    assert model.severity == "high"
    assert "T1003.001" in model.techniques


def test_below_threshold_raises_nothing():
    events = [_ev("e1", 100, 4)]
    alerts = [_alert("al1", "e1", "low", "T1012", "discovery")]
    run = Correlator(threshold=6).correlate(events, alerts)  # low weight 5 < 6
    assert run.incident_count == 0


def test_cluster_without_alert_is_not_an_incident():
    events = [_ev("e1", 100, 4), _ev("e2", 200, 100)]
    run = _fixed_correlator().correlate(events, alerts=[])
    assert run.incident_count == 0


def test_noise_reduction_ratio_counts_all_raw_alerts():
    # two alerts in one linked cluster -> one incident, ratio 2:1
    events = [_ev("e1", 100, 4), _ev("e2", 200, 100)]
    alerts = [
        _alert("al1", "e1", "high", "T1059.001", "execution"),
        _alert("al2", "e2", "high", "T1003.001", "credential_access"),
    ]
    run = _fixed_correlator().correlate(events, alerts)
    assert run.incident_count == 1
    assert run.raw_alert_count == 2
    assert run.noise_reduction_ratio == 2.0


def test_targets_are_derived_from_cluster():
    events = [
        _ev("e1", 100, 4),
        _ev("e2", 100, 4, etype="network_connection", dest_ip="203.0.113.9"),
        _ev("e3", 100, 4, etype="file_event", file_path="C:\\x.exe"),
    ]
    alerts = [_alert("al1", "e1", "high", "T1048", "exfiltration")]
    incident = _fixed_correlator().correlate(events, alerts).incidents[0]
    assert incident["targets"]["remote_ips"] == ["203.0.113.9"]
    assert incident["targets"]["file_paths"] == ["C:\\x.exe"]
    assert 100 in incident["targets"]["pids"]
