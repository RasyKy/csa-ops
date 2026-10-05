"""scripts/ai_vs_analyst_report.py on a tmp copy of fixture-shaped data.

The script is read only: these tests run it as a subprocess and check that no
file anywhere under the tmp tree (or the repo's data/ and fixtures/) was created,
changed or removed."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "ai_vs_analyst_report.py"


def incident(incident_id, host, scenario, raised):
    return {"incident_id": incident_id, "host": host, "matched_scenario": scenario,
            "incident_raised_time": raised, "alert_ids": []}


def case(incident_id, status, verdict=None, assignee=None, note=None):
    events = [{"id": "evt-1", "time": "2026-10-04T10:00:00.000Z", "actor": "A", "type": "created", "data": {}}]
    if status == "resolved":
        events.append({"id": "evt-2", "time": "2026-10-04T10:05:00.000Z", "actor": "A", "type": "resolved",
                       "data": {"verdict": verdict, "note": note}})
    return {"incident_id": incident_id, "status": status, "assignee": assignee, "verdict": verdict,
            "resolution_note": note, "resolved_time": None, "updated_time": None, "events": events,
            "version": len(events)}


INCIDENTS = [
    incident("i-1", "WS01", "credential_dump_chain", "2026-10-01T10:00:00.000Z"),
    incident("i-2", "WS02", None, "2026-10-01T11:00:00.000Z"),
    incident("i-3", "WS|03", "exfiltration_chain", "2026-10-01T12:00:00.000Z"),
    incident("i-4", "WS04", None, "2026-10-01T13:00:00.000Z"),
    incident("i-5", "WS05", "malware_drop_chain", "2026-10-01T14:00:00.000Z"),
    incident("i-6", "WS06", None, "2026-10-01T15:00:00.000Z"),
]
TRIAGE = {
    "i-1": {"incident_id": "i-1", "verdict": "true_positive", "confidence": "high", "status": "ok"},
    "i-2": {"incident_id": "i-2", "verdict": "likely_false_positive", "confidence": "medium", "status": "ok"},
    "i-3": {"incident_id": "i-3", "verdict": "needs_review", "confidence": "low", "status": "ok"},
    "i-4": {"incident_id": "i-4", "verdict": "likely_true_positive", "confidence": "medium", "status": "ok"},
    "i-5": {"incident_id": "i-5", "verdict": "true_positive", "confidence": "high", "status": "failed"},
    # i-6 has no triage record
}
CASES = {
    "i-1": case("i-1", "resolved", "true_positive"),          # agree
    "i-2": case("i-2", "resolved", "true_positive"),          # disagree
    "i-3": case("i-3", "resolved", "false_positive"),         # AI uncertain
    "i-4": case("i-4", "resolved", "undetermined"),           # not scored
    "i-5": case("i-5", "resolved", "benign_activity"),        # failed triage: not scored
    # i-6: no case at all
}


def snapshot(*roots: Path) -> dict:
    out = {}
    for root in roots:
        for path in sorted(root.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                out[str(path)] = (hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns)
    return out


@pytest.fixture
def tree(tmp_path):
    fixtures = tmp_path / "fixtures" / "mini"
    data = tmp_path / "data" / "mini"
    fixtures.mkdir(parents=True)
    data.mkdir(parents=True)
    (fixtures / "incidents.json").write_text(json.dumps(INCIDENTS), encoding="utf-8")
    (fixtures / "alerts.json").write_text("[]", encoding="utf-8")
    (data / "incident_triage.json").write_text(json.dumps(TRIAGE), encoding="utf-8")
    (data / "cases.json").write_text(json.dumps(CASES), encoding="utf-8")
    return tmp_path


def run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], stdin=subprocess.DEVNULL, capture_output=True, text=True,
        timeout=60, cwd=REPO_ROOT,
    )


def args_for(tree, name="mini"):
    return ["--set", name, "--data-root", str(tree / "data"), "--fixture-root", str(tree / "fixtures")]


def test_table_and_counts(tree):
    result = run(*args_for(tree))
    assert result.returncode == 0, result.stderr
    out = result.stdout
    lines = out.splitlines()

    assert lines[0] == "# AI versus analyst verdicts (mini)"
    assert "| Incident | Host | Scenario | AI verdict | Analyst verdict | Agreement |" in lines
    rows = {l.split(" | ")[0].strip("| "): l for l in lines if l.startswith("| i-")}
    assert list(rows) == ["i-1", "i-2", "i-3", "i-4", "i-5", "i-6"]  # oldest first

    assert rows["i-1"] == "| i-1 | WS01 | credential_dump_chain | true positive (high) | True positive | Agree |"
    assert rows["i-2"].endswith("| likely false positive (medium) | True positive | Disagree |")
    assert rows["i-3"].endswith("| needs review (low) | False positive | AI uncertain |")
    assert rows["i-4"].endswith("| likely true positive (medium) | Undetermined | Not scored |")
    assert rows["i-5"].endswith("| - | Benign activity | Not scored |")  # failed triage shows no AI verdict
    assert rows["i-6"].endswith("| - | Not resolved | Not scored |")
    assert "WS\\|03" in rows["i-3"], "a pipe in a cell is escaped"
    assert "| i-6 | WS06 | - |" in rows["i-6"]

    assert "- Incidents: 6 (1 open, 0 investigating, 5 resolved)" in lines
    assert "- Resolved incidents: 5" in lines
    assert "- Scored (analyst and AI both gave a side): 2" in lines
    assert "- Agree: 1" in lines
    assert "- Disagree: 1" in lines
    assert "- AI uncertain (needs review): 1" in lines
    assert "- Not scored (analyst undetermined, or no usable AI verdict): 2" in lines
    assert "- Median time to resolve: 300 s over 5 resolved" in lines

    assert "| AI: malicious | 1 | 0 |" in lines
    assert "| AI: benign | 1 | 0 |" in lines
    assert "Small samples are illustrations, not statistics." in out


def test_summary_matches_the_endpoint_functions(tree):
    """The script uses the same functions as /metrics/cases, so the numbers cannot drift."""
    from backend.metrics import case_metrics as cm

    expected = cm.compute_ai_agreement(INCIDENTS, TRIAGE, CASES)
    out = run(*args_for(tree)).stdout
    assert f"- Agree: {expected['agree']}" in out
    assert f"- Disagree: {expected['disagree']}" in out
    assert f"- Scored (analyst and AI both gave a side): {expected['scored']}" in out


def test_it_is_read_only(tree):
    before_tree = snapshot(tree)
    before_repo = snapshot(REPO_ROOT / "data", REPO_ROOT / "fixtures")
    assert run(*args_for(tree)).returncode == 0
    assert run(*args_for(tree)).returncode == 0
    assert snapshot(tree) == before_tree, "the script created, changed or removed a file in the tmp tree"
    assert snapshot(REPO_ROOT / "data", REPO_ROOT / "fixtures") == before_repo
    assert not (tree / "data" / "mini" / "cases.json.corrupt").exists()


def test_no_cases_file_means_no_cases_and_still_writes_nothing(tree):
    (tree / "data" / "mini" / "cases.json").unlink()
    before = snapshot(tree)
    result = run(*args_for(tree))
    assert result.returncode == 0
    assert "- Resolved incidents: 0" in result.stdout
    assert "- Incidents: 6 (6 open, 0 investigating, 0 resolved)" in result.stdout
    assert snapshot(tree) == before
    assert not (tree / "data" / "mini" / "cases.json").exists(), "the script must not create cases.json"


def test_the_default_set_uses_the_top_level_folders(tmp_path):
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    (fixtures / "incidents.json").write_text(json.dumps(INCIDENTS[:2]), encoding="utf-8")
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "incident_triage.json").write_text(json.dumps(TRIAGE), encoding="utf-8")
    (tmp_path / "data" / "cases.json").write_text(json.dumps(CASES), encoding="utf-8")
    result = run("--set", "default", "--data-root", str(tmp_path / "data"), "--fixture-root", str(fixtures))
    assert result.returncode == 0, result.stderr
    assert "# AI versus analyst verdicts (default)" in result.stdout
    assert "- Resolved incidents: 2" in result.stdout


def test_a_corrupt_cases_file_is_reported_and_left_alone(tree):
    target = tree / "data" / "mini" / "cases.json"
    target.write_text("{ not json", encoding="utf-8")
    before = snapshot(tree)
    result = run(*args_for(tree))
    assert result.returncode != 0
    assert "cases.json" in (result.stderr + result.stdout)
    assert snapshot(tree) == before


def test_an_unknown_set_is_an_error(tree):
    result = run(*args_for(tree, name="nope"))
    assert result.returncode != 0
    assert "No incidents found" in (result.stderr + result.stdout)


def test_the_set_argument_is_required():
    assert run().returncode != 0
