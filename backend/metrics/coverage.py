"""Parses rules/*.yml (read-only -- rules/ belongs to Person A, never
written here) for MITRE ATT&CK technique tags, Sigma-style
(`attack.t1003.001`). Pure function: given a directory, returns a dict.

rules/ has no .yml files on this branch yet (README.md placeholder only),
so this currently always returns {} -- callers must treat that as "no
coverage data yet", not "zero techniques covered by design".
"""
import re
from pathlib import Path

import yaml

_ATTACK_TAG_RE = re.compile(r"attack\.(t\d+(?:\.\d+)?)", re.IGNORECASE)


_ATTACK_TACTIC_TAG_RE = re.compile(r"attack\.([a-z_]+)", re.IGNORECASE)
_VALID_TACTICS = frozenset({
    "reconnaissance",
    "resource_development",
    "initial_access",
    "execution",
    "persistence",
    "privilege_escalation",
    "defense_evasion",
    "credential_access",
    "discovery",
    "lateral_movement",
    "collection",
    "command_and_control",
    "exfiltration",
    "impact",
})


def parse_rule_coverage(rules_dir: Path) -> dict[str, list[str]]:
    """technique_id (uppercase, e.g. "T1003.001") -> rule_ids that tag it."""
    coverage: dict[str, list[str]] = {}
    if not rules_dir.exists():
        return coverage

    for rule_file in sorted(rules_dir.glob("*.yml")):
        try:
            doc = yaml.safe_load(rule_file.read_text())
        except yaml.YAMLError:
            continue
        if not isinstance(doc, dict):
            continue

        rule_id = doc.get("id") or rule_file.stem
        for tag in doc.get("tags") or []:
            match = _ATTACK_TAG_RE.fullmatch(str(tag).strip())
            if match:
                technique_id = match.group(1).upper()
                coverage.setdefault(technique_id, []).append(rule_id)

    return coverage


def parse_rule_tactics(rules_dir: Path) -> dict[str, str]:
    """technique_id (uppercase, e.g. "T1547.001") -> tactic (lowercase, e.g. "persistence")."""
    tactics: dict[str, str] = {}
    if not rules_dir.exists():
        return tactics

    for rule_file in sorted(rules_dir.glob("*.yml")):
        try:
            doc = yaml.safe_load(rule_file.read_text())
        except (yaml.YAMLError, OSError):
            continue
        if not isinstance(doc, dict):
            continue

        rule_tactic: str | None = None
        rule_techniques: list[str] = []
        for tag in doc.get("tags") or []:
            tag_str = str(tag).strip()
            tech_match = _ATTACK_TAG_RE.fullmatch(tag_str)
            if tech_match:
                rule_techniques.append(tech_match.group(1).upper())
            elif rule_tactic is None:
                tactic_match = _ATTACK_TACTIC_TAG_RE.fullmatch(tag_str)
                if tactic_match and tactic_match.group(1).lower() in _VALID_TACTICS:
                    rule_tactic = tactic_match.group(1).lower()

        if rule_tactic is not None:
            for technique_id in rule_techniques:
                tactics.setdefault(technique_id, rule_tactic)

    return tactics

