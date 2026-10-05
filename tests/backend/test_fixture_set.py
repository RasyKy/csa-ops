"""FIXTURE_SET: opt-in realistic fixture set with its own runtime data directory.

Everything runs against tmp dirs through FIXTURE_ROOT and DATA_ROOT, the intake
watcher loop is disabled and no LLM is called."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.intake.watcher import IntakeWatcher
from backend.app.main import app
from backend.app.store import build_store
from scripts.generate_scenarios import generate

DASHBOARD_KEY = "test-dashboard-key"
DASH = {"X-API-Key": DASHBOARD_KEY}


def _env(monkeypatch, tmp_path, **extra):
    monkeypatch.setenv("DASHBOARD_API_KEY", DASHBOARD_KEY)
    monkeypatch.setenv("AGENT_API_KEY", "test-agent-key")
    monkeypatch.setenv("STORE_BACKEND", "fixtures")
    monkeypatch.setenv("KILL_SWITCH_PATH", str(tmp_path / "killswitch"))
    monkeypatch.setenv("INTAKE_ENABLED", "false")
    monkeypatch.setenv("AGENT_LONG_POLL_SECONDS", "0")
    for key, value in extra.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


@pytest.fixture
def realistic(tmp_path, monkeypatch):
    fixtures_root, data_root = tmp_path / "fixtures", tmp_path / "data"
    generated = generate("now", fixtures_root / "realistic")
    _env(
        monkeypatch, tmp_path,
        FIXTURE_SET="realistic", FIXTURE_ROOT=str(fixtures_root), DATA_ROOT=str(data_root),
    )
    with TestClient(app) as client:
        yield client, generated, data_root
    get_settings.cache_clear()


def test_incidents_returns_all_eight(realistic):
    client, _, _ = realistic
    body = client.get("/incidents?limit=100", headers=DASH).json()
    assert len(body) == 8
    assert sorted(i["incident_id"] for i in body) == [f"inc-{1001 + n}" for n in range(8)]


def test_every_graph_has_event_type_and_host(realistic):
    client, generated, _ = realistic
    for incident in generated["incidents"]:
        graph = client.get(f"/incidents/{incident['incident_id']}/graph", headers=DASH).json()
        assert graph["nodes"], incident["incident_id"]
        for node in graph["nodes"]:
            assert node["event_type"], node
            assert node["host"], node


def test_summary_total_incidents_matches_those_raised_within_24h(realistic):
    client, generated, _ = realistic
    now = datetime.now(timezone.utc)
    expected = sum(
        1 for i in generated["incidents"]
        if now - datetime.fromisoformat(i["incident_raised_time"].replace("Z", "+00:00")) <= timedelta(hours=24)
    )
    assert 0 < expected < 8
    body = client.get("/metrics/summary?range=24h", headers=DASH).json()
    assert body["total_incidents"] == {"value": expected, "status": "ok"}


def test_timeseries_7d_is_ok(realistic):
    client, _, _ = realistic
    body = client.get("/metrics/timeseries?range=7d", headers=DASH).json()
    assert body["buckets"]["status"] == "ok"


def test_mitre_has_no_parent_next_to_its_own_subtechnique(realistic):
    client, _, _ = realistic
    cells = client.get("/metrics/mitre?range=all", headers=DASH).json()["techniques"]["value"]
    techniques = {c["technique"] for c in cells}
    for technique in techniques:
        if "." in technique:
            assert technique.split(".")[0] not in techniques, technique
    for wanted in ("T1048", "T1547.001", "T1059.001"):
        assert wanted in techniques
    # the credential-access rule is tagged T1003.001, which represents T1003
    assert any(t == "T1003" or t.startswith("T1003.") for t in techniques)
    print(f"\nmitre cells with the realistic set: {sorted(techniques)}")


def test_intake_state_lands_under_data_name_not_data(realistic):
    client, generated, data_root = realistic
    for filename, empty in (
        ("intake_state.json", {"watermark": None, "processed_ids": []}),
        ("response_actions.json", []),
        ("incident_triage.json", {}),
    ):
        assert json.loads((data_root / "realistic" / filename).read_text()) == empty

    store = client.app.state.store
    IntakeWatcher(store=store, handlers=[], poll_seconds=1).poll_once()

    state = json.loads((data_root / "realistic" / "intake_state.json").read_text())
    assert state["processed_ids"] == sorted(i["incident_id"] for i in generated["incidents"])
    assert state["watermark"] == max(i["incident_raised_time"] for i in generated["incidents"])
    assert not (data_root / "intake_state.json").exists()
    assert sorted(p.name for p in data_root.iterdir()) == ["realistic"]


@pytest.mark.parametrize("value", [None, "", "default"])
def test_unset_empty_or_default_serves_the_original_five(tmp_path, monkeypatch, value):
    _env(
        monkeypatch, tmp_path,
        INTAKE_STATE_PATH=str(tmp_path / "intake_state.json"),
        RESPONSE_ACTIONS_PATH=str(tmp_path / "response_actions.json"),
        INCIDENT_TRIAGE_PATH=str(tmp_path / "incident_triage.json"),
    )
    if value is None:
        monkeypatch.delenv("FIXTURE_SET", raising=False)
    else:
        monkeypatch.setenv("FIXTURE_SET", value)
    get_settings.cache_clear()
    with TestClient(app) as client:
        body = client.get("/incidents?limit=100", headers=DASH).json()
    get_settings.cache_clear()
    assert sorted(i["incident_id"] for i in body) == [f"inc-000{n}" for n in range(1, 6)]
    assert list(tmp_path.glob("realistic")) == []


@pytest.mark.parametrize("name", ["Bad Name", "UPPER", "../escape", "a/b", "with.dot", "nope_missing"])
def test_invalid_or_missing_set_fails_fast(tmp_path, monkeypatch, name):
    _env(
        monkeypatch, tmp_path,
        FIXTURE_SET=name, FIXTURE_ROOT=str(tmp_path / "fixtures"), DATA_ROOT=str(tmp_path / "data"),
    )
    (tmp_path / "fixtures").mkdir()
    with pytest.raises(ValueError, match="FIXTURE_SET"):
        build_store(get_settings())
    with pytest.raises(ValueError, match="FIXTURE_SET"):
        with TestClient(app):
            pass
    assert not (tmp_path / "data").exists()
    get_settings.cache_clear()


def test_set_directory_without_incidents_fails_fast(tmp_path, monkeypatch):
    (tmp_path / "fixtures" / "half").mkdir(parents=True)
    (tmp_path / "fixtures" / "half" / "alerts.json").write_text("[]")
    _env(
        monkeypatch, tmp_path,
        FIXTURE_SET="half", FIXTURE_ROOT=str(tmp_path / "fixtures"), DATA_ROOT=str(tmp_path / "data"),
    )
    with pytest.raises(ValueError, match="incidents.json"):
        build_store(get_settings())
    get_settings.cache_clear()


def test_named_set_is_rejected_for_the_elasticsearch_backend():
    settings = Settings(store_backend="elasticsearch", fixture_set="realistic")
    with pytest.raises(ValueError, match="FIXTURE_SET"):
        build_store(settings)
