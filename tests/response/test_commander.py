import pytest

from backend.app.store.fixture_store import FixtureStore
from engine.response import commander
from engine.response.decision import Decision
from engine.response.safety import KillSwitch


class FakeSettings:
    def __init__(self, kill_switch_path, response_live=False, response_live_hosts=None):
        self.kill_switch_path = kill_switch_path
        self.response_live = response_live
        self.response_live_hosts = response_live_hosts or []


@pytest.fixture
def store(tmp_path):
    return FixtureStore(
        fixtures_dir="fixtures",
        intake_state_path=tmp_path / "intake_state.json",
        response_actions_path=tmp_path / "response_actions.json",
        incident_triage_path=tmp_path / "incident_triage.json",
    )


@pytest.fixture
def settings(tmp_path):
    return FakeSettings(kill_switch_path=tmp_path / "killswitch")


def test_dry_run_issues_doc_with_mode_dry_run(store, settings):
    incident = store.get_incident("inc-0003")  # high severity, credential_dump_chain
    doc = commander.handle_incident(incident, store=store, settings=settings)

    assert doc["status"] == "issued"
    assert doc["mode"] == "dry_run"
    assert doc["action"] == "kill_process"
    assert doc["decided_by"]["policy_rule"] == "by_scenario:credential_dump_chain"


def test_kill_switch_blocks_before_decision_runs(store, settings, monkeypatch):
    KillSwitch(settings.kill_switch_path).set()

    called = {"decide": False}

    def fake_decide(*args, **kwargs):
        called["decide"] = True
        raise AssertionError("decide() must not be called while the kill switch is active")

    monkeypatch.setattr(commander.decision_module, "decide", fake_decide)

    incident = store.get_incident("inc-0003")
    doc = commander.handle_incident(incident, store=store, settings=settings)

    assert called["decide"] is False
    assert doc["status"] == "blocked_by_kill_switch"
    assert doc["action"] is None


def test_never_auto_rejected_from_automatic_path(store, settings, monkeypatch):
    # Simulate a policy.yaml misconfiguration that maps a severity/scenario
    # straight to a never_auto action, and confirm commander refuses it.
    monkeypatch.setattr(
        commander.decision_module,
        "decide",
        lambda incident: Decision(action="unisolate_host", target={}, policy_rule="test"),
    )

    incident = store.get_incident("inc-0003")
    doc = commander.handle_incident(incident, store=store, settings=settings)

    assert doc is None
    assert store.list_response_actions("inc-0003") == []


def test_never_auto_accepted_from_manual_path(store, settings):
    incident = store.get_incident("inc-0003")
    doc = commander.issue_manual_action(
        store=store, settings=settings, incident=incident, action="unisolate_host", target={"host": "WS01"},
    )
    assert doc["status"] == "issued"
    assert doc["action"] == "unisolate_host"


def test_manual_path_still_subject_to_kill_switch(store, settings):
    KillSwitch(settings.kill_switch_path).set()
    incident = store.get_incident("inc-0003")
    doc = commander.issue_manual_action(
        store=store, settings=settings, incident=incident, action="unisolate_host", target={},
    )
    assert doc["status"] == "blocked_by_kill_switch"


def test_handle_incident_is_idempotent_on_existing_response_action(store, settings, monkeypatch):
    # Regression: clearing intake_state to re-test triage re-fired the
    # commander too, issuing a duplicate isolate_host for an incident that
    # already had one. The watcher's processed-set is not the only guard --
    # commander.handle_incident must check its own store first.
    incident = store.get_incident("inc-0003")

    first = commander.handle_incident(incident, store=store, settings=settings)
    assert first["status"] == "issued"

    def fake_decide(*args, **kwargs):
        raise AssertionError("decide() must not run again for an incident that already has a response_actions doc")

    monkeypatch.setattr(commander.decision_module, "decide", fake_decide)

    second = commander.handle_incident(incident, store=store, settings=settings)

    assert second["action_id"] == first["action_id"]
    assert store.list_response_actions("inc-0003") == [first]


def test_handle_incident_idempotency_guard_also_covers_kill_switch_blocked_docs(store, settings):
    # A blocked_by_kill_switch doc is still a response_actions record --
    # re-processing while the kill switch is still on must not append a
    # second one either.
    KillSwitch(settings.kill_switch_path).set()
    incident = store.get_incident("inc-0003")

    first = commander.handle_incident(incident, store=store, settings=settings)
    second = commander.handle_incident(incident, store=store, settings=settings)

    assert first["status"] == second["status"] == "blocked_by_kill_switch"
    assert first["action_id"] == second["action_id"]
    assert len(store.list_response_actions("inc-0003")) == 1


def test_handle_incident_does_not_treat_a_prior_manual_action_as_already_handled(store, settings):
    # Regression: the idempotency guard above must only recognize the
    # automatic path's own prior decisions. An analyst issuing a manual
    # action first (e.g. before the watcher's next poll, or with
    # INTAKE_ENABLED=false) must not silently suppress the policy-mandated
    # automatic response -- the two paths are independent by design.
    incident = store.get_incident("inc-0003")  # policy: kill_process

    manual = commander.issue_manual_action(
        store=store, settings=settings, incident=incident, action="log", target={},
    )
    assert manual["decided_by"]["policy_rule"] == "manual"

    automatic = commander.handle_incident(incident, store=store, settings=settings)

    assert automatic is not None
    assert automatic["action"] == "kill_process"
    assert automatic["action_id"] != manual["action_id"]
    assert len(store.list_response_actions("inc-0003")) == 2

    # A second automatic pass must now be a no-op against its own record,
    # not the manual one and not a third dispatch.
    second_automatic = commander.handle_incident(incident, store=store, settings=settings)
    assert second_automatic["action_id"] == automatic["action_id"]
    assert len(store.list_response_actions("inc-0003")) == 2


def test_manual_path_still_subject_to_mode(store, settings):
    settings.response_live = True
    settings.response_live_hosts = ["WS01"]
    incident = store.get_incident("inc-0003")  # host WS01
    doc = commander.issue_manual_action(
        store=store, settings=settings, incident=incident, action="log", target={},
    )
    assert doc["mode"] == "live"
