import pytest

from engine.response.decision import decide

POLICY = {
    "by_severity": {"low": "log", "medium": "alert", "high": "kill_process", "critical": "isolate_host"},
    "by_scenario": {
        "credential_dump_chain": "kill_process",
        "exfiltration_chain": "block_address",
        "malware_drop_chain": "quarantine_file",
        "lateral_movement_chain": "isolate_host",
    },
    "never_auto": ["unisolate_host", "restore_file", "unblock_address"],
}


def _incident(severity, matched_scenario=None, targets=None, nodes=None):
    return {
        "incident_id": "inc-x",
        "severity": severity,
        "matched_scenario": matched_scenario,
        "targets": targets if targets is not None else {"pids": [123], "remote_ips": [], "file_paths": []},
        "chain": {"nodes": nodes or [], "edges": []},
    }


@pytest.mark.parametrize(
    "severity,expected_action",
    [("low", "log"), ("medium", "alert"), ("high", "kill_process"), ("critical", "isolate_host")],
)
def test_severity_default_when_no_scenario(severity, expected_action):
    result = decide(_incident(severity, matched_scenario=None), policy=POLICY)
    assert result.action == expected_action
    assert result.policy_rule == f"by_severity:{severity}"


@pytest.mark.parametrize(
    "scenario,expected_action",
    [
        ("credential_dump_chain", "kill_process"),
        ("exfiltration_chain", "block_address"),
        ("malware_drop_chain", "quarantine_file"),
        ("lateral_movement_chain", "isolate_host"),
    ],
)
def test_scenario_overrides_severity_default(scenario, expected_action):
    # Deliberately mismatched severity ("low") to prove the scenario wins.
    result = decide(_incident("low", matched_scenario=scenario), policy=POLICY)
    assert result.action == expected_action
    assert result.policy_rule == f"by_scenario:{scenario}"


def test_null_scenario_falls_back_to_severity():
    result = decide(_incident("critical", matched_scenario=None), policy=POLICY)
    assert result.action == "isolate_host"
    assert result.policy_rule == "by_severity:critical"


def test_target_uses_incident_targets_when_present():
    targets = {"pids": [999], "remote_ips": ["1.2.3.4"], "file_paths": []}
    result = decide(_incident("high", targets=targets), policy=POLICY)
    assert result.target["pids"] == [999]
    assert result.target["remote_ips"] == ["1.2.3.4"]
    assert result.target["file_paths"] == []


def test_target_falls_back_to_chain_nodes_when_targets_empty():
    result = decide(
        _incident("high", targets={"pids": [], "remote_ips": [], "file_paths": []}, nodes=[{"pid": 4412}]),
        policy=POLICY,
    )
    assert result.target["pids"] == [4412]
    assert result.target["remote_ips"] == []
    assert result.target["file_paths"] == []


def test_target_carries_pid_image_map_from_chain_nodes():
    result = decide(
        _incident("high", nodes=[{"pid": 4412, "image": "C:\\Windows\\System32\\rundll32.exe"}]),
        policy=POLICY,
    )
    assert result.target["pid_images"] == {4412: "C:\\Windows\\System32\\rundll32.exe"}
