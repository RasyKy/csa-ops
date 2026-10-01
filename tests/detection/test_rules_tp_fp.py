"""FR7: every detection rule has a recorded true-positive and false-positive test.

RULE_CASES holds one TP event (must fire the rule) and one FP event (must not)
per rule id. The test parametrizes over the rules actually loaded from rules/,
so adding a rule without adding a TP/FP case here fails the suite -- FR7 is
enforced, not just documented.
"""
import pytest

from engine.detection.rules import load_rules

RULES = {rule.rule_id: rule for rule in load_rules()}

# rule_id -> {"tp": event that must fire, "fp": benign event that must not}
RULE_CASES = {
    "T1059.001_encoded_powershell": {
        "tp": {
            "event_type": "process_start",
            "process_name": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            "command_line": "powershell.exe -nop -w hidden -enc SQBFAFgA",
        },
        "fp": {
            "event_type": "process_start",
            "process_name": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            "command_line": "powershell.exe -Command Get-Date",
        },
    },
    "T1003_lsass_access": {
        "tp": {
            "event_type": "process_access",
            "process_name": "C:\\Users\\alice\\AppData\\Local\\Temp\\dumper.exe",
            "target_process_name": "C:\\Windows\\System32\\lsass.exe",
        },
        "fp": {  # a trusted system process reading LSASS is filtered out
            "event_type": "process_access",
            "process_name": "C:\\Windows\\System32\\wininit.exe",
            "target_process_name": "C:\\Windows\\System32\\lsass.exe",
        },
    },
    "T1547.001_run_key_persistence": {
        "tp": {
            "event_type": "registry_event",
            "process_name": "C:\\Users\\bob\\AppData\\Local\\Temp\\evil.exe",
            "registry_key": "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Backdoor",
        },
        "fp": {  # an installer adding a startup entry is filtered out
            "event_type": "registry_event",
            "process_name": "C:\\Windows\\System32\\msiexec.exe",
            "registry_key": "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\VendorUpdater",
        },
    },
    "T1021_lateral_movement_smb": {
        "tp": {
            "event_type": "process_start",
            "process_name": "C:\\Windows\\PSEXESVC.exe",
            "command_line": "C:\\Windows\\PSEXESVC.exe",
        },
        "fp": {  # psexec client with no remote UNC target
            "event_type": "process_start",
            "process_name": "C:\\Tools\\psexec.exe",
            "command_line": "psexec.exe /accepteula /?",
        },
    },
    "T1047_wmi_lateral_movement": {
        "tp": {
            "event_type": "process_start",
            "process_name": "C:\\Windows\\System32\\wbem\\wmic.exe",
            "command_line": "wmic /node:10.0.0.9 process call create calc.exe",
        },
        "fp": {  # ordinary local WMI query
            "event_type": "process_start",
            "process_name": "C:\\Windows\\System32\\wbem\\wmic.exe",
            "command_line": "wmic cpu get name",
        },
    },
    "T1105_file_drop": {
        "tp": {
            "event_type": "file_event",
            "process_name": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            "file_path": "C:\\Users\\bob\\AppData\\Local\\Temp\\payload.exe",
        },
        "fp": {  # a document written to Temp is not an executable
            "event_type": "file_event",
            "process_name": "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
            "file_path": "C:\\Users\\bob\\AppData\\Local\\Temp\\~WRD0001.tmp",
        },
    },
    "T1012_registry_query": {
        "tp": {
            "event_type": "process_start",
            "process_name": "C:\\Windows\\System32\\reg.exe",
            "command_line": "reg.exe query HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        },
        "fp": {  # querying a non-sensitive key
            "event_type": "process_start",
            "process_name": "C:\\Windows\\System32\\reg.exe",
            "command_line": "reg.exe query HKCU\\Environment",
        },
    },
    "T1048_lolbin_exfil": {
        "tp": {
            "event_type": "network_connection",
            "process_name": "C:\\Windows\\System32\\certutil.exe",
            "dest_ip": "203.0.113.9",
            "dest_port": 443,
        },
        "fp": {  # same binary, but the destination is an internal address
            "event_type": "network_connection",
            "process_name": "C:\\Windows\\System32\\certutil.exe",
            "dest_ip": "10.0.0.5",
            "dest_port": 80,
        },
    },
}


def test_every_loaded_rule_has_a_tp_fp_case():
    """FR7: no rule may ship without a TP and FP test."""
    missing = sorted(set(RULES) - set(RULE_CASES))
    assert not missing, f"rules with no TP/FP case: {missing}"


@pytest.mark.parametrize("rule_id", sorted(RULE_CASES))
def test_true_positive(rule_id):
    assert rule_id in RULES, f"{rule_id} has a case but is not loaded from rules/"
    assert RULES[rule_id].matches(RULE_CASES[rule_id]["tp"]) is True


@pytest.mark.parametrize("rule_id", sorted(RULE_CASES))
def test_false_positive(rule_id):
    assert RULES[rule_id].matches(RULE_CASES[rule_id]["fp"]) is False


@pytest.mark.parametrize("rule_id", sorted(RULE_CASES))
def test_no_other_rule_fires_on_this_rules_true_positive(rule_id):
    """A rule's TP event should be specific enough that unrelated rules stay
    quiet -- a light guard against rules bleeding into each other."""
    event = RULE_CASES[rule_id]["tp"]
    fired = {rid for rid, rule in RULES.items() if rule.matches(event)}
    assert fired == {rule_id}, f"{rule_id} TP also fired: {fired - {rule_id}}"
