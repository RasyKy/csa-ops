"""FixtureStore must persist incident_triage to disk the same way it
already persists response_actions and intake_state -- otherwise a backend
restart silently loses triage data for incidents the watcher has already
marked processed and will never re-offer to handlers."""
from backend.app.store.fixture_store import FixtureStore


def test_triage_record_survives_a_fresh_fixture_store_instance(tmp_path):
    triage_path = tmp_path / "incident_triage.json"

    # Simulates the running backend process.
    store1 = FixtureStore(
        fixtures_dir="fixtures",
        intake_state_path=tmp_path / "intake_state.json",
        response_actions_path=tmp_path / "response_actions.json",
        incident_triage_path=triage_path,
    )
    record = {
        "incident_id": "inc-0003",
        "triage_time": "2026-01-01T00:00:00.000Z",
        "verdict": "true_positive",
        "confidence": "high",
        "reason": "clear LSASS dump",
        "model": "openai/deepseek-chat",
        "status": "ok",
        "explain": None,
    }
    store1.save_triage(record)

    assert triage_path.exists()  # written to disk, not just held in memory

    # Simulates a backend restart: a brand new process reading the same file.
    store2 = FixtureStore(
        fixtures_dir="fixtures",
        intake_state_path=tmp_path / "intake_state.json",
        response_actions_path=tmp_path / "response_actions.json",
        incident_triage_path=triage_path,
    )

    recovered = store2.get_triage("inc-0003")
    assert recovered == record


def test_multiple_triage_records_all_survive_a_restart(tmp_path):
    triage_path = tmp_path / "incident_triage.json"

    store1 = FixtureStore(
        fixtures_dir="fixtures",
        intake_state_path=tmp_path / "intake_state.json",
        response_actions_path=tmp_path / "response_actions.json",
        incident_triage_path=triage_path,
    )
    for incident_id in ["inc-0001", "inc-0002", "inc-0003", "inc-0004"]:
        store1.save_triage({
            "incident_id": incident_id, "triage_time": "2026-01-01T00:00:00.000Z",
            "verdict": "needs_review", "confidence": "low", "reason": "fake",
            "model": "openai/deepseek-chat", "status": "ok", "explain": None,
        })

    store2 = FixtureStore(
        fixtures_dir="fixtures",
        intake_state_path=tmp_path / "intake_state.json",
        response_actions_path=tmp_path / "response_actions.json",
        incident_triage_path=triage_path,
    )
    for incident_id in ["inc-0001", "inc-0002", "inc-0003", "inc-0004"]:
        assert store2.get_triage(incident_id) is not None
