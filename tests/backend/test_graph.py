from .conftest import DASHBOARD_KEY

HEADERS = {"X-API-Key": DASHBOARD_KEY}


def test_graph_shape_and_trigger_flag(client):
    r = client.get("/incidents/inc-0003/graph", headers=HEADERS)
    assert r.status_code == 200
    graph = r.json()
    assert len(graph["nodes"]) == 3
    assert len(graph["edges"]) == 2
    assert graph["edges"][0]["from"] == "evt-0003-1"

    by_event = {n["event_id"]: n for n in graph["nodes"]}
    assert by_event["evt-0003-1"]["is_trigger"] is True
    assert by_event["evt-0003-1"]["rule_title"] == "Base64-Encoded PowerShell Command"
    assert by_event["evt-0003-2"]["is_trigger"] is True
    assert by_event["evt-0003-2"]["rule_title"] == "LSASS Memory Access"
    assert by_event["evt-0003-3"]["is_trigger"] is False
    assert by_event["evt-0003-3"]["rule_title"] is None


def test_graph_404_for_unknown_incident(client):
    r = client.get("/incidents/does-not-exist/graph", headers=HEADERS)
    assert r.status_code == 404
