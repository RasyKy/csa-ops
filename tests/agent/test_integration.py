from backend.app.config import get_settings
from tests.agent.mock_agent import run_agent_cycle
from tests.backend.conftest import AGENT_KEY, DASHBOARD_KEY, client  # noqa: F401

DASH = {"X-API-Key": DASHBOARD_KEY}


def test_mttr_fields_populated_in_order(client):
    post = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "kill_process", "target": {"pid": 4412}},
    )
    doc = post.json()
    assert doc["status"] == "issued"
    assert doc["agent_received_time"] is None
    assert doc["response_executed_time"] is None

    handled = run_agent_cycle(client, agent_api_key=AGENT_KEY, host="WS01")
    assert len(handled) == 1

    history = client.get("/incidents/inc-0003", headers=DASH).json()["response_history"]
    action = next(a for a in history if a["action_id"] == doc["action_id"])

    assert action["status"] == "executed"
    assert action["mode"] == "dry_run"
    assert action["command_issued_time"] <= action["agent_received_time"]
    assert action["agent_received_time"] <= action["response_executed_time"]
    assert action["result"].startswith("DRY RUN")


def test_agent_refuses_when_backend_live_but_agent_dry_run(client, monkeypatch):
    # RESPONSE_LIVE + host in RESPONSE_LIVE_HOSTS makes the backend issue mode=live,
    # but the agent's own AGENT_LIVE stays false -- it must still execute as dry-run.
    monkeypatch.setenv("RESPONSE_LIVE", "true")
    monkeypatch.setenv("RESPONSE_LIVE_HOSTS", '["WS01"]')
    get_settings.cache_clear()

    post = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "kill_process", "target": {"pid": 4412}},
    )
    doc = post.json()
    assert doc["mode"] == "live"

    handled = run_agent_cycle(client, agent_api_key=AGENT_KEY, host="WS01", agent_live=False)
    assert handled[0]["action"] == "kill_process"

    history = client.get("/incidents/inc-0003", headers=DASH).json()["response_history"]
    action = next(a for a in history if a["action_id"] == doc["action_id"])
    assert action["status"] == "executed"
    assert action["result"].startswith("DRY RUN")

    get_settings.cache_clear()


def test_agent_reports_blocked_when_backend_signals_kill_switch(client):
    post = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "kill_process", "target": {"pid": 4412}},
    )
    doc = post.json()

    client.post("/response/config", headers=DASH, json={"kill_switch": True})

    handled = run_agent_cycle(client, agent_api_key=AGENT_KEY, host="WS01")
    assert handled == []  # backend withholds dispatch entirely while the kill switch is active

    history = client.get("/incidents/inc-0003", headers=DASH).json()["response_history"]
    action = next(a for a in history if a["action_id"] == doc["action_id"])
    assert action["status"] == "issued"  # never handed to the agent, so still sitting as issued
