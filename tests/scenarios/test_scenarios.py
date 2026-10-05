"""Each scenario raises exactly one incident, from exactly the expected rules,
through the real detection and correlation pipeline."""
import hashlib
import json
from pathlib import Path

import pytest

from backend.app.models.alert import Alert
from backend.app.models.incident import Incident
from scripts.generate_scenarios import OUTPUT_FILES, REPO_ROOT, generate
from scripts.scenarios.definitions import SCENARIOS
from tests.scenarios.conftest import FIXED_ANCHOR

# Derived from the Sigma rule levels (low for T1012, high for the rest) and the
# technique prefixes in engine/correlation/risk.py, not from pipeline output.
EXPECTED_SEVERITY = {"s1": "high", "s2": "high", "s3": "low", "s4": "high", "s5": "high", "s6": "high", "s7": "high", "s8": "high"}
EXPECTED_MATCHED = {
    "s1": None, "s2": None, "s3": None, "s4": "exfiltration_chain", "s5": "credential_dump_chain",
    "s6": "credential_dump_chain", "s7": None, "s8": "lateral_movement_chain",
}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _scn_of(event_id: str) -> str:
    return event_id.split("-")[1]


def test_determinism_same_anchor_byte_identical(generated, tmp_path):
    second = generate(FIXED_ANCHOR, tmp_path)
    first_dir = Path(generated["out_dir"])
    lines = []
    for name in OUTPUT_FILES:
        a, b = _sha(first_dir / name), _sha(Path(second["out_dir"]) / name)
        lines.append(f"{name}: {a} == {b}")
        assert a == b, name
    print("\ndeterminism check (two runs, same anchor):\n  " + "\n  ".join(lines))


def test_different_anchor_changes_timestamps_only(generated, tmp_path):
    other = generate("2026-10-05T12:00:00.000Z", tmp_path)
    assert [i["incident_id"] for i in other["incidents"]] == [i["incident_id"] for i in generated["incidents"]]
    assert other["events"][0]["timestamp"] != generated["events"][0]["timestamp"]


def test_output_dir_contains_only_the_four_files(generated):
    assert sorted(p.name for p in Path(generated["out_dir"]).iterdir()) == sorted(OUTPUT_FILES)
    for name in OUTPUT_FILES:
        text = (Path(generated["out_dir"]) / name).read_text(encoding="utf-8")
        assert text.endswith("\n") and not text.endswith("\n\n")
        assert "\r" not in text


def test_exactly_eight_incidents_with_stable_ids(generated):
    ids = [i["incident_id"] for i in generated["incidents"]]
    assert ids == [f"inc-{1001 + n}" for n in range(8)]


@pytest.mark.parametrize("scn", SCENARIOS, ids=[s["id"] for s in SCENARIOS])
def test_scenario_yields_one_incident_with_expected_rules(generated, scn):
    incidents = [i for i in generated["incidents"] if i["host"] == scn["host"]]
    assert len(incidents) == 1
    incident = incidents[0]
    assert incident["user"] == scn["user"]

    own_alerts = [a for a in generated["alerts"] if a["host"] == scn["host"]]
    fired = sorted(a["rule_id"] for a in own_alerts)
    assert sorted(set(fired)) == sorted(scn["expected_rules"])
    assert len(fired) == len(set(fired)), "each expected rule fires exactly once per scenario"
    assert {a["alert_id"] for a in own_alerts} == set(incident["alert_ids"])

    low, high = scn["event_count_range"]
    nodes = incident["chain"]["nodes"]
    assert low <= len(nodes) <= high
    assert incident["severity"] == EXPECTED_SEVERITY[scn["id"]]
    assert incident["matched_scenario"] == EXPECTED_MATCHED[scn["id"]]
    assert incident["risk_score"] > 0
    print(
        f"\n{scn['id']} {scn['name']}: incident={incident['incident_id']} severity={incident['severity']} "
        f"matched_scenario={incident['matched_scenario']} risk_score={incident['risk_score']} "
        f"alerts={len(own_alerts)} nodes={len(nodes)}"
    )


@pytest.mark.parametrize("scn", SCENARIOS, ids=[s["id"] for s in SCENARIOS])
def test_chain_is_connected_and_edges_resolve(generated, scn):
    incident = next(i for i in generated["incidents"] if i["host"] == scn["host"])
    nodes = {n["event_id"]: n for n in incident["chain"]["nodes"]}
    edges = incident["chain"]["edges"]
    for edge in edges:
        assert edge["from"] in nodes and edge["to"] in nodes
        assert edge["relation"] in {"parent", "network", "file", "registry"}
    adjacency = {eid: set() for eid in nodes}
    for edge in edges:
        adjacency[edge["from"]].add(edge["to"])
        adjacency[edge["to"]].add(edge["from"])
    start = next(iter(nodes))
    seen, stack = set(), [start]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(adjacency[current] - seen)
    assert seen == set(nodes), f"disconnected nodes: {set(nodes) - seen}"


def test_no_background_event_reaches_an_incident_or_alert(generated):
    background = {eid for row in generated["manifest"] for eid in row["background_event_ids"]}
    assert len(background) == 3 * len(SCENARIOS)
    for incident in generated["incidents"]:
        assert not background & {n["event_id"] for n in incident["chain"]["nodes"]}
    assert not background & {a["event_id"] for a in generated["alerts"]}


def test_analyst_labels(generated):
    by_event_scn = {a["alert_id"]: _scn_of(a["event_id"]) for a in generated["alerts"]}
    per_scn: dict[str, list[dict]] = {}
    for alert in generated["alerts"]:
        per_scn.setdefault(by_event_scn[alert["alert_id"]], []).append(alert)
    for scn_id, alerts in per_scn.items():
        alerts.sort(key=lambda a: a["alert_id"])
        if scn_id == "s7":
            assert [a.get("false_positive") for a in alerts] == [True]
        elif scn_id in ("s1", "s4", "s5"):
            assert alerts[0]["false_positive"] is False
            assert all("false_positive" not in a for a in alerts[1:])
        else:
            assert all("false_positive" not in a for a in alerts)


def test_alert_ids_follow_scenario_numbering(generated):
    for alert in generated["alerts"]:
        scn_number = int(_scn_of(alert["event_id"])[1:])
        assert alert["alert_id"].startswith(f"alert-{1000 + scn_number}")


def test_documents_validate_against_backend_models(generated):
    for alert in generated["alerts"]:
        Alert(**alert)
    for incident in generated["incidents"]:
        Incident(**incident)


def test_manifest_matches_incidents(generated):
    by_host = {i["host"]: i for i in generated["incidents"]}
    for row in generated["manifest"]:
        incident = by_host[row["host"]]
        assert row["incident_id"] == incident["incident_id"]
        assert row["alert_count"] == len(incident["alert_ids"])
        assert row["event_count"] >= 2
        assert row["expected_rules"] and row["narrative"] and row["start_offset"]
    print("\nmanifest: " + json.dumps([r["scenario_id"] for r in generated["manifest"]]))


def test_committed_realistic_fixtures_are_valid():
    directory = REPO_ROOT / "fixtures" / "realistic"
    if not directory.exists():
        pytest.skip("fixtures/realistic has not been generated")
    incidents = json.loads((directory / "incidents.json").read_text(encoding="utf-8"))
    alerts = json.loads((directory / "alerts.json").read_text(encoding="utf-8"))
    manifest = json.loads((directory / "scenarios.json").read_text(encoding="utf-8"))
    assert len(incidents) == 8 and len(manifest) == 8
    for incident in incidents:
        Incident(**incident)
    for alert in alerts:
        Alert(**alert)
