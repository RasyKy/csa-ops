"""FR21: false-positive count and rate per rule against benign activity.

Replays a file of benign (baseline) events through the detection rules and
counts how many alerts each rule raises. Every alert on benign data is a false
positive by definition. Two counts are reported per rule:

  * before tuning: the rule with its tuning filters disabled
  * after tuning:  the rule as written

The gap between them is what the filters buy. The rate is expressed per hour of
baseline activity (from the event timestamp span) and per 1000 events, so it is
comparable across baseline volumes.

Usage:
    python scripts/fp_rate_report.py [benign_events.json] [--json out.json]
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.detection.rules import load_rules  # noqa: E402

DEFAULT_BENIGN = Path(__file__).resolve().parents[1] / "fixtures" / "baseline_benign.sample.json"


def _hours_span(events) -> float:
    times = []
    for e in events:
        ts = e.get("timestamp")
        if ts:
            try:
                times.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
            except ValueError:
                pass
    if len(times) < 2:
        return 0.0
    return (max(times) - min(times)).total_seconds() / 3600.0


def measure(rules, events) -> dict:
    hours = _hours_span(events)
    per_rule = []
    for rule in rules:
        before = sum(1 for e in events if rule.matches(e, ignore_filters=True))
        after = sum(1 for e in events if rule.matches(e))
        per_rule.append({
            "rule_id": rule.rule_id,
            "technique": rule.technique,
            "fp_before_tuning": before,
            "fp_after_tuning": after,
            "fp_removed_by_tuning": before - after,
            "fp_per_hour_after": round(after / hours, 3) if hours else None,
            "fp_per_1000_events_after": round(after / len(events) * 1000, 2) if events else None,
        })
    return {
        "baseline_events": len(events),
        "baseline_hours": round(hours, 2),
        "total_fp_before_tuning": sum(r["fp_before_tuning"] for r in per_rule),
        "total_fp_after_tuning": sum(r["fp_after_tuning"] for r in per_rule),
        "rules": per_rule,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="FR21 false-positive rate report")
    parser.add_argument("benign", nargs="?", default=str(DEFAULT_BENIGN))
    parser.add_argument("--json", help="write the full report to this JSON file")
    args = parser.parse_args()

    events = json.loads(Path(args.benign).read_text())
    rules = load_rules()
    report = measure(rules, events)

    print(
        f"Baseline: {report['baseline_events']} benign event(s) over "
        f"{report['baseline_hours']} h\n"
    )
    print(f"{'rule':<34} {'before':>7} {'after':>6} {'removed':>8} {'/hr after':>10}")
    for r in report["rules"]:
        print(
            f"{r['rule_id']:<34} {r['fp_before_tuning']:>7} {r['fp_after_tuning']:>6} "
            f"{r['fp_removed_by_tuning']:>8} {str(r['fp_per_hour_after']):>10}"
        )
    print(
        f"\nTotal false positives: {report['total_fp_before_tuning']} before tuning -> "
        f"{report['total_fp_after_tuning']} after tuning"
    )

    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2))
        print(f"Wrote {args.json}")


if __name__ == "__main__":
    main()
