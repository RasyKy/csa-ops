"""Offline recomputation of AI explain ungrounded mentions.

Reads data/incident_triage.json, fixtures/incidents.json, and
data/response_actions.json. Recomputes find_ungrounded for each incident
with an explain block and reports changes.
"""
import argparse
import json
import sys
from pathlib import Path

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from engine.ai_explain import grounding  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recompute ungrounded mentions for incidents with AI explanations."
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Update data/incident_triage.json in place.",
    )
    args = parser.parse_args()

    triage_path = REPO_ROOT / "data" / "incident_triage.json"
    incidents_path = REPO_ROOT / "fixtures" / "incidents.json"
    actions_path = REPO_ROOT / "data" / "response_actions.json"

    if not triage_path.exists():
        print(f"Error: {triage_path} does not exist", file=sys.stderr)
        return 1

    triage_bytes = triage_path.read_bytes()
    triage_data = json.loads(triage_bytes.decode("utf-8"))

    incidents = []
    if incidents_path.exists():
        incidents = json.loads(incidents_path.read_text(encoding="utf-8"))
    incidents_map = {inc["incident_id"]: inc for inc in incidents}

    actions = []
    if actions_path.exists():
        try:
            actions = json.loads(actions_path.read_text(encoding="utf-8"))
        except Exception:
            actions = []

    changed_ids: list[str] = []

    # Iterate deterministically
    for inc_id, triage_doc in sorted(triage_data.items()):
        explain = triage_doc.get("explain")
        if not explain:
            continue

        incident = incidents_map.get(inc_id, {})
        incident_actions = [a for a in actions if a.get("incident_id") == inc_id]
        triage_for_source = {k: v for k, v in triage_doc.items() if k != "explain"}

        source_text = (
            json.dumps(incident)
            + json.dumps(triage_for_source)
            + json.dumps(incident_actions)
        )
        explain_text = "\n".join([
            explain.get("summary", ""),
            explain.get("objective", ""),
            *explain.get("notable_details", []),
            *explain.get("next_steps", []),
            *explain.get("caveats", []),
        ])

        before = explain.get("ungrounded_mentions", [])
        after = grounding.find_ungrounded(explain_text, source_text)

        print(f"[{inc_id}] before: {before} -> after: {after}")

        if before != after:
            changed_ids.append(inc_id)
            if args.write:
                explain["ungrounded_mentions"] = after

    if args.write:
        if changed_ids:
            has_newline = triage_bytes.endswith(b"\n")
            text = triage_bytes.decode("utf-8")
            if "\n" in text.strip():
                formatted = json.dumps(triage_data, indent=2)
            else:
                formatted = json.dumps(triage_data)
            if has_newline and not formatted.endswith("\n"):
                formatted += "\n"
            triage_path.write_text(formatted, encoding="utf-8")
            print(f"Updated data/incident_triage.json. Changed incidents: {changed_ids}")
        else:
            print("No incidents changed.")
    else:
        print("(dry run -- no files modified; pass --write to apply)")

    return 0


if __name__ == "__main__":
    sys.exit(main())

