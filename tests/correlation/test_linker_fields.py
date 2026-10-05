import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.config import get_settings
from backend.app.main import app
from backend.app.models.incident import ChainNode, Incident
from engine.correlation.linker import _node
from engine.pipeline import run

SAMPLE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "normalized_events.sample.json"
DASHBOARD_KEY = "csa-dashboard-insecure-dev-key"
HEADERS = {"X-API-Key": DASHBOARD_KEY}


@pytest.fixture
def sample_events():
    with open(SAMPLE_PATH, encoding="utf-8") as f:
        return json.load(f)


def test_node_outputs_fields_for_all_five_event_types(sample_events):
    # 1. process_start
    ev_ps = next(e for e in sample_events if e.get("event_type") == "process_start")
    node_ps = _node(ev_ps)
    assert node_ps["event_type"] == "process_start"
    assert node_ps["host"] == ev_ps.get("host")
    assert node_ps["detail"] is None

    # 2. network_connection
    ev_net = next(e for e in sample_events if e.get("event_type") == "network_connection")
    node_net = _node(ev_net)
    assert node_net["event_type"] == "network_connection"
    assert node_net["host"] == ev_net.get("host")
    assert node_net["detail"] == f"{ev_net.get('dest_ip')}:{ev_net.get('dest_port')}"

    # 3. file_event
    ev_file = next(e for e in sample_events if e.get("event_type") == "file_event")
    node_file = _node(ev_file)
    assert node_file["event_type"] == "file_event"
    assert node_file["host"] == ev_file.get("host")
    assert node_file["detail"] == ev_file.get("file_path")

    # 4. registry_event
    ev_reg = next(e for e in sample_events if e.get("event_type") == "registry_event")
    node_reg = _node(ev_reg)
    assert node_reg["event_type"] == "registry_event"
    assert node_reg["host"] == ev_reg.get("host")
    assert node_reg["detail"] == ev_reg.get("registry_key")

    # 5. process_access
    ev_pa = next(e for e in sample_events if e.get("event_type") == "process_access")
    node_pa = _node(ev_pa)
    assert node_pa["event_type"] == "process_access"
    assert node_pa["host"] == ev_pa.get("host")
    assert node_pa["detail"] == "lsass.exe (pid 700)"


def test_node_detail_truncation_and_missing_fields():
    # Long file path truncation to 200 chars
    long_path = "C:\\" + "a" * 250 + ".txt"
    ev = {"event_type": "file_event", "file_path": long_path, "host": "WS01"}
    node = _node(ev)
    assert node["detail"] is not None
    assert len(node["detail"]) == 200
    assert node["detail"] == long_path[:200]

    # network_connection without port
    ev_ip_only = {"event_type": "network_connection", "dest_ip": "1.2.3.4", "dest_port": None, "host": "WS01"}
    node_ip = _node(ev_ip_only)
    assert node_ip["detail"] == "1.2.3.4"

    # missing destination fields
    ev_empty_net = {"event_type": "network_connection", "host": "WS01"}
    node_empty_net = _node(ev_empty_net)
    assert node_empty_net["detail"] is None

    # process_access with missing target_pid
    ev_pa_no_pid = {"event_type": "process_access", "target_process_name": "notepad.exe", "host": "WS01"}
    node_pa_no_pid = _node(ev_pa_no_pid)
    assert node_pa_no_pid["detail"] is None


def test_node_without_optional_fields_validates():
    node_dict = {
        "event_id": "evt-legacy-1",
        "pid": 1234,
        "ppid": 100,
        "image": "C:\\legacy.exe",
        "command_line": None,
        "timestamp": "2026-09-20T09:00:00.000Z",
        "technique": None,
        "rule_id": None,
    }
    # Validates against ChainNode
    chain_node = ChainNode(**node_dict)
    assert chain_node.event_type is None
    assert chain_node.host is None
    assert chain_node.detail is None

    # Validates within an Incident document
    incident_dict = {
        "incident_id": "inc-legacy-1",
        "incident_raised_time": "2026-09-20T09:00:05.000Z",
        "host": "WS01",
        "user": "CORP\\user",
        "severity": "low",
        "risk_score": 10,
        "matched_scenario": None,
        "techniques": [],
        "tactics": [],
        "alert_ids": ["alert-1"],
        "chain": {
            "nodes": [node_dict],
            "edges": [],
        },
        "targets": {
            "pids": [1234],
            "remote_ips": [],
            "file_paths": [],
        },
    }
    incident = Incident(**incident_dict)
    assert incident.chain.nodes[0].event_type is None


def test_incident_graph_endpoint_returns_fields(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHBOARD_API_KEY", DASHBOARD_KEY)
    monkeypatch.setenv("STORE_BACKEND", "fixtures")
    monkeypatch.setenv("KILL_SWITCH_PATH", str(tmp_path / "killswitch"))
    monkeypatch.setenv("INTAKE_STATE_PATH", str(tmp_path / "intake_state.json"))
    monkeypatch.setenv("RESPONSE_ACTIONS_PATH", str(tmp_path / "response_actions.json"))
    monkeypatch.setenv("INCIDENT_TRIAGE_PATH", str(tmp_path / "incident_triage.json"))
    monkeypatch.setenv("INTAKE_ENABLED", "false")
    monkeypatch.setenv("AGENT_LONG_POLL_SECONDS", "0")
    get_settings.cache_clear()

    with TestClient(app) as client:
        r = client.get("/incidents/inc-0003/graph", headers=HEADERS)
        assert r.status_code == 200
        graph = r.json()
        assert "nodes" in graph
        by_event = {n["event_id"]: n for n in graph["nodes"]}

        n1 = by_event["evt-0003-1"]
        assert n1["event_type"] == "process_start"
        assert n1["host"] == "WS01"
        assert n1["detail"] is None

        n2 = by_event["evt-0003-2"]
        assert n2["event_type"] == "process_access"
        assert n2["host"] == "WS01"
        assert n2["detail"] is None

        n3 = by_event["evt-0003-3"]
        assert n3["event_type"] == "network_connection"
        assert n3["host"] == "WS01"
        assert n3["detail"] == "203.0.113.7"
    get_settings.cache_clear()


def test_clustering_counts_remain_unchanged(sample_events):
    result = run(sample_events)
    assert len(result.alerts) == 8
    assert len(result.incidents) == 5
    scenarios = sorted(i["matched_scenario"] for i in result.incidents if i["matched_scenario"])
    assert scenarios == [
        "credential_dump_chain",
        "exfiltration_chain",
        "lateral_movement_chain",
        "malware_drop_chain",
    ]
