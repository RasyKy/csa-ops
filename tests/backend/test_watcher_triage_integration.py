"""Confirms triage_incident is registered with the intake watcher, after
the response handler, so triage actually runs automatically on new
incidents rather than only on demand."""
import inspect

from fastapi.testclient import TestClient

from backend.app import main as main_module
from backend.app.config import get_settings
from backend.app.intake.watcher import IntakeWatcher
from backend.app.store.fixture_store import FixtureStore
from engine.response import commander

from .conftest import DASHBOARD_KEY

DASH = {"X-API-Key": DASHBOARD_KEY}


class FakeSettings:
    def __init__(self, kill_switch_path):
        self.kill_switch_path = kill_switch_path
        self.response_live = False
        self.response_live_hosts = []


def test_response_handler_is_registered_before_triage_handler_in_source():
    source = inspect.getsource(main_module.lifespan)
    handlers_list_pos = source.index("handlers = [")
    # Search from the list literal onward -- "_run_triage" also appears
    # earlier as its own `def`, which must not be confused with its
    # reference inside the handlers list.
    commander_pos = source.index("commander.handle_incident", handlers_list_pos)
    triage_pos = source.index("_run_triage", handlers_list_pos)
    assert handlers_list_pos < commander_pos < triage_pos


def test_watcher_auto_triages_new_incidents_alongside_response(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHBOARD_API_KEY", DASHBOARD_KEY)
    monkeypatch.setenv("AGENT_API_KEY", "test-agent-key")
    monkeypatch.setenv("STORE_BACKEND", "fixtures")
    monkeypatch.setenv("KILL_SWITCH_PATH", str(tmp_path / "killswitch"))
    monkeypatch.setenv("INTAKE_STATE_PATH", str(tmp_path / "intake_state.json"))
    monkeypatch.setenv("RESPONSE_ACTIONS_PATH", str(tmp_path / "response_actions.json"))
    monkeypatch.setenv("INCIDENT_TRIAGE_PATH", str(tmp_path / "incident_triage.json"))
    monkeypatch.setenv("INTAKE_ENABLED", "true")
    monkeypatch.setenv("INTAKE_POLL_SECONDS", "60")  # only need the one startup poll
    get_settings.cache_clear()

    from engine.ai_explain import triage as ai_triage
    from engine.ai_explain.schemas import TriageVerdict

    monkeypatch.setattr(
        ai_triage.llm_client, "complete",
        lambda system, user, schema: TriageVerdict(verdict="needs_review", confidence="low", reason="fake"),
    )

    try:
        with TestClient(main_module.app) as client:
            r = client.get("/incidents", headers=DASH)
            items = r.json()
            assert len(items) == 4
            for item in items:
                assert item["triage_verdict"] == "needs_review"
                assert item["triage_status"] == "ok"
                assert item["last_response_action"] is not None  # commander also ran, same handler list
    finally:
        get_settings.cache_clear()


def test_processing_same_incident_twice_through_the_watcher_does_not_duplicate_records(tmp_path, monkeypatch):
    # Real-world regression: clearing intake_state to re-test triage also
    # re-fired the commander, issuing a duplicate isolate_host for an
    # incident that already had one. Reproduce the exact scenario -- same
    # incident through the real watcher, twice -- and assert exactly one
    # response_actions doc and one incident_triage record survive (rule 12).
    from engine.ai_explain import triage as ai_triage
    from engine.ai_explain.schemas import TriageVerdict

    calls = []

    def fake_complete(system, user, schema):
        calls.append(1)
        return TriageVerdict(verdict="needs_review", confidence="low", reason="fake")

    monkeypatch.setattr(ai_triage.llm_client, "complete", fake_complete)

    store = FixtureStore(
        fixtures_dir="fixtures",
        intake_state_path=tmp_path / "intake_state.json",
        response_actions_path=tmp_path / "response_actions.json",
        incident_triage_path=tmp_path / "incident_triage.json",
    )
    settings = FakeSettings(kill_switch_path=tmp_path / "killswitch")

    handlers = [
        lambda incident: commander.handle_incident(incident, store=store, settings=settings),
        lambda incident: store.save_triage(ai_triage.triage_incident(incident, store=store).model_dump()),
    ]
    watcher = IntakeWatcher(store=store, handlers=handlers, poll_seconds=60)

    first_batch = watcher.poll_once()
    assert len(first_batch) == 4  # all 4 fixture incidents, first time through

    # Simulate exactly what happened manually: clear intake_state so the
    # watcher's processed-set no longer knows about these incidents.
    store.save_intake_state({"watermark": None, "processed_ids": []})

    second_batch = watcher.poll_once()
    assert len(second_batch) == 4  # the watcher re-offers them; the bug is what handlers do next

    assert len(calls) == 4  # not 8 -- triage was not re-run for already-triaged incidents

    for incident in store.list_incidents(limit=10):
        incident_id = incident["incident_id"]
        assert len(store.list_response_actions(incident_id)) == 1, (
            f"{incident_id} got a duplicate response_actions doc"
        )
        assert store.get_triage(incident_id) is not None
