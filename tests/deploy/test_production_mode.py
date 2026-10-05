import logging
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.main import create_app


def test_production_mode_disables_docs(monkeypatch):
    key = "a" * 32
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DASHBOARD_API_KEY", key)
    get_settings.cache_clear()

    prod_app = create_app()
    with TestClient(prod_app) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/redoc").status_code == 404
        assert client.get("/openapi.json").status_code == 404
    get_settings.cache_clear()


def test_production_mode_unset_key_raises_on_startup(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("DASHBOARD_API_KEY", raising=False)
    get_settings.cache_clear()

    prod_app = create_app()
    with pytest.raises(RuntimeError) as exc_info:
        with TestClient(prod_app):
            pass
    assert "DASHBOARD_API_KEY" in str(exc_info.value)
    get_settings.cache_clear()


def test_production_mode_short_key_raises_on_startup(monkeypatch, caplog):
    short_key = "1234567890"  # 10 chars
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DASHBOARD_API_KEY", short_key)
    get_settings.cache_clear()

    prod_app = create_app()
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(RuntimeError) as exc_info:
            with TestClient(prod_app):
                pass
    assert "DASHBOARD_API_KEY" in str(exc_info.value)
    # The key itself must NEVER appear in the exception message or logs
    assert short_key not in str(exc_info.value)
    assert short_key not in caplog.text
    get_settings.cache_clear()


def test_production_mode_32_char_key_starts(monkeypatch, caplog):
    valid_key = "k" * 32
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DASHBOARD_API_KEY", valid_key)
    get_settings.cache_clear()

    prod_app = create_app()
    with caplog.at_level(logging.DEBUG):
        with TestClient(prod_app) as client:
            res = client.get("/healthz")
            assert res.status_code == 200
    assert valid_key not in caplog.text
    get_settings.cache_clear()

