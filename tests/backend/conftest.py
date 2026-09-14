import pytest
from fastapi.testclient import TestClient

from backend.app.config import get_settings
from backend.app.main import app

DASHBOARD_KEY = "test-dashboard-key"
AGENT_KEY = "test-agent-key"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHBOARD_API_KEY", DASHBOARD_KEY)
    monkeypatch.setenv("AGENT_API_KEY", AGENT_KEY)
    monkeypatch.setenv("STORE_BACKEND", "fixtures")
    monkeypatch.setenv("KILL_SWITCH_PATH", str(tmp_path / "killswitch"))
    monkeypatch.setenv("INTAKE_STATE_PATH", str(tmp_path / "intake_state.json"))
    monkeypatch.setenv("RESPONSE_ACTIONS_PATH", str(tmp_path / "response_actions.json"))
    monkeypatch.setenv("INTAKE_ENABLED", "false")
    monkeypatch.setenv("AGENT_LONG_POLL_SECONDS", "0")
    get_settings.cache_clear()

    with TestClient(app) as test_client:
        yield test_client

    get_settings.cache_clear()
