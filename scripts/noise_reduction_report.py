"""FR23: raw-alert-to-incident ratio (the noise reduction from correlation).

Runs the full pipeline over a file of normalized events and reports how many
raw alerts collapsed into how many incidents. A ratio above 1:1 is the noise
reduction correlation achieves.

Usage:
    python scripts/noise_reduction_report.py [normalized_events.json]
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.pipeline import run  # noqa: E402

DEFAULT_EVENTS = Path(__file__).resolve().parents[1] / "fixtures" / "normalized_events.sample.json"


def main() -> None:
    parser = argparse.ArgumentParser(description="FR23 noise-reduction report")
    parser.add_argument("events", nargs="?", default=str(DEFAULT_EVENTS))
    args = parser.parse_args()

    events = json.loads(Path(args.events).read_text())
    result = run(events)

    raw = len(result.alerts)
    incidents = len(result.incidents)
    print(f"Events processed:  {len(events)}")
    print(f"Raw alerts:        {raw}")
    print(f"Incidents raised:  {incidents}")
    if incidents:
        print(f"Noise reduction:   {raw / incidents:.2f}:1  ({raw} alerts -> {incidents} incidents)")
    else:
        print("Noise reduction:   n/a (no incidents raised)")

    by_scenario = Counter(i["matched_scenario"] or "(none)" for i in result.incidents)
    if by_scenario:
        print("\nIncidents by scenario:")
        for scenario, count in sorted(by_scenario.items()):
            print(f"  {scenario:<24} {count}")


if __name__ == "__main__":
    main()
