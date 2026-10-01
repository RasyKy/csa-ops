"""Tests for the rules/ loader: it loads the shipped rules and fails loudly
on malformed or duplicate rules (NFR-1: rules are data, loaded not coded)."""
import pytest

from engine.detection.rules import load_rules
from engine.detection.sigma import SigmaError


def test_loads_at_least_eight_rules_each_with_technique_and_tactic():
    rules = load_rules()
    assert len(rules) >= 8  # FR5
    for rule in rules:
        assert rule.technique, f"{rule.rule_id} has no technique"
        assert rule.tactic, f"{rule.rule_id} has no tactic"
        assert rule.level in {"low", "medium", "high", "critical"}


def test_rule_ids_are_unique():
    rules = load_rules()
    ids = [r.rule_id for r in rules]
    assert len(ids) == len(set(ids))


def test_malformed_rule_raises(tmp_path):
    (tmp_path / "broken.yml").write_text("this: is\n  not: valid: yaml: at all\n")
    with pytest.raises(SigmaError):
        load_rules(tmp_path)


def test_duplicate_id_raises(tmp_path):
    body = (
        "id: DUP\ntitle: t\ntags: [attack.execution, attack.t1059.001]\n"
        "logsource: {category: process_creation}\n"
        "detection:\n  selection: {Image|endswith: '\\\\a.exe'}\n  condition: selection\n"
    )
    (tmp_path / "a.yml").write_text(body)
    (tmp_path / "b.yml").write_text(body)
    with pytest.raises(SigmaError):
        load_rules(tmp_path)


def test_adding_a_rule_file_needs_no_code_change(tmp_path):
    """NFR-1: dropping a YAML file into the rules dir adds a working rule."""
    (tmp_path / "new.yml").write_text(
        "id: T9999_new\ntitle: New Rule\ntags: [attack.discovery, attack.t9999]\n"
        "level: medium\nlogsource: {category: process_creation}\n"
        "detection:\n  selection: {Image|endswith: '\\whoami.exe'}\n  condition: selection\n"
    )
    rules = load_rules(tmp_path)
    assert len(rules) == 1
    assert rules[0].matches({"event_type": "process_start", "process_name": "C:\\Windows\\System32\\whoami.exe"})
