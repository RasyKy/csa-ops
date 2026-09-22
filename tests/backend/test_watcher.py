import asyncio
import time

from backend.app.intake.watcher import IntakeWatcher
from backend.app.store.fixture_store import FixtureStore


def test_watcher_processes_each_incident_exactly_once_across_restarts(tmp_path):
    state_path = tmp_path / "intake_state.json"
    seen = []

    store1 = FixtureStore(fixtures_dir="fixtures", intake_state_path=state_path)
    watcher1 = IntakeWatcher(store=store1, handlers=[lambda inc: seen.append(inc["incident_id"])])
    first_batch = watcher1.poll_once()
    assert len(first_batch) == 5

    # Simulate a restart: a brand new store and watcher over the same on-disk state.
    store2 = FixtureStore(fixtures_dir="fixtures", intake_state_path=state_path)
    watcher2 = IntakeWatcher(store=store2, handlers=[lambda inc: seen.append(inc["incident_id"])])
    second_batch = watcher2.poll_once()
    assert second_batch == []

    assert len(seen) == 5
    assert len(set(seen)) == 5


def test_watcher_persists_watermark_as_latest_raised_time(tmp_path):
    state_path = tmp_path / "intake_state.json"
    store = FixtureStore(fixtures_dir="fixtures", intake_state_path=state_path)
    watcher = IntakeWatcher(store=store, handlers=[])
    watcher.poll_once()

    state = store.get_intake_state()
    assert state["watermark"] == "2026-09-13T10:15:03.001Z"  # latest incident_raised_time; unaffected by the older inc-0005
    assert len(state["processed_ids"]) == 5


def test_one_handler_raising_does_not_skip_the_next_handler_or_stop_the_batch(tmp_path):
    # Regression: a for-loop over handlers with no per-handler try/except
    # meant one handler's exception (e.g. a transient ES write failure in
    # commander.handle_incident) skipped every later handler for that
    # incident (e.g. triage never ran) and propagated out of poll_once()
    # entirely, which -- in the real async _run() loop -- would kill the
    # watcher's background task for the life of the process.
    state_path = tmp_path / "intake_state.json"
    store = FixtureStore(fixtures_dir="fixtures", intake_state_path=state_path)

    seen_by_second_handler = []

    def failing_handler(incident):
        raise RuntimeError(f"simulated failure for {incident['incident_id']}")

    def second_handler(incident):
        seen_by_second_handler.append(incident["incident_id"])

    watcher = IntakeWatcher(store=store, handlers=[failing_handler, second_handler])
    batch = watcher.poll_once()  # must not raise

    assert len(batch) == 5
    assert len(seen_by_second_handler) == 5  # ran for every incident despite the first handler failing
    assert len(store.get_intake_state()["processed_ids"]) == 5  # still marked processed


def test_run_does_not_block_the_event_loop_during_a_slow_handler(tmp_path):
    # Regression: _run() called poll_once() directly on the event loop with
    # no await/executor offload. Once a handler makes a real blocking call
    # (the AI triage handler's LLM request, up to LLM_TIMEOUT_SECONDS), that
    # froze every other coroutine on the same loop -- dashboard polling,
    # health checks, the agent's long-poll -- for the duration.
    def slow_handler(incident):
        time.sleep(0.3)

    store = FixtureStore(fixtures_dir="fixtures", intake_state_path=tmp_path / "intake_state.json")
    watcher = IntakeWatcher(store=store, handlers=[slow_handler], poll_seconds=60)

    async def scenario():
        heartbeats = []

        async def heartbeat():
            for _ in range(10):
                heartbeats.append(time.monotonic())
                await asyncio.sleep(0.03)

        await watcher.start()
        try:
            await heartbeat()
        finally:
            await watcher.stop()
        return heartbeats

    heartbeats = asyncio.run(scenario())
    gaps = [b - a for a, b in zip(heartbeats, heartbeats[1:])]
    assert max(gaps) < 0.15, (
        f"a heartbeat gap of {max(gaps):.3f}s suggests the slow handler blocked the event loop: {gaps}"
    )
