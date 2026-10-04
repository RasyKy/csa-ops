"""Align runtime triage and response timestamps with the incident times.

Fixture incidents are dated relative to the generator anchor, but triage and
response timestamps come from the wall clock when intake runs, so they can land
hours or days after the incident. For every incident in data/NAME this shifts:

  triage            delta = (incident_raised_time + 3s) - triage_started_time,
                    applied to triage_started_time and triage_time
  response actions  delta = (incident_raised_time + 4s) - earliest command_issued_time
                    of that incident's actions, applied to command_issued_time,
                    agent_received_time and response_executed_time (nulls skipped)

Latencies inside a record are preserved exactly, nothing else changes (explain
generated_time is left alone) and the file format is kept. Running it twice is a
no-op. Default is a dry run; --write applies it. It refuses the default set and
only ever writes under data/NAME/.

Usage:
    python scripts/rebase_runtime_data.py --set realistic
    python scripts/rebase_runtime_data.py --set realistic --write
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

SET_NAME_RE = re.compile(r"^[a-z0-9_-]+$")
TRIAGE_DELAY = timedelta(seconds=3)
ACTION_DELAY = timedelta(seconds=4)
TRIAGE_FIELDS = ("triage_started_time", "triage_time")
ACTION_FIELDS = ("command_issued_time", "agent_received_time", "response_executed_time")


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def fmt_ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _shift(record: dict, fields: tuple, delta: timedelta) -> None:
    if delta == timedelta(0):
        return
    for field in fields:
        if record.get(field):
            record[field] = fmt_ts(parse_ts(record[field]) + delta)


def compute_rebase(incidents: list[dict], triage: dict, actions: list[dict]) -> tuple[dict, list[dict], list[dict]]:
    """Return (new_triage, new_actions, rows). Inputs are not mutated."""
    raised = {i["incident_id"]: parse_ts(i["incident_raised_time"]) for i in incidents}
    new_triage = copy.deepcopy(triage)
    new_actions = copy.deepcopy(actions)
    rows: list[dict] = []

    by_incident: dict[str, list[dict]] = {}
    for action in new_actions:
        by_incident.setdefault(action["incident_id"], []).append(action)

    for incident_id in sorted(set(triage) | set(by_incident)):
        row = {"incident_id": incident_id, "note": ""}
        if incident_id not in raised:
            row["note"] = "not in fixtures, skipped"
            rows.append(row)
            continue
        base = raised[incident_id]
        row["raised"] = fmt_ts(base)

        record = new_triage.get(incident_id)
        if record is not None:
            if not record.get("triage_started_time"):
                row["note"] = "triage has no triage_started_time, skipped"
            else:
                row["triage_before"] = record["triage_started_time"]
                delta = (base + TRIAGE_DELAY) - parse_ts(record["triage_started_time"])
                _shift(record, TRIAGE_FIELDS, delta)
                row["triage_after"] = record["triage_started_time"]
                row["triage_delta_s"] = delta.total_seconds()

        group = by_incident.get(incident_id)
        if group:
            issued = [a["command_issued_time"] for a in group if a.get("command_issued_time")]
            if issued:
                earliest = min(parse_ts(t) for t in issued)
                row["action_before"] = fmt_ts(earliest)
                delta = (base + ACTION_DELAY) - earliest
                for action in group:
                    _shift(action, ACTION_FIELDS, delta)
                row["action_after"] = fmt_ts(min(parse_ts(a["command_issued_time"]) for a in group))
                row["action_delta_s"] = delta.total_seconds()
        rows.append(row)
    return new_triage, new_actions, rows


def _dump_like(original_text: str, data) -> str:
    indented = "\n  " in original_text
    text = json.dumps(data, indent=2 if indented else None)
    if original_text.endswith("\n"):
        text += "\n"
    return text


def resolve_paths(set_name: str, data_root: Path, fixture_root: Path) -> dict:
    if set_name in ("", "default"):
        raise ValueError("refusing to rebase the default set; use --set NAME for a generated set")
    if not SET_NAME_RE.match(set_name):
        raise ValueError(f"invalid set name {set_name!r}: must match ^[a-z0-9_-]+$")
    data_dir = (data_root / set_name).resolve()
    if data_root.resolve() not in data_dir.parents:
        raise ValueError("data directory resolves outside the data root")
    fixtures = fixture_root / set_name / "incidents.json"
    if not fixtures.is_file():
        raise ValueError(f"{fixtures} not found")
    return {
        "incidents": fixtures,
        "triage": data_dir / "incident_triage.json",
        "actions": data_dir / "response_actions.json",
    }


def rebase(set_name: str, *, data_root: Path, fixture_root: Path, write: bool = False) -> list[dict]:
    paths = resolve_paths(set_name, Path(data_root), Path(fixture_root))
    incidents = json.loads(paths["incidents"].read_text())
    triage_text = paths["triage"].read_text() if paths["triage"].exists() else "{}"
    actions_text = paths["actions"].read_text() if paths["actions"].exists() else "[]"
    triage = json.loads(triage_text)
    actions = json.loads(actions_text)

    new_triage, new_actions, rows = compute_rebase(incidents, triage, actions)

    if write:
        if new_triage != triage:
            paths["triage"].write_text(_dump_like(triage_text, new_triage))
        if new_actions != actions:
            paths["actions"].write_text(_dump_like(actions_text, new_actions))
    return rows


def print_table(rows: list[dict], *, write: bool) -> None:
    print(f"{'incident':<10}{'raised':<26}{'triage start before':<26}{'-> after':<26}{'action before':<26}{'-> after':<26}note")
    for r in rows:
        print(
            f"{r['incident_id']:<10}{r.get('raised', '-'):<26}{r.get('triage_before', '-'):<26}"
            f"{r.get('triage_after', '-'):<26}{r.get('action_before', '-'):<26}{r.get('action_after', '-'):<26}{r['note']}"
        )
    changed = sum(1 for r in rows if r.get("triage_delta_s") or r.get("action_delta_s"))
    print(f"\n{changed} incident(s) {'rebased' if write else 'would change (dry run, nothing written)'}.")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Align runtime triage and response timestamps with incident times")
    parser.add_argument("--set", dest="set_name", required=True, help="fixture set name (not 'default')")
    parser.add_argument("--write", action="store_true", help="apply the shift (default is a dry run)")
    parser.add_argument("--data-root", default=os.getenv("DATA_ROOT", str(REPO_ROOT / "data")))
    parser.add_argument("--fixture-root", default=os.getenv("FIXTURE_ROOT", str(REPO_ROOT / "fixtures")))
    args = parser.parse_args(argv)
    try:
        rows = rebase(args.set_name, data_root=Path(args.data_root), fixture_root=Path(args.fixture_root), write=args.write)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print_table(rows, write=args.write)
    return 0


if __name__ == "__main__":
    sys.exit(main())
