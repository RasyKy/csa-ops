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
