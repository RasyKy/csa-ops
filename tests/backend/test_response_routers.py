from .conftest import AGENT_KEY, DASHBOARD_KEY

DASH = {"X-API-Key": DASHBOARD_KEY}
AGENT = {"X-API-Key": AGENT_KEY}


def test_agent_commands_requires_agent_key(client):
    assert client.get("/agent/commands?host=WS01").status_code == 401
    assert client.get("/agent/commands?host=WS01", headers=DASH).status_code == 403


def test_response_actions_requires_dashboard_key(client):
    assert client.get("/response/actions").status_code == 401
    assert client.get("/response/actions", headers=AGENT).status_code == 403


def test_agent_commands_empty_when_nothing_queued(client):
    res = client.get("/agent/commands?host=WS01", headers=AGENT)
    assert res.status_code == 200
    assert res.json() == {"commands": [], "kill_switch": False}


def test_manual_action_rejects_unknown_action(client):
    res = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "not_a_real_action", "target": {}},
    )
    assert res.status_code == 422


def test_manual_action_rejects_unknown_incident(client):
    res = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "does-not-exist", "action": "log", "target": {}},
    )
    assert res.status_code == 404


def test_manual_action_never_auto_succeeds(client):
    res = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "unisolate_host", "target": {}},
    )
    assert res.status_code == 200
    assert res.json()["action"] == "unisolate_host"
    assert res.json()["status"] == "issued"


def test_manual_action_appears_in_agent_commands(client):
    post = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "kill_process", "target": {"pid": 4412}},
    )
    action_id = post.json()["action_id"]

    res = client.get("/agent/commands?host=WS01", headers=AGENT)
    body = res.json()
    assert body["kill_switch"] is False
    assert len(body["commands"]) == 1
    assert body["commands"][0]["action_id"] == action_id
    assert body["commands"][0]["status"] == "received"
    assert body["commands"][0]["agent_received_time"] is not None


def test_kill_switch_blocks_manual_action_and_agent_commands(client):
    client.post("/response/config", headers=DASH, json={"kill_switch": True})

    res = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "kill_process", "target": {}},
    )
    assert res.json()["status"] == "blocked_by_kill_switch"

    commands = client.get("/agent/commands?host=WS01", headers=AGENT).json()
    assert commands == {"commands": [], "kill_switch": True}


def test_response_config_roundtrip(client):
    assert client.get("/response/config", headers=DASH).json()["kill_switch"] is False
    client.post("/response/config", headers=DASH, json={"kill_switch": True})
    assert client.get("/response/config", headers=DASH).json()["kill_switch"] is True
    client.post("/response/config", headers=DASH, json={"kill_switch": False})
    assert client.get("/response/config", headers=DASH).json()["kill_switch"] is False


def test_agent_results_updates_action(client):
    post = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "kill_process", "target": {"pid": 4412}},
    )
    action_id = post.json()["action_id"]
    client.get("/agent/commands?host=WS01", headers=AGENT)  # marks it received

    res = client.post(
        "/agent/results", headers=AGENT,
        json={"action_id": action_id, "status": "executed", "response_executed_time": "2026-09-13T00:00:00.000Z",
              "result": "done"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "executed"


def test_agent_results_404_for_unknown_action(client):
    res = client.post(
        "/agent/results", headers=AGENT,
        json={"action_id": "does-not-exist", "status": "failed"},
    )
    assert res.status_code == 404
