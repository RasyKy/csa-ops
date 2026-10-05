from fastapi.testclient import TestClient

from backend.app.main import app


def test_healthz_returns_ok_without_key():
    with TestClient(app) as client:
        res = client.get("/healthz")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}


def test_incidents_without_key_is_401():
    with TestClient(app) as client:
        res = client.get("/incidents")
        assert res.status_code == 401

