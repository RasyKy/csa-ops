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


def test_get_incident_report(client):
    r = client.get("/incidents/inc-0003/report", headers=HEADERS)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert "inc-0003" in r.headers["content-disposition"]
    body = r.text
    assert "inc-0003" in body
    assert "Attack Chain" in body


def test_get_incident_report_default_is_markdown_regression(client, monkeypatch):
    monkeypatch.setattr("backend.app.routers.incidents._utcnow", lambda: "2026-10-02T12:00:00.000Z")
    r_default = client.get("/incidents/inc-0003/report", headers=HEADERS)
    r_md = client.get("/incidents/inc-0003/report?format=md", headers=HEADERS)
    assert r_default.status_code == 200
    assert r_md.status_code == 200
    assert r_default.headers["content-type"] == r_md.headers["content-type"]
    assert r_default.headers["content-disposition"] == r_md.headers["content-disposition"]
    # Byte-identical regression check:
    assert r_default.content == r_md.content


def test_get_incident_report_pdf(client):
    r = client.get("/incidents/inc-0003/report?format=pdf", headers=HEADERS)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.headers["content-disposition"].endswith('.pdf"')
    assert r.content.startswith(b"%PDF-")


def test_get_incident_report_invalid_format(client):
    r = client.get("/incidents/inc-0003/report?format=invalid", headers=HEADERS)
    assert r.status_code == 400
    assert "format must be 'md' or 'pdf'" in r.json()["detail"]


def test_get_incident_report_404(client):
    r = client.get("/incidents/does-not-exist/report", headers=HEADERS)
    assert r.status_code == 404

