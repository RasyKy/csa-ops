"""End-to-end: the sample normalized events run through detection + correlation
produce the expected incidents, each valid against Person B's Incident model,
and do so reproducibly (NFR-7 flavour: same input -> same result)."""
import json
from pathlib import Path

from backend.app.models.incident import Incident
from engine.pipeline import run

SAMPLE = Path(__file__).resolve().parents[2] / "fixtures" / "normalized_events.sample.json"


def _events():
    return json.loads(SAMPLE.read_text())


def test_pipeline_produces_expected_alerts_and_incidents():
    result = run(_events())
    assert len(result.alerts) == 8
    assert len(result.incidents) == 5


def test_every_incident_validates_against_person_b_model():
    for incident in run(_events()).incidents:
        Incident(**incident)  # raises on any 4.3 contract violation


def test_one_incident_per_scenario():
    scenarios = sorted(i["matched_scenario"] for i in run(_events()).incidents if i["matched_scenario"])
    assert scenarios == [
        "credential_dump_chain",
        "exfiltration_chain",
        "lateral_movement_chain",
        "malware_drop_chain",
    ]


def test_every_incident_has_a_raised_time():
    for incident in run(_events()).incidents:
        assert incident["incident_raised_time"], "incident_raised_time closes MTTD / opens MTTR"


def test_noise_reduction_above_one_to_one():
    result = run(_events())
    assert result.run.noise_reduction_ratio > 1.0


def test_pipeline_is_reproducible():
    a, b = run(_events()), run(_events())
    assert len(a.alerts) == len(b.alerts)
    assert len(a.incidents) == len(b.incidents)
    assert (
        sorted(i["matched_scenario"] or "" for i in a.incidents)
        == sorted(i["matched_scenario"] or "" for i in b.incidents)
    )
