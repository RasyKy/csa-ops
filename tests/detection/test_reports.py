"""Tests for the FR21/FR22/FR23 reporting scripts' logic."""
import json
from pathlib import Path

from engine.detection.rules import load_rules

import scripts.coverage_report as coverage_report
import scripts.fp_rate_report as fp_rate_report

BENIGN = Path(__file__).resolve().parents[2] / "fixtures" / "baseline_benign.sample.json"


def test_coverage_report_counts_techniques_and_tactics():
    rules = load_rules()
    coverage = coverage_report.build_coverage(rules)
    techniques = {r.technique for r in rules}
    assert len(techniques) >= 8  # FR22 / FR5
    # the five tactics the requirements name explicitly must all be present
    for tactic in ("credential_access", "persistence", "lateral_movement", "exfiltration", "discovery"):
        assert tactic in coverage, f"tactic {tactic} not covered"


def test_fp_report_shows_tuning_reduces_false_positives():
    events = json.loads(BENIGN.read_text())
    report = fp_rate_report.measure(load_rules(), events)
    # tuning filters must remove at least one benign false positive
    assert report["total_fp_after_tuning"] < report["total_fp_before_tuning"]
    assert report["baseline_hours"] > 0
    for row in report["rules"]:
        assert row["fp_after_tuning"] <= row["fp_before_tuning"]
