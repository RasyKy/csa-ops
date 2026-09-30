"""Load Sigma rules from the rules/ directory.

NFR-1: adding a detection rule is dropping a .yml file into rules/. Nothing in
engine/ changes. This loader is the only thing that reads that directory.
"""
from __future__ import annotations

from pathlib import Path

import yaml

from .sigma import SigmaError, SigmaRule, build_rule

# rules/ sits at the repository root, two levels up from this file.
RULES_DIR = Path(__file__).resolve().parents[2] / "rules"


def load_rules(rules_dir: Path = RULES_DIR) -> list[SigmaRule]:
    """Parse every *.yml / *.yaml file under rules_dir into a SigmaRule.

    Raises SigmaError naming the offending file if any rule is malformed, so a
    broken rule fails loudly at startup instead of silently not firing."""
    rules: list[SigmaRule] = []
    seen_ids: dict[str, Path] = {}

    for path in sorted(_rule_files(rules_dir)):
        try:
            doc = yaml.safe_load(path.read_text())
        except yaml.YAMLError as exc:
            raise SigmaError(f"{path.name}: invalid YAML: {exc}") from exc
        if not isinstance(doc, dict):
            raise SigmaError(f"{path.name}: expected a YAML mapping at the top level")

        try:
            rule = build_rule(doc, source_path=str(path))
        except SigmaError as exc:
            raise SigmaError(f"{path.name}: {exc}") from exc

        if rule.rule_id in seen_ids:
            raise SigmaError(
                f"{path.name}: duplicate rule id {rule.rule_id!r} "
                f"(already defined in {seen_ids[rule.rule_id].name})"
            )
        seen_ids[rule.rule_id] = path
        rules.append(rule)

    return rules


def _rule_files(rules_dir: Path):
    for pattern in ("*.yml", "*.yaml"):
        yield from rules_dir.glob(pattern)
