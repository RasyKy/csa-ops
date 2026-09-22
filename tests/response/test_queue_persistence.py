from backend.app.store.fixture_store import FixtureStore
from engine.response import commander


class FakeSettings:
    def __init__(self, kill_switch_path):
        self.kill_switch_path = kill_switch_path
        self.response_live = False
        self.response_live_hosts = []


def test_restart_recovers_unreceived_commands(tmp_path):
    actions_path = tmp_path / "response_actions.json"
    settings = FakeSettings(kill_switch_path=tmp_path / "killswitch")

    store1 = FixtureStore(fixtures_dir="fixtures", intake_state_path=tmp_path / "intake_state.json",
                           response_actions_path=actions_path)
    incident = store1.get_incident("inc-0003")
    issued = commander.handle_incident(incident, store=store1, settings=settings)
    assert issued["status"] == "issued"

    # Simulate a backend restart: brand new store instance over the same on-disk file.
    store2 = FixtureStore(fixtures_dir="fixtures", intake_state_path=tmp_path / "intake_state.json",
                           response_actions_path=actions_path)

    pending = store2.list_pending_commands("WS01")
    assert len(pending) == 1
    assert pending[0]["action_id"] == issued["action_id"]
    assert pending[0]["status"] == "issued"


def test_restart_recovers_received_but_not_executed_commands(tmp_path):
    actions_path = tmp_path / "response_actions.json"
    settings = FakeSettings(kill_switch_path=tmp_path / "killswitch")

    store1 = FixtureStore(fixtures_dir="fixtures", intake_state_path=tmp_path / "intake_state.json",
                           response_actions_path=actions_path)
    incident = store1.get_incident("inc-0003")
    issued = commander.handle_incident(incident, store=store1, settings=settings)
    store1.update_response_action(issued["action_id"], {"status": "received", "agent_received_time": "now"})

    store2 = FixtureStore(fixtures_dir="fixtures", intake_state_path=tmp_path / "intake_state.json",
                           response_actions_path=actions_path)
    recovered = store2.get_response_action(issued["action_id"])
    assert recovered["status"] == "received"
    assert recovered["agent_received_time"] == "now"
