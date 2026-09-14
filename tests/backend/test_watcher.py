from backend.app.intake.watcher import IntakeWatcher
from backend.app.store.fixture_store import FixtureStore


def test_watcher_processes_each_incident_exactly_once_across_restarts(tmp_path):
    state_path = tmp_path / "intake_state.json"
    seen = []

    store1 = FixtureStore(fixtures_dir="fixtures", intake_state_path=state_path)
    watcher1 = IntakeWatcher(store=store1, handlers=[lambda inc: seen.append(inc["incident_id"])])
    first_batch = watcher1.poll_once()
    assert len(first_batch) == 4

    # Simulate a restart: a brand new store and watcher over the same on-disk state.
    store2 = FixtureStore(fixtures_dir="fixtures", intake_state_path=state_path)
    watcher2 = IntakeWatcher(store=store2, handlers=[lambda inc: seen.append(inc["incident_id"])])
    second_batch = watcher2.poll_once()
    assert second_batch == []

    assert len(seen) == 4
    assert len(set(seen)) == 4


def test_watcher_persists_watermark_as_latest_raised_time(tmp_path):
    state_path = tmp_path / "intake_state.json"
    store = FixtureStore(fixtures_dir="fixtures", intake_state_path=state_path)
    watcher = IntakeWatcher(store=store, handlers=[])
    watcher.poll_once()

    state = store.get_intake_state()
    assert state["watermark"] == "2026-09-13T10:15:03.001Z"
    assert len(state["processed_ids"]) == 4
