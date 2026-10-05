"""Export realistic demo seed data from data/<set> to deploy/seed/<set>."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

ALLOWED_FILES = (
    "incident_triage.json",
    "response_actions.json",
    "intake_state.json",
    "cases.json",
)


def get_generated_incident_ids(set_name: str, fixtures_dir: Path | None = None) -> list[str]:
    if fixtures_dir:
        cand = fixtures_dir / set_name / "incidents.json"
        if not cand.exists():
            cand = fixtures_dir / "incidents.json"
        if cand.exists():
            data = json.loads(cand.read_text(encoding="utf-8"))
            return [x["incident_id"] for x in data]

    default_cand = Path("fixtures") / set_name / "incidents.json"
    if default_cand.exists():
        data = json.loads(default_cand.read_text(encoding="utf-8"))
        return [x["incident_id"] for x in data]

    try:
        from scripts.generate_scenarios import generate
        with tempfile.TemporaryDirectory() as tmp:
            res = generate("now", tmp)
            return [x["incident_id"] for x in res["incidents"]]
    except Exception:
        return []


def check_for_secrets(obj: Any, path: str = "") -> None:
    if isinstance(obj, str):
        if "sk-" in obj or "Bearer " in obj:
            raise ValueError(f"Secret-like pattern found in {path}: contains forbidden token")
    elif isinstance(obj, dict):
        for k, v in obj.items():
            check_for_secrets(k, f"{path}.key({k})")
            check_for_secrets(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for idx, item in enumerate(obj):
            check_for_secrets(item, f"{path}[{idx}]")


def export_demo_seed(
    set_name: str,
    source_dir: Path,
    out_dir: Path,
    fixtures_dir: Path | None = None,
) -> list[dict[str, Any]]:
    if not source_dir.exists():
        raise FileNotFoundError(f"Source directory does not exist: {source_dir}")

    triage_path = source_dir / "incident_triage.json"
    if not triage_path.exists():
        raise FileNotFoundError(f"Missing required file: {triage_path}")

    triage_data = json.loads(triage_path.read_text(encoding="utf-8"))
    if not isinstance(triage_data, dict):
        raise ValueError("incident_triage.json must contain a JSON object mapping incident IDs to triage records")

    generated_ids = get_generated_incident_ids(set_name, fixtures_dir)
    if generated_ids and len(triage_data) < len(generated_ids):
        raise ValueError(
            f"Source triage count ({len(triage_data)}) is fewer than generated incident count ({len(generated_ids)})"
        )

    rows: list[dict[str, Any]] = []
    for inc_id, record in sorted(triage_data.items()):
        status = record.get("status")
        if status == "failed":
            raise ValueError(f"Triage record for {inc_id} has failed status: {record}")
        verdict = record.get("verdict", "")
        confidence = record.get("confidence", "")
        has_explain = bool(record.get("explain"))
        rows.append({
            "incident_id": inc_id,
            "verdict": verdict,
            "confidence": confidence,
            "has_explain": "Yes" if has_explain else "No",
        })

    files_to_export: dict[str, Any] = {}
    for filename in ALLOWED_FILES:
        file_path = source_dir / filename
        if file_path.exists():
            data = json.loads(file_path.read_text(encoding="utf-8"))
            check_for_secrets(data, path=filename)
            files_to_export[filename] = data

    out_dir.mkdir(parents=True, exist_ok=True)
    for filename, data in files_to_export.items():
        dest = out_dir / filename
        dest.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    return rows


def print_table(rows: list[dict[str, Any]]) -> None:
    if not rows:
        print("No triage records exported.")
        return

    headers = ["Incident ID", "Verdict", "Confidence", "Has Explain"]
    col_widths = [len(h) for h in headers]
    for row in rows:
        col_widths[0] = max(col_widths[0], len(str(row["incident_id"])))
        col_widths[1] = max(col_widths[1], len(str(row["verdict"])))
        col_widths[2] = max(col_widths[2], len(str(row["confidence"])))
        col_widths[3] = max(col_widths[3], len(str(row["has_explain"])))

    header_line = "| " + " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers)) + " |"
    sep_line = "|-" + "-|-".join("-" * col_widths[i] for i in range(len(headers))) + "-|"
    print(header_line)
    print(sep_line)
    for row in rows:
        line = "| " + " | ".join([
            str(row["incident_id"]).ljust(col_widths[0]),
            str(row["verdict"]).ljust(col_widths[1]),
            str(row["confidence"]).ljust(col_widths[2]),
            str(row["has_explain"]).ljust(col_widths[3]),
        ]) + " |"
        print(line)


def main() -> int:
    parser = argparse.ArgumentParser(description="Export demo seed data.")
    parser.add_argument("--set", default="realistic", help="Fixture set name (default: realistic)")
    parser.add_argument("--source", default=None, help="Source data dir (default: data/<set>)")
    parser.add_argument("--out", default=None, help="Output seed dir (default: deploy/seed/<set>)")
    parser.add_argument("--fixtures-dir", default=None, help="Optional fixtures dir for incident verification")
    args = parser.parse_args()

    set_name = args.set
    source_dir = Path(args.source) if args.source else Path("data") / set_name
    out_dir = Path(args.out) if args.out else Path("deploy") / "seed" / set_name
    fixtures_dir = Path(args.fixtures_dir) if args.fixtures_dir else None

    try:
        rows = export_demo_seed(set_name, source_dir, out_dir, fixtures_dir)
        print_table(rows)
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
