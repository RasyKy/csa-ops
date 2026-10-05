import json
import logging
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.demo_bootstrap import bootstrap_demo
from backend.app.main import create_app


def test_production_health_requires_key(monkeypatch):
    valid_key = "d" * 32
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DASHBOARD_API_KEY", valid_key)
    get_settings.cache_clear()

    app = create_app()
    with TestClient(app) as client:
        # Without key -> 401
        res = client.get("/health")
        assert res.status_code == 401
        assert res.json()["detail"] == "Missing X-API-Key"

        # Wrong key -> 403
        res = client.get("/health", headers={"X-API-Key": "wrong-key"})
        assert res.status_code == 403

        # Valid key -> 200
        res = client.get("/health", headers={"X-API-Key": valid_key})
        assert res.status_code == 200
        data = res.json()
        assert "store" in data
        assert "kill_switch" in data
        assert "response_mode" in data
    get_settings.cache_clear()


def test_production_healthz_remains_public(monkeypatch):
    valid_key = "d" * 32
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DASHBOARD_API_KEY", valid_key)
    get_settings.cache_clear()

    app = create_app()
    with TestClient(app) as client:
        res = client.get("/healthz")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}
    get_settings.cache_clear()


def test_non_production_health_and_healthz_public(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    get_settings.cache_clear()

    app = create_app()
    with TestClient(app) as client:
        # Health public without key
        res = client.get("/health")
        assert res.status_code == 200
        # Healthz public without key
        res = client.get("/healthz")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}
    get_settings.cache_clear()


def test_production_agent_routes_disabled_when_key_unset(monkeypatch, caplog):
    valid_dash_key = "d" * 32
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DASHBOARD_API_KEY", valid_dash_key)
    monkeypatch.delenv("AGENT_API_KEY", raising=False)
    get_settings.cache_clear()

    with caplog.at_level(logging.WARNING, logger="csa_ops"):
        app = create_app()

    assert "AGENT_API_KEY" in caplog.text

    with TestClient(app) as client:
        assert client.get("/agent/commands?host=WS01").status_code == 404
        assert client.post("/agent/results").status_code == 404
    get_settings.cache_clear()


def test_production_agent_routes_disabled_when_key_short(monkeypatch, caplog):
    valid_dash_key = "d" * 32
    short_agent_key = "short-key-123"
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DASHBOARD_API_KEY", valid_dash_key)
    monkeypatch.setenv("AGENT_API_KEY", short_agent_key)
    get_settings.cache_clear()

    with caplog.at_level(logging.WARNING, logger="csa_ops"):
        app = create_app()

    assert "AGENT_API_KEY" in caplog.text
    # Must never log the key value
    assert short_agent_key not in caplog.text

    with TestClient(app) as client:
        assert client.get("/agent/commands?host=WS01").status_code == 404
        assert client.post("/agent/results").status_code == 404
    get_settings.cache_clear()


def test_production_agent_routes_enabled_with_long_key(monkeypatch, caplog):
    valid_dash_key = "d" * 32
    valid_agent_key = "k" * 40
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DASHBOARD_API_KEY", valid_dash_key)
    monkeypatch.setenv("AGENT_API_KEY", valid_agent_key)
    get_settings.cache_clear()

    with caplog.at_level(logging.WARNING, logger="csa_ops"):
        app = create_app()

    # No warning about agent key disabled
    assert "agent routes are disabled" not in caplog.text
    assert valid_agent_key not in caplog.text

    with TestClient(app) as client:
        # Route exists and requires auth
        res_no_auth = client.get("/agent/commands?host=TEST-HOST-NONE")
        assert res_no_auth.status_code == 401
        res_auth = client.get("/agent/commands?host=TEST-HOST-NONE", headers={"X-API-Key": valid_agent_key})
        assert res_auth.status_code == 200
    get_settings.cache_clear()


def test_non_production_agent_routes_registered(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    get_settings.cache_clear()

    app = create_app()
    with TestClient(app) as client:
        # Route exists (returns 401 without key, not 404)
        assert client.get("/agent/commands?host=WS01").status_code == 401
    get_settings.cache_clear()


def test_demo_bootstrap_dict_cases(tmp_path, monkeypatch):
    seed_dir = tmp_path / "seed"
    seed_dir.mkdir()
    # Write mock triage and cases as dict
    triage = {"inc-1001": {"model": "test", "verdict": "suspicious", "confidence": "high", "reason": "test"}}
    (seed_dir / "incident_triage.json").write_text(json.dumps(triage), encoding="utf-8")
    cases = {"inc-1001": {"incident_id": "inc-1001", "status": "open", "title": "Test case"}}
    (seed_dir / "cases.json").write_text(json.dumps(cases), encoding="utf-8")

    work_dir = tmp_path / "work"
    settings = Settings(
        demo_bootstrap=True,
        fixture_set="realistic",
        demo_work_dir=str(work_dir),
    )

    bootstrap_demo(settings, seed_dir=seed_dir)

    work_cases = work_dir / "data" / "realistic" / "cases.json"
    assert work_cases.is_file()
    written_data = json.loads(work_cases.read_text(encoding="utf-8"))
    assert "inc-1001" in written_data
    assert written_data["inc-1001"]["title"] == "Test case"


def test_demo_bootstrap_dict_cases_unknown_id(tmp_path):
    seed_dir = tmp_path / "seed"
    seed_dir.mkdir()
    triage = {"inc-1001": {"model": "test", "verdict": "suspicious", "confidence": "high", "reason": "test"}}
    (seed_dir / "incident_triage.json").write_text(json.dumps(triage), encoding="utf-8")
    # inc-9999 does not exist in realistic scenario
    cases = {"inc-9999": {"incident_id": "inc-9999", "status": "open"}}
    (seed_dir / "cases.json").write_text(json.dumps(cases), encoding="utf-8")

    work_dir = tmp_path / "work"
    settings = Settings(
        demo_bootstrap=True,
        fixture_set="realistic",
        demo_work_dir=str(work_dir),
    )

    with pytest.raises(RuntimeError) as exc_info:
        bootstrap_demo(settings, seed_dir=seed_dir)
    assert "inc-9999" in str(exc_info.value)


def test_demo_bootstrap_list_cases(tmp_path):
    seed_dir = tmp_path / "seed"
    seed_dir.mkdir()
    triage = {"inc-1001": {"model": "test", "verdict": "suspicious", "confidence": "high", "reason": "test"}}
    (seed_dir / "incident_triage.json").write_text(json.dumps(triage), encoding="utf-8")
    # Backward compatible list format
    cases = [{"incident_id": "inc-1001", "status": "open", "title": "List case"}]
    (seed_dir / "cases.json").write_text(json.dumps(cases), encoding="utf-8")

    work_dir = tmp_path / "work"
    settings = Settings(
        demo_bootstrap=True,
        fixture_set="realistic",
        demo_work_dir=str(work_dir),
    )

    bootstrap_demo(settings, seed_dir=seed_dir)

    work_cases = work_dir / "data" / "realistic" / "cases.json"
    assert work_cases.is_file()
    written_data = json.loads(work_cases.read_text(encoding="utf-8"))
    assert isinstance(written_data, list)
    assert written_data[0]["incident_id"] == "inc-1001"
