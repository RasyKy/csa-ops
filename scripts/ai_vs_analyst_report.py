"""AI triage verdict versus analyst verdict, per incident, as Markdown.

READ ONLY: it loads the incidents and AI triage of a fixture set and the analyst
cases file, prints a table and the summary counts, and never writes any file.
It uses the same functions as GET /metrics/cases (backend/metrics/case_metrics.py),
so the numbers match the Overview.

Usage:
    python scripts/ai_vs_analyst_report.py --set realistic
    python scripts/ai_vs_analyst_report.py --set default
    python scripts/ai_vs_analyst_report.py --set NAME --data-root DIR --fixture-root DIR

Files read (NAME is the set; the default set uses the top-level folders):
    <fixture-root>/[NAME/]incidents.json
    <data-root>/[NAME/]incident_triage.json
    <data-root>/[NAME/]cases.json        (missing means no cases yet)

Small samples are illustrations, not statistics: with a handful of resolved
incidents the counts show how the comparison works, not how accurate the AI is.
"""
import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from backend.app.case_text import verdict_label  # noqa: E402
from backend.metrics import case_metrics  # noqa: E402

DEFAULT_SET_NAMES = ("", "default")


def _read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SystemExit(f"Could not read {path}: {exc}")


def _folder(root: Path, name: str) -> Path:
    return root if name in DEFAULT_SET_NAMES else root / name


def _cell(value) -> str:
    text = "-" if value in (None, "") else str(value)
    return text.replace("\r", " ").replace("\n", " ").replace("|", "\\|")


def load(set_name: str, data_root: Path, fixture_root: Path):
    fixtures = _folder(fixture_root, set_name)
    if not (fixtures / "incidents.json").is_file():
        raise SystemExit(f"No incidents found: expected {fixtures / 'incidents.json'}")
    data = _folder(data_root, set_name)

    incidents = _read_json(fixtures / "incidents.json", [])
    triage = _read_json(data / "incident_triage.json", {})
    cases = _read_json(data / "cases.json", {})
    if not isinstance(incidents, list) or not isinstance(triage, dict) or not isinstance(cases, dict):
        raise SystemExit("Unexpected file shape: incidents must be a list, triage and cases objects.")
    return incidents, triage, cases


def _row_outcome(incident: dict, triage: dict, cases: dict) -> str:
    one = case_metrics.compute_ai_agreement([incident], triage, cases)
    if one["scored"]:
        return "Agree" if one["agree"] else "Disagree"
    if one["ai_uncertain"]:
        return "AI uncertain"
    return "Not scored"


def _ai_cell(triage_record) -> str:
    if not isinstance(triage_record, dict) or triage_record.get("status") == "failed" or not triage_record.get("verdict"):
        return "-"
    verdict = str(triage_record["verdict"]).replace("_", " ")
    confidence = triage_record.get("confidence")
    return f"{verdict} ({confidence})" if confidence else verdict


def build_report(set_name: str, incidents: list, triage: dict, cases: dict) -> str:
    incidents = [i for i in incidents if isinstance(i, dict) and "incident_id" in i]
    incidents.sort(key=lambda i: str(i.get("incident_raised_time") or ""))

    lines = [
        f"# AI versus analyst verdicts ({set_name or 'default'})",
        "",
        "| Incident | Host | Scenario | AI verdict | Analyst verdict | Agreement |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for incident in incidents:
        incident_id = incident["incident_id"]
        case = cases.get(incident_id)
        resolved = isinstance(case, dict) and case.get("status") == "resolved"
        analyst = verdict_label(case.get("verdict")) if resolved else "Not resolved"
        lines.append(
            "| {} | {} | {} | {} | {} | {} |".format(
                _cell(incident_id),
                _cell(incident.get("host")),
                _cell(incident.get("matched_scenario")),
                _cell(_ai_cell(triage.get(incident_id))),
                _cell(analyst),
                _row_outcome(incident, triage, cases),
            )
        )

    agreement = case_metrics.compute_ai_agreement(incidents, triage, cases)
    counts = case_metrics.compute_status_counts(incidents, cases)
    resolve = case_metrics.compute_resolve_times(cases, [i["incident_id"] for i in incidents])
    confusion = agreement["confusion"]

    lines += [
        "",
        "## Summary",
        "",
        f"- Incidents: {len(incidents)} ({counts['open']} open, {counts['investigating']} investigating, {counts['resolved']} resolved)",
        f"- Resolved incidents: {agreement['resolved_total']}",
        f"- Scored (analyst and AI both gave a side): {agreement['scored']}",
        f"- Agree: {agreement['agree']}",
        f"- Disagree: {agreement['disagree']}",
        f"- AI uncertain (needs review): {agreement['ai_uncertain']}",
        f"- Not scored (analyst undetermined, or no usable AI verdict): {agreement['unscored']}",
    ]
    if resolve["count"]:
        lines.append(f"- Median time to resolve: {resolve['median_seconds']:.0f} s over {resolve['count']} resolved")
    lines += [
        "",
        "## Confusion table",
        "",
        "| | Analyst: malicious | Analyst: benign |",
        "| --- | --- | --- |",
        f"| AI: malicious | {confusion['ai_malicious_analyst_malicious']} | {confusion['ai_malicious_analyst_benign']} |",
        f"| AI: benign | {confusion['ai_benign_analyst_malicious']} | {confusion['ai_benign_analyst_benign']} |",
        "",
        "AI sides: true positive and likely true positive are malicious; false positive and likely false positive "
        "are benign; needs review is uncertain. Analyst sides: true positive is malicious; false positive and benign "
        "activity are benign; undetermined is not scored.",
        "",
        "Small samples are illustrations, not statistics.",
    ]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="AI versus analyst verdicts (read only).")
    parser.add_argument("--set", dest="set_name", required=True, help="fixture set name, or 'default'")
    parser.add_argument("--data-root", default=str(REPO_ROOT / "data"))
    parser.add_argument("--fixture-root", default=str(REPO_ROOT / "fixtures"))
    args = parser.parse_args(argv)

    incidents, triage, cases = load(args.set_name, Path(args.data_root), Path(args.fixture_root))
    sys.stdout.write(build_report(args.set_name, incidents, triage, cases))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
