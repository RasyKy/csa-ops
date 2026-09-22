"""scripts/mttr_report.py's join/aggregation logic, exercised against
FixtureStore. The script is store-agnostic by design (same code path for
fixtures or Elasticsearch) so this validates its actual logic; it does not
prove anything about a real Elasticsearch cluster's behavior.
"""
import csv
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.mttr_report import compute_mttr_rows, write_csv  # noqa: E402

from backend.app.store.fixture_store import FixtureStore  # noqa: E402
from engine.response import commander  # noqa: E402


class FakeSettings:
    def __init__(self, kill_switch_path):
        self.kill_switch_path = kill_switch_path
        self.response_live = False
        self.response_live_hosts = []


def _store_with_one_completed_action(tmp_path):
    store = FixtureStore(
        fixtures_dir="fixtures",
        intake_state_path=tmp_path / "intake_state.json",
        response_actions_path=tmp_path / "response_actions.json",
    )
    settings = FakeSettings(kill_switch_path=tmp_path / "killswitch")
    incident = store.get_incident("inc-0003")  # high, credential_dump_chain
    doc = commander.handle_incident(incident, store=store, settings=settings)
    store.update_response_action(doc["action_id"], {
        "status": "executed",
        "response_executed_time": "2026-09-13T10:15:05.000Z",  # 2s after incident_raised_time
    })
    return store


def test_compute_mttr_rows_skips_actions_without_response_executed_time(tmp_path):
    store = FixtureStore(
        fixtures_dir="fixtures",
        intake_state_path=tmp_path / "intake_state.json",
        response_actions_path=tmp_path / "response_actions.json",
    )
    settings = FakeSettings(kill_switch_path=tmp_path / "killswitch")
    commander.handle_incident(store.get_incident("inc-0003"), store=store, settings=settings)

    rows = compute_mttr_rows(store)
    assert rows == []  # issued, but never executed -- MTTR undefined


def test_compute_mttr_rows_joins_incident_and_computes_seconds(tmp_path):
    store = _store_with_one_completed_action(tmp_path)

    rows = compute_mttr_rows(store)
    assert len(rows) == 1
    row = rows[0]
    assert row["incident_id"] == "inc-0003"
    assert row["matched_scenario"] == "credential_dump_chain"
    assert row["severity"] == "high"
    assert row["action"] == "kill_process"
    assert row["mttr_seconds"] == pytest.approx(1.999)  # 10:15:03.001 -> 10:15:05.000


def test_write_csv_round_trips_through_dictreader(tmp_path):
    store = _store_with_one_completed_action(tmp_path)
    rows = compute_mttr_rows(store)

    out_path = tmp_path / "report.csv"
    write_csv(rows, out_path)

    with out_path.open() as f:
        read_back = list(csv.DictReader(f))

    assert len(read_back) == 1
    assert read_back[0]["incident_id"] == "inc-0003"
    assert read_back[0]["action"] == "kill_process"
