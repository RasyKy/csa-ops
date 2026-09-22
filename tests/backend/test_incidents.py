from .conftest import DASHBOARD_KEY

HEADERS = {"X-API-Key": DASHBOARD_KEY}


def test_list_incidents_returns_all_fixtures_joined(client):
    r = client.get("/incidents", headers=HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 5
    for item in data:
        # No triage yet on a fresh store -- must be null, not absent.
        assert item["triage_verdict"] is None
        assert item["triage_status"] is None
        assert item["last_response_action"] is None


def test_list_incidents_filters_by_severity_and_host(client):
    r = client.get("/incidents?severity=high&host=WS01", headers=HEADERS)
    data = r.json()
    assert len(data) == 1
    assert data[0]["incident_id"] == "inc-0003"


def test_get_incident_detail(client):
    r = client.get("/incidents/inc-0003", headers=HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert data["incident_id"] == "inc-0003"
    assert data["matched_scenario"] == "credential_dump_chain"
    assert data["triage"] is None
    assert data["response_history"] == []


def test_get_incident_detail_null_scenario_roundtrips(client):
    r = client.get("/incidents/inc-0001", headers=HEADERS)
    assert r.json()["matched_scenario"] is None


def test_get_incident_detail_404(client):
    r = client.get("/incidents/does-not-exist", headers=HEADERS)
    assert r.status_code == 404
