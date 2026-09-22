from .conftest import DASHBOARD_KEY

HEADERS = {"X-API-Key": DASHBOARD_KEY}


def test_list_alerts_returns_all_fixtures(client):
    r = client.get("/alerts", headers=HEADERS)
    assert r.status_code == 200
    assert len(r.json()) == 7


def test_list_alerts_filters_by_severity(client):
    r = client.get("/alerts?severity=high", headers=HEADERS)
    data = r.json()
    assert len(data) == 2
    assert all(a["severity"] == "high" for a in data)


def test_list_alerts_filters_by_host(client):
    r = client.get("/alerts?host=WS04", headers=HEADERS)
    data = r.json()
    assert len(data) == 2
    assert all(a["host"] == "WS04" for a in data)


def test_list_alerts_respects_limit(client):
    r = client.get("/alerts?limit=1", headers=HEADERS)
    assert len(r.json()) == 1


def test_list_alerts_combined_filters_no_match(client):
    r = client.get("/alerts?severity=low&host=WS04", headers=HEADERS)
    assert r.json() == []
