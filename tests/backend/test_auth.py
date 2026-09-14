from .conftest import AGENT_KEY, DASHBOARD_KEY


def test_health_needs_no_key(client):
    assert client.get("/health").status_code == 200


def test_incidents_requires_key(client):
    assert client.get("/incidents").status_code == 401


def test_incidents_rejects_wrong_key(client):
    r = client.get("/incidents", headers={"X-API-Key": "wrong"})
    assert r.status_code == 403


def test_incidents_rejects_agent_key(client):
    r = client.get("/incidents", headers={"X-API-Key": AGENT_KEY})
    assert r.status_code == 403


def test_incidents_accepts_dashboard_key(client):
    r = client.get("/incidents", headers={"X-API-Key": DASHBOARD_KEY})
    assert r.status_code == 200


def test_alerts_requires_key(client):
    assert client.get("/alerts").status_code == 401


def test_alerts_rejects_agent_key(client):
    r = client.get("/alerts", headers={"X-API-Key": AGENT_KEY})
    assert r.status_code == 403


def test_alerts_accepts_dashboard_key(client):
    r = client.get("/alerts", headers={"X-API-Key": DASHBOARD_KEY})
    assert r.status_code == 200
