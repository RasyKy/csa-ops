"""Tests for DetectionEngine: alert shape matches docs/interfaces.md 4.2 and
validates against Person B's Alert model; stream order drives first-time flags."""
from backend.app.models.alert import Alert
from engine.detection.engine import DetectionEngine


def _powershell(event_id, cmd, host="WS01", user="CORP\\alice"):
    return {
        "event_id": event_id, "timestamp": "2026-09-20T09:00:00.000Z",
        "event_type": "process_start", "host": host, "user": user,
        "process_name": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "pid": 1280, "parent_process_name": "C:\\Windows\\explorer.exe", "parent_pid": 900,
        "command_line": cmd,
    }


def test_alert_matches_person_b_contract():
    engine = DetectionEngine()
    result = engine.evaluate(_powershell("e1", "powershell.exe -enc AAAA"))
    assert len(result.alerts) == 1
    alert = result.alerts[0]
    # Person B's pydantic model is the contract; if this parses, 4.2 holds.
    model = Alert(**alert)
    assert model.rule_id == "T1059.001_encoded_powershell"
    assert model.technique == "T1059.001"
    assert model.tactic == "execution"
    assert model.severity == "high"
    assert model.host == "WS01"
    assert model.pid == 1280
    assert model.ppid == 900
    assert model.command_line == "powershell.exe -enc AAAA"


def test_no_alert_on_benign_event():
    engine = DetectionEngine()
    assert engine.evaluate(_powershell("e1", "powershell.exe -Command Get-Date")).alerts == []


def test_first_time_flag_only_on_first_occurrence():
    engine = DetectionEngine()
    first = engine.evaluate(_powershell("e1", "powershell.exe -Command X"))
    second = engine.evaluate(_powershell("e2", "powershell.exe -Command Y"))
    assert first.first_time_process is True
    assert second.first_time_process is False


def test_evaluate_stream_returns_all_alerts():
    engine = DetectionEngine()
    alerts = engine.evaluate_stream([
        _powershell("e1", "powershell.exe -enc AAAA"),
        _powershell("e2", "powershell.exe -Command safe"),
        _powershell("e3", "powershell.exe -encodedcommand BBBB"),
    ])
    assert len(alerts) == 2
    assert {a["event_id"] for a in alerts} == {"e1", "e3"}
