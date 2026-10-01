"""Unit tests for the Sigma matcher: modifiers, list semantics, conditions."""
import pytest

from engine.detection.sigma import SigmaError, build_rule


def _rule(detection, category="process_creation", tags=None):
    return build_rule({
        "id": "TEST_rule",
        "title": "Test",
        "tags": tags or ["attack.execution", "attack.t1059.001"],
        "logsource": {"category": category},
        "detection": detection,
    })


def test_endswith_and_contains_are_case_insensitive():
    rule = _rule({
        "selection": {"Image|endswith": "\\powershell.exe", "CommandLine|contains": "-enc"},
        "condition": "selection",
    })
    assert rule.matches({"event_type": "process_start", "process_name": "C:\\WINDOWS\\POWERSHELL.EXE", "command_line": "PS -ENC AAA"})
    assert not rule.matches({"event_type": "process_start", "process_name": "C:\\Windows\\cmd.exe", "command_line": "-enc"})


def test_list_value_is_or():
    rule = _rule({"selection": {"Image|endswith": ["\\a.exe", "\\b.exe"]}, "condition": "selection"})
    assert rule.matches({"event_type": "process_start", "process_name": "x\\b.exe"})
    assert not rule.matches({"event_type": "process_start", "process_name": "x\\c.exe"})


def test_all_modifier_requires_every_value():
    rule = _rule({"selection": {"CommandLine|contains|all": ["node:", "call"]}, "condition": "selection"})
    assert rule.matches({"event_type": "process_start", "command_line": "wmic /node: process call create"})
    assert not rule.matches({"event_type": "process_start", "command_line": "wmic /node: only"})


def test_condition_and_not_filter():
    rule = _rule({
        "selection": {"TargetImage|endswith": "\\lsass.exe"},
        "filter": {"SourceImage|endswith": "\\wininit.exe"},
        "condition": "selection and not filter",
    }, category="process_access")
    assert rule.matches({"event_type": "process_access", "target_process_name": "x\\lsass.exe", "process_name": "evil.exe"})
    assert not rule.matches({"event_type": "process_access", "target_process_name": "x\\lsass.exe", "process_name": "c\\wininit.exe"})


def test_condition_or_and_precedence():
    rule = _rule({
        "a": {"CommandLine|contains": "aaa"},
        "b": {"CommandLine|contains": "bbb"},
        "c": {"CommandLine|contains": "ccc"},
        "condition": "a and b or c",  # (a and b) or c
    })
    assert rule.matches({"event_type": "process_start", "command_line": "ccc only"})
    assert rule.matches({"event_type": "process_start", "command_line": "aaa bbb"})
    assert not rule.matches({"event_type": "process_start", "command_line": "aaa only"})


def test_condition_one_of_and_all_of_pattern():
    detection = {
        "sel_x": {"CommandLine|contains": "xxx"},
        "sel_y": {"CommandLine|contains": "yyy"},
        "condition": "1 of sel_*",
    }
    rule = _rule(detection)
    assert rule.matches({"event_type": "process_start", "command_line": "has yyy"})
    rule_all = _rule({**detection, "condition": "all of sel_*"})
    assert not rule_all.matches({"event_type": "process_start", "command_line": "has yyy"})
    assert rule_all.matches({"event_type": "process_start", "command_line": "xxx and yyy"})


def test_event_type_gate_from_category():
    rule = _rule({"selection": {"Image|endswith": "\\reg.exe"}, "condition": "selection"})
    # right image, wrong event_type -> no match
    assert not rule.matches({"event_type": "network_connection", "process_name": "x\\reg.exe"})


def test_numeric_port_equality():
    rule = _rule({"selection": {"DestinationPort": 445}, "condition": "selection"}, category="network_connection")
    assert rule.matches({"event_type": "network_connection", "dest_port": 445})
    assert not rule.matches({"event_type": "network_connection", "dest_port": 80})


def test_ignore_filters_disables_filter_selections():
    rule = _rule({
        "selection": {"TargetImage|endswith": "\\lsass.exe"},
        "filter_system": {"SourceImage|endswith": "\\wininit.exe"},
        "condition": "selection and not filter_system",
    }, category="process_access")
    event = {"event_type": "process_access", "target_process_name": "x\\lsass.exe", "process_name": "c\\wininit.exe"}
    assert not rule.matches(event)  # filtered out normally
    assert rule.matches(event, ignore_filters=True)  # filter disabled -> fires


def test_missing_technique_tag_is_error():
    with pytest.raises(SigmaError):
        build_rule({"id": "x", "title": "t", "tags": ["attack.execution"],
                    "logsource": {"category": "process_creation"},
                    "detection": {"selection": {"Image": "a"}, "condition": "selection"}})


def test_unknown_selection_in_condition_is_error():
    rule = _rule({"selection": {"Image|endswith": "\\a.exe"}, "condition": "selection and missing"})
    with pytest.raises(SigmaError):
        rule.matches({"event_type": "process_start", "process_name": "x\\a.exe"})
