"""Per-incident and mean MTTR (NFR-8): incident_raised_time -> response_executed_time.

Store-agnostic: uses whichever STORE_BACKEND is configured (fixtures or
elasticsearch), so this script runs unchanged in either environment.

MTTD (attack_action_time -> alert) is Person A's join with Person C's
attack_action_time, not B's. This script's shape (compute rows, write CSV,
print grouped summary) is meant to be extended for that, not duplicated.
The mean/median/p90 math itself lives in backend/metrics/calc.py
(compute_duration_stats), shared with the metrics page's MTTR widgets so
there's exactly one implementation of "duration between two timestamps".

Usage:
    python scripts/mttr_report.py [output.csv]
"""
import csv
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.config import get_settings  # noqa: E402
from backend.app.store import build_store  # noqa: E402
from backend.metrics.calc import compute_duration_stats  # noqa: E402

FIELDNAMES = [
    "incident_id", "matched_scenario", "severity", "action_id", "action", "mode",
    "incident_raised_time", "response_executed_time", "mttr_seconds",
]


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def compute_mttr_rows(store) -> list[dict]:
    """One row per response_actions doc that has both an incident_id and a
    response_executed_time, joined against its incident's incident_raised_time.
    Docs referencing an incident the store no longer has (or missing either
    timestamp) are skipped -- MTTR is undefined for them."""
    rows = []
    for action in store.list_all_response_actions():
        incident_id = action.get("incident_id")
        executed = action.get("response_executed_time")
        if not incident_id or not executed:
            continue

        incident = store.get_incident(incident_id)
        if incident is None:
            continue

        raised = incident.get("incident_raised_time")
        if not raised:
            continue

        mttr_seconds = (_parse_ts(executed) - _parse_ts(raised)).total_seconds()
        rows.append({
            "incident_id": incident_id,
            "matched_scenario": incident.get("matched_scenario"),
            "severity": incident.get("severity"),
            "action_id": action.get("action_id"),
            "action": action.get("action"),
            "mode": action.get("mode"),
            "incident_raised_time": raised,
            "response_executed_time": executed,
            "mttr_seconds": mttr_seconds,
        })

    rows.sort(key=lambda r: r["incident_raised_time"])
    return rows


def write_csv(rows: list[dict], path: Path) -> None:
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def print_summary(rows: list[dict]) -> None:
    if not rows:
        print("No response_actions with both incident_id and response_executed_time found.")
        return

    print(f"{'incident_id':<12} {'scenario':<24} {'severity':<9} {'mttr_seconds':>12}")
    for row in rows:
        scenario = row["matched_scenario"] or "(none)"
        print(f"{row['incident_id']:<12} {scenario:<24} {row['severity']:<9} {row['mttr_seconds']:>12.3f}")

    overall_stats = compute_duration_stats(
        [(r["incident_raised_time"], r["response_executed_time"]) for r in rows]
    )
    print(f"\nOverall mean MTTR: {overall_stats['mean']:.3f}s across {len(rows)} response action(s)")

    by_scenario: dict[str, list[dict]] = {}
    for row in rows:
        key = row["matched_scenario"] or "(none)"
        by_scenario.setdefault(key, []).append(row)

    print("\nMean MTTR by scenario:")
    for scenario, scenario_rows in sorted(by_scenario.items()):
        stats = compute_duration_stats(
            [(r["incident_raised_time"], r["response_executed_time"]) for r in scenario_rows]
        )
        print(f"  {scenario:<24} mean={stats['mean']:.3f}s  n={stats['count']}")


def main() -> None:
    settings = get_settings()
    store = build_store(settings)

    rows = compute_mttr_rows(store)

    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("mttr_report.csv")
    write_csv(rows, output_path)
    print_summary(rows)
    print(f"\nWrote {len(rows)} row(s) to {output_path}")


if __name__ == "__main__":
    main()
