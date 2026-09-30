"""FR22: report detection-rule coverage by MITRE ATT&CK technique and tactic.

Reads rules/ and prints how many techniques are covered across how many
tactics, then the per-tactic breakdown. Purely derived from the rule files, so
it stays correct as rules are added (NFR-1).

Usage:
    python scripts/coverage_report.py [--csv out.csv]
"""
import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.detection.rules import load_rules  # noqa: E402


def build_coverage(rules) -> dict[str, list[dict]]:
    by_tactic: dict[str, list[dict]] = {}
    for rule in rules:
        by_tactic.setdefault(rule.tactic, []).append(
            {"technique": rule.technique, "rule_id": rule.rule_id, "title": rule.title, "level": rule.level}
        )
    return dict(sorted(by_tactic.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description="FR22 ATT&CK coverage report")
    parser.add_argument("--csv", help="also write the per-rule rows to this CSV")
    args = parser.parse_args()

    rules = load_rules()
    coverage = build_coverage(rules)
    techniques = sorted({r.technique for r in rules})

    print(f"Detection coverage: {len(techniques)} technique(s) across {len(coverage)} tactic(s)\n")
    print(f"{'tactic':<22} {'technique':<12} {'level':<9} rule")
    for tactic, entries in coverage.items():
        for entry in sorted(entries, key=lambda e: e["technique"]):
            print(f"{tactic:<22} {entry['technique']:<12} {entry['level']:<9} {entry['rule_id']}")

    print("\nTechniques covered:", ", ".join(techniques))
    print("Tactics covered:  ", ", ".join(coverage.keys()))

    if args.csv:
        with open(args.csv, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["tactic", "technique", "rule_id", "title", "level"])
            writer.writeheader()
            for tactic, entries in coverage.items():
                for entry in entries:
                    writer.writerow({"tactic": tactic, **entry})
        print(f"\nWrote per-rule rows to {args.csv}")


if __name__ == "__main__":
    main()
