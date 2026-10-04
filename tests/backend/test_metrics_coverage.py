"""backend/metrics/coverage.py -- parses rules/*.yml for attack.tXXXX tags.
Read-only against temp directories; never touches the real rules/."""
from backend.metrics.coverage import parse_rule_coverage, parse_rule_tactics


def test_missing_directory_returns_empty_dict(tmp_path):
    assert parse_rule_coverage(tmp_path / "does-not-exist") == {}


def test_empty_directory_returns_empty_dict(tmp_path):
    # This is the real current state of rules/ on this branch (README.md
    # only, no .yml files) -- coverage must read as "no data", not error.
    assert parse_rule_coverage(tmp_path) == {}


def test_non_yml_files_are_ignored(tmp_path):
    (tmp_path / "README.md").write_text("Sigma rules go here.")
    assert parse_rule_coverage(tmp_path) == {}


def test_parses_attack_tag_from_a_valid_rule(tmp_path):
    (tmp_path / "t1003_lsass.yml").write_text(
        "id: T1003_lsass_access\n"
        "title: LSASS Memory Access\n"
        "tags:\n"
        "  - attack.credential_access\n"
        "  - attack.t1003\n"
    )
    coverage = parse_rule_coverage(tmp_path)
    assert coverage == {"T1003": ["T1003_lsass_access"]}


def test_parses_sub_technique_and_preserves_dot(tmp_path):
    (tmp_path / "t1059_001.yml").write_text(
        "id: T1059.001_encoded_powershell\n"
        "tags:\n"
        "  - attack.execution\n"
        "  - attack.t1059.001\n"
    )
    coverage = parse_rule_coverage(tmp_path)
    assert coverage == {"T1059.001": ["T1059.001_encoded_powershell"]}


def test_falls_back_to_filename_stem_when_id_missing(tmp_path):
    (tmp_path / "some_rule.yml").write_text("tags:\n  - attack.t1047\n")
    coverage = parse_rule_coverage(tmp_path)
    assert coverage == {"T1047": ["some_rule"]}


def test_multiple_rules_tagging_the_same_technique_both_listed(tmp_path):
    (tmp_path / "rule_a.yml").write_text("id: rule-a\ntags:\n  - attack.t1003\n")
    (tmp_path / "rule_b.yml").write_text("id: rule-b\ntags:\n  - attack.t1003\n")
    coverage = parse_rule_coverage(tmp_path)
    assert coverage == {"T1003": ["rule-a", "rule-b"]}


def test_malformed_yaml_is_skipped_not_raised(tmp_path):
    (tmp_path / "broken.yml").write_text("tags: [unclosed\n")
    (tmp_path / "valid.yml").write_text("id: ok-rule\ntags:\n  - attack.t1003\n")
    coverage = parse_rule_coverage(tmp_path)
    assert coverage == {"T1003": ["ok-rule"]}


def test_non_attack_tags_are_ignored(tmp_path):
    (tmp_path / "rule.yml").write_text(
        "id: rule-x\n"
        "tags:\n"
        "  - attack.credential_access\n"  # tactic tag, not a technique id
        "  - some.other.tag\n"
    )
    assert parse_rule_coverage(tmp_path) == {}


def test_rule_with_no_tags_field_is_skipped(tmp_path):
    (tmp_path / "rule.yml").write_text("id: rule-x\ntitle: No tags here\n")
    assert parse_rule_coverage(tmp_path) == {}


def test_parse_rule_tactics_missing_directory_returns_empty_dict(tmp_path):
    assert parse_rule_tactics(tmp_path / "does-not-exist") == {}


def test_parse_rule_tactics_persistence_plus_technique(tmp_path):
    (tmp_path / "t1547_001.yml").write_text(
        "id: T1547.001_run_key_persistence\n"
        "tags:\n"
        "  - attack.persistence\n"
        "  - attack.t1547.001\n"
    )
    assert parse_rule_tactics(tmp_path) == {"T1547.001": "persistence"}


def test_parse_rule_tactics_rule_with_no_tactic_tag_is_omitted(tmp_path):
    (tmp_path / "no_tactic.yml").write_text(
        "id: T1047_wmi\n"
        "tags:\n"
        "  - attack.t1047\n"
    )
    assert parse_rule_tactics(tmp_path) == {}


def test_parse_rule_tactics_two_tactic_tags_uses_first(tmp_path):
    (tmp_path / "multi_tactic.yml").write_text(
        "id: T1059.001_powershell\n"
        "tags:\n"
        "  - attack.execution\n"
        "  - attack.persistence\n"
        "  - attack.t1059.001\n"
    )
    assert parse_rule_tactics(tmp_path) == {"T1059.001": "execution"}


def test_parse_rule_tactics_malformed_yaml_is_skipped(tmp_path):
    (tmp_path / "broken.yml").write_text("tags: [unclosed\n")
    (tmp_path / "valid.yml").write_text(
        "id: T1012_reg\n"
        "tags:\n"
        "  - attack.discovery\n"
        "  - attack.t1012\n"
    )
    assert parse_rule_tactics(tmp_path) == {"T1012": "discovery"}

