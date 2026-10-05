"""Analyst case management: model, file-backed store and REST API.

Everything runs against tmp dirs (DATA_ROOT and every runtime path point there),
a fake clock and the in-process TestClient. No server, network or LLM, and
nothing is written under the repo's data/ or fixtures/."""
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import get_settings
from backend.app.main import app
from backend.app.models.case import Case
from backend.app.store import get_case_store
from backend.app.store import case_store as case_store_module
from backend.app.store.case_store import CaseStore
from scripts.generate_scenarios import generate

DASHBOARD_KEY = "test-dashboard-key"
DASH = {"X-API-Key": DASHBOARD_KEY}
REPO_ROOT = Path(__file__).resolve().parents[2]
INC = "inc-0003"  # default fixture set
ENDPOINTS = [
    ("get", "/incidents/{id}/case", None),
    ("patch", "/incidents/{id}/case", {"status": "investigating"}),
    ("post", "/incidents/{id}/case/notes", {"text": "hello"}),
    ("post", "/incidents/{id}/case/resolve", {"verdict": "true_positive"}),
    ("post", "/incidents/{id}/case/reopen", {}),
]


class FakeClock:
    """Each call is one second later, so event order is visible in the times."""

    def __init__(self):
        self._t = datetime(2026, 10, 4, 10, 0, 0, tzinfo=timezone.utc)
        self.calls = 0

    def __call__(self) -> str:
        self.calls += 1
        self._t += timedelta(seconds=1)
        return self._t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _env(monkeypatch, tmp_path, **extra):
    data_root = tmp_path / "data"
    monkeypatch.setenv("DASHBOARD_API_KEY", DASHBOARD_KEY)
    monkeypatch.setenv("AGENT_API_KEY", "test-agent-key")
    monkeypatch.setenv("STORE_BACKEND", "fixtures")
    monkeypatch.setenv("KILL_SWITCH_PATH", str(tmp_path / "killswitch"))
    monkeypatch.setenv("INTAKE_STATE_PATH", str(tmp_path / "intake_state.json"))
    monkeypatch.setenv("RESPONSE_ACTIONS_PATH", str(tmp_path / "response_actions.json"))
    monkeypatch.setenv("INCIDENT_TRIAGE_PATH", str(tmp_path / "incident_triage.json"))
    monkeypatch.setenv("DATA_ROOT", str(data_root))
    monkeypatch.setenv("INTAKE_ENABLED", "false")
    monkeypatch.setenv("AGENT_LONG_POLL_SECONDS", "0")
    for key, value in extra.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    return data_root


@pytest.fixture
def env(tmp_path, monkeypatch):
    """Default fixture set, cases.json in a tmp DATA_ROOT, fake clock injected."""
    data_root = _env(monkeypatch, tmp_path)
    clock = FakeClock()
    store = CaseStore(data_root / "cases.json", clock=clock)
    app.dependency_overrides[get_case_store] = lambda: store
    with TestClient(app) as client:
        yield client, store, data_root / "cases.json", tmp_path
    app.dependency_overrides.pop(get_case_store, None)
    get_settings.cache_clear()


@pytest.fixture
def realistic(tmp_path, monkeypatch):
    fixtures_root = tmp_path / "fixtures"
    generate("now", fixtures_root / "realistic")
    data_root = _env(monkeypatch, tmp_path, FIXTURE_SET="realistic", FIXTURE_ROOT=str(fixtures_root))
    with TestClient(app) as client:
        yield client, data_root
    get_settings.cache_clear()


def _body(res):
    assert res.headers["content-type"].startswith("application/json")
    return res.json()


def _types(case: dict) -> list[str]:
    return [e["type"] for e in case["events"]]


# --- virtual default and creation ---


def test_virtual_default_creates_nothing_on_disk(env):
    client, _, path, tmp_path = env
    res = client.get(f"/incidents/{INC}/case", headers=DASH)
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "incident_id": INC, "status": "open", "assignee": None, "verdict": None,
        "resolution_note": None, "resolved_time": None, "updated_time": None,
        "events": [], "version": 0,
    }
    assert client.get("/cases", headers=DASH).json() == []
    assert not path.exists()
    assert not path.parent.exists()


def test_first_mutation_creates_file_with_created_then_own_event(env):
    client, _, path, _ = env
    res = client.post(f"/incidents/{INC}/case/notes", headers=DASH, json={"text": "first look"})
    assert res.status_code == 200
    case = res.json()
    assert _types(case) == ["created", "note_added"]
    assert [e["id"] for e in case["events"]] == ["evt-1", "evt-2"]
    assert case["events"][0]["data"] == {}
    assert case["events"][1]["data"] == {"text": "first look"}
    assert case["version"] == 2
    assert path.exists()
    on_disk = json.loads(path.read_text())
    assert list(on_disk) == [INC]
    assert on_disk[INC] == case
    assert Case(**on_disk[INC]).version == len(on_disk[INC]["events"])


def test_event_times_are_utc_iso_with_milliseconds(env):
    client, _, _, _ = env
    case = client.post(f"/incidents/{INC}/case/notes", headers=DASH, json={"text": "x"}).json()
    for event in case["events"]:
        assert len(event["time"]) == len("2026-10-04T10:00:01.000Z")
        assert event["time"].endswith("Z") and event["time"][19] == "."
    assert case["updated_time"] == case["events"][-1]["time"]
    assert case["events"][0]["time"] == case["events"][1]["time"]  # created + first event share one instant


def test_version_increments_once_per_effective_mutation_not_on_noops(env):
    client, _, _, _ = env
    url = f"/incidents/{INC}/case"
    # no-ops on a virtual case create nothing
    assert client.patch(url, headers=DASH, json={"status": "open"}).json()["version"] == 0
    assert client.patch(url, headers=DASH, json={"assignee": "Unassigned"}).json()["version"] == 0
    assert client.patch(url, headers=DASH, json={}).json()["version"] == 0
    assert client.get("/cases", headers=DASH).json() == []

    v = client.patch(url, headers=DASH, json={"status": "investigating"}).json()
    assert v["version"] == 2  # created + status_changed
    v = client.patch(url, headers=DASH, json={"status": "investigating"}).json()
    assert v["version"] == 2 and len(v["events"]) == 2
    v = client.patch(url, headers=DASH, json={"assignee": "Analyst 1"}).json()
    assert v["version"] == 3
    v = client.patch(url, headers=DASH, json={"assignee": "Analyst 1"}).json()
    assert v["version"] == 3
    v = client.patch(url, headers=DASH, json={"status": "investigating", "assignee": "Analyst 1"}).json()
    assert v["version"] == 3
    # one request, two effective changes: two events, version +2
    v = client.patch(url, headers=DASH, json={"status": "open", "assignee": "Analyst 2"}).json()
    assert v["version"] == 5
    assert _types(v) == ["created", "status_changed", "assignee_changed", "status_changed", "assignee_changed"]


# --- transitions ---


def test_assignee_and_status_events_carry_from_and_to(env):
    client, _, _, _ = env
    url = f"/incidents/{INC}/case"
    client.patch(url, headers=DASH, json={"status": "investigating"})
    case = client.patch(url, headers=DASH, json={"assignee": "Analyst 2"}).json()
    assert case["status"] == "investigating" and case["assignee"] == "Analyst 2"
    assert case["events"][1]["data"] == {"from": "open", "to": "investigating"}
    assert case["events"][2]["data"] == {"from": None, "to": "Analyst 2"}
    case = client.patch(url, headers=DASH, json={"assignee": "Unassigned"}).json()
    assert case["assignee"] is None
    assert case["events"][3]["data"] == {"from": "Analyst 2", "to": None}
    case = client.patch(url, headers=DASH, json={"assignee": None}).json()
    assert case["version"] == 4  # explicit null on an unassigned case is a no-op


def test_patch_cannot_resolve(env):
    client, _, path, _ = env
    res = client.patch(f"/incidents/{INC}/case", headers=DASH, json={"status": "resolved"})
    assert res.status_code == 409
    body = res.json()
    assert "resolve" in body["detail"].lower()
    assert body["case"]["version"] == 0
    assert not path.exists()


def test_resolve_then_resolve_again_is_409(env):
    client, _, _, _ = env
    url = f"/incidents/{INC}/case"
    client.patch(url, headers=DASH, json={"status": "investigating", "assignee": "Analyst 1"})
    res = client.post(f"{url}/resolve", headers=DASH, json={"verdict": "false_positive", "note": "  admin script  "})
    assert res.status_code == 200
    case = res.json()
    assert case["status"] == "resolved"
    assert case["verdict"] == "false_positive"
    assert case["resolution_note"] == "admin script"
    assert case["resolved_time"] == case["updated_time"] == case["events"][-1]["time"]
    assert case["events"][-1]["type"] == "resolved"
    assert case["events"][-1]["data"] == {"verdict": "false_positive", "note": "admin script"}
    assert case["assignee"] == "Analyst 1"

    again = client.post(f"{url}/resolve", headers=DASH, json={"verdict": "true_positive"})
    assert again.status_code == 409
    assert again.json()["case"]["version"] == case["version"]
    assert again.json()["case"]["verdict"] == "false_positive"


def test_resolved_case_rejects_status_patch_but_allows_assignee_and_notes(env):
    client, _, _, _ = env
    url = f"/incidents/{INC}/case"
    client.post(f"{url}/resolve", headers=DASH, json={"verdict": "undetermined"})
    res = client.patch(url, headers=DASH, json={"status": "investigating"})
    assert res.status_code == 409 and "reopen" in res.json()["detail"].lower()
    assert client.patch(url, headers=DASH, json={"assignee": "Analyst 3"}).status_code == 200
    assert client.post(f"{url}/notes", headers=DASH, json={"text": "follow-up"}).status_code == 200
    assert client.get(url, headers=DASH).json()["status"] == "resolved"


def test_resolve_without_note_and_with_blank_note(env):
    client, _, _, _ = env
    case = client.post(f"/incidents/{INC}/case/resolve", headers=DASH, json={"verdict": "benign_activity"}).json()
    assert case["resolution_note"] is None
    assert case["events"][-1]["data"] == {"verdict": "benign_activity", "note": None}
    other = client.post(
        "/incidents/inc-0002/case/resolve", headers=DASH, json={"verdict": "benign_activity", "note": "   "}
    ).json()
    assert other["resolution_note"] is None


def test_resolve_validates_verdict_and_note_length(env):
    client, _, path, _ = env
    url = f"/incidents/{INC}/case/resolve"
    assert client.post(url, headers=DASH, json={"verdict": "maybe"}).status_code == 422
    assert client.post(url, headers=DASH, json={}).status_code == 422
    assert client.post(url, headers=DASH, json={"verdict": "true_positive", "note": "x" * 1001}).status_code == 422
    assert not path.exists()
    ok = client.post(url, headers=DASH, json={"verdict": "true_positive", "note": "x" * 1000})
    assert ok.status_code == 200 and len(ok.json()["resolution_note"]) == 1000


def test_reopen_keeps_audit_trail_and_clears_resolution(env):
    client, _, _, _ = env
    url = f"/incidents/{INC}/case"
    client.post(f"{url}/notes", headers=DASH, json={"text": "n"})
    resolved = client.post(f"{url}/resolve", headers=DASH, json={"verdict": "true_positive", "note": "done"}).json()
    res = client.post(f"{url}/reopen", headers=DASH, json={})
    assert res.status_code == 200
    case = res.json()
    assert case["status"] == "investigating"
    assert case["verdict"] is None and case["resolution_note"] is None and case["resolved_time"] is None
    assert case["events"][: len(resolved["events"])] == resolved["events"]
    assert case["events"][-1]["type"] == "reopened" and case["events"][-1]["data"] == {}
    assert case["version"] == resolved["version"] + 1 == len(case["events"])
    # and it can be resolved again
    assert client.post(f"{url}/resolve", headers=DASH, json={"verdict": "false_positive"}).status_code == 200


def test_reopen_when_not_resolved_is_409(env):
    client, _, path, _ = env
    url = f"/incidents/{INC}/case/reopen"
    res = client.post(url, headers=DASH, json={})
    assert res.status_code == 409 and res.json()["case"]["version"] == 0
    assert not path.exists()  # a refused mutation on a virtual case creates nothing
    assert client.post(url, headers=DASH).status_code == 409  # body is optional
    client.patch(f"/incidents/{INC}/case", headers=DASH, json={"status": "investigating"})
    assert client.post(url, headers=DASH, json={}).status_code == 409


# --- validation ---


def test_assignee_validation(env):
    client, _, path, _ = env
    url = f"/incidents/{INC}/case"
    res = client.patch(url, headers=DASH, json={"assignee": "Mallory"})
    assert res.status_code == 422
    assert not path.exists()
    assert client.patch(url, headers=DASH, json={"assignee": "analyst 1"}).status_code == 422  # exact match
    assert client.patch(url, headers=DASH, json={"assignee": "  Analyst 1  "}).json()["assignee"] == "Analyst 1"
    assert client.patch(url, headers=DASH, json={"assignee": "Unassigned"}).json()["assignee"] is None
    assert client.patch(url, headers=DASH, json={"status": "bogus"}).status_code == 422
    assert client.get("/cases/assignees", headers=DASH).json() == ["Unassigned", "Analyst 1", "Analyst 2", "Analyst 3"]


def test_assignee_list_comes_from_env(tmp_path, monkeypatch):
    data_root = _env(monkeypatch, tmp_path, CASE_ASSIGNEES="Unassigned, Priya ,Sam")
    app.dependency_overrides[get_case_store] = lambda: CaseStore(data_root / "cases.json", clock=FakeClock())
    try:
        with TestClient(app) as client:
            assert client.get("/cases/assignees", headers=DASH).json() == ["Unassigned", "Priya", "Sam"]
            assert client.patch(f"/incidents/{INC}/case", headers=DASH, json={"assignee": "Priya"}).status_code == 200
            assert client.patch(f"/incidents/{INC}/case", headers=DASH, json={"assignee": "Analyst 1"}).status_code == 422
    finally:
        app.dependency_overrides.pop(get_case_store, None)
        get_settings.cache_clear()


def test_actor_header(env):
    client, _, _, _ = env
    url = f"/incidents/{INC}/case/notes"
    case = client.post(url, headers=DASH, json={"text": "a"}).json()
    assert {e["actor"] for e in case["events"]} == {"analyst"}
    case = client.post(url, headers={**DASH, "X-Actor": "  Priya N  "}, json={"text": "b"}).json()
    assert case["events"][-1]["actor"] == "Priya N"
    version = case["version"]
    assert client.post(url, headers={**DASH, "X-Actor": "x" * 64}, json={"text": "c"}).status_code == 200
    for bad in ("x" * 65, "   "):
        res = client.post(url, headers={**DASH, "X-Actor": bad}, json={"text": "d"})
        assert res.status_code == 422, bad
    assert client.get(f"/incidents/{INC}/case", headers=DASH).json()["version"] == version + 1


def test_note_trimming_limits_and_markup_verbatim(env):
    client, _, _, _ = env
    url = f"/incidents/{INC}/case/notes"
    assert client.post(url, headers=DASH, json={"text": "  padded\n"}).json()["events"][-1]["data"]["text"] == "padded"
    for bad in ("", "   ", "\n\t "):
        assert client.post(url, headers=DASH, json={"text": bad}).status_code == 422, repr(bad)
    assert client.post(url, headers=DASH, json={}).status_code == 422
    assert client.post(url, headers=DASH, json={"text": "x" * 2001}).status_code == 422
    assert client.post(url, headers=DASH, json={"text": "x" * 2000}).status_code == 200
    assert client.post(url, headers=DASH, json={"text": f"  {'x' * 2000}  "}).status_code == 200  # limit is after trim

    markup = '<script>alert("x")</script> <img src=x onerror=alert(1)> & <b>bold</b> "quoted" é'
    posted = client.post(url, headers=DASH, json={"text": markup}).json()
    assert posted["events"][-1]["data"]["text"] == markup
    fetched = client.get(f"/incidents/{INC}/case", headers=DASH)
    assert fetched.headers["content-type"].startswith("application/json")
    assert fetched.json()["events"][-1]["data"]["text"] == markup


# --- optimistic concurrency ---


def test_expected_version_mismatch_is_409_and_leaves_file_unchanged(env):
    client, _, path, _ = env
    url = f"/incidents/{INC}/case"
    client.post(f"{url}/notes", headers=DASH, json={"text": "one"})
    before = path.read_bytes()
    stale = 1
    cases = [
        client.patch(url, headers=DASH, json={"status": "investigating", "expected_version": stale}),
        client.post(f"{url}/notes", headers=DASH, json={"text": "two", "expected_version": stale}),
        client.post(f"{url}/resolve", headers=DASH, json={"verdict": "true_positive", "expected_version": stale}),
        client.post(f"{url}/reopen", headers=DASH, json={"expected_version": stale}),
    ]
    for res in cases:
        assert res.status_code == 409
        body = res.json()
        assert "version" in body["detail"].lower()
        assert body["case"]["version"] == 2
    assert path.read_bytes() == before

    ok = client.post(f"{url}/notes", headers=DASH, json={"text": "two", "expected_version": 2})
    assert ok.status_code == 200 and ok.json()["version"] == 3


def test_expected_version_zero_matches_a_virtual_case(env):
    client, _, _, _ = env
    url = f"/incidents/{INC}/case/notes"
    assert client.post(url, headers=DASH, json={"text": "a", "expected_version": 1}).status_code == 409
    assert client.post(url, headers=DASH, json={"text": "a", "expected_version": 0}).status_code == 200


def test_noop_with_matching_version_is_fine_and_with_stale_version_is_409(env):
    client, _, _, _ = env
    url = f"/incidents/{INC}/case"
    client.patch(url, headers=DASH, json={"status": "investigating"})
    assert client.patch(url, headers=DASH, json={"status": "investigating", "expected_version": 2}).status_code == 200
    assert client.patch(url, headers=DASH, json={"status": "investigating", "expected_version": 1}).status_code == 409


# --- 404 and the realistic set ---


@pytest.mark.parametrize("method,path,body", ENDPOINTS)
def test_unknown_incident_is_404_on_every_endpoint(env, method, path, body):
    client, _, case_path, _ = env
    for unknown in ("inc-9999", "inc-1001"):  # inc-1001 only exists in the realistic set
        res = client.request(method, path.format(id=unknown), headers=DASH, json=body)
        assert res.status_code == 404, (unknown, res.text)
    assert not case_path.exists()


def test_realistic_set_knows_inc_1001_and_stores_cases_under_its_data_dir(realistic):
    client, data_root = realistic
    for method, path, body in ENDPOINTS:
        res = client.request(method, path.format(id="inc-0001"), headers=DASH, json=body)
        assert res.status_code == 404, path
    assert client.get("/incidents/inc-1001/case", headers=DASH).json()["version"] == 0
    assert not (data_root / "realistic" / "cases.json").exists()

    res = client.post("/incidents/inc-1001/case/notes", headers=DASH, json={"text": "realistic note"})
    assert res.status_code == 200 and res.json()["version"] == 2
    assert (data_root / "realistic" / "cases.json").exists()
    assert not (data_root / "cases.json").exists()
    listed = client.get("/cases", headers=DASH).json()
    assert [c["incident_id"] for c in listed] == ["inc-1001"]


def test_cases_path_for_default_and_named_sets(tmp_path):
    from backend.app.config import Settings
    from backend.app.store.fixture_set import resolve_cases_path

    assert resolve_cases_path(Settings(data_root=str(tmp_path))) == tmp_path / "cases.json"
    assert resolve_cases_path(Settings(data_root=str(tmp_path), fixture_set="default")) == tmp_path / "cases.json"
    assert resolve_cases_path(Settings(data_root=str(tmp_path), fixture_set="realistic")) == tmp_path / "realistic" / "cases.json"
    with pytest.raises(ValueError):
        resolve_cases_path(Settings(data_root=str(tmp_path), fixture_set="../evil"))


# --- listing ---


def test_list_cases_filters_and_summary_shape(env):
    client, _, _, _ = env
    client.patch("/incidents/inc-0001/case", headers=DASH, json={"status": "investigating", "assignee": "Analyst 1"})
    client.post("/incidents/inc-0002/case/resolve", headers=DASH, json={"verdict": "true_positive"})
    client.post("/incidents/inc-0003/case/notes", headers=DASH, json={"text": "n"})

    everything = client.get("/cases", headers=DASH).json()
    assert [c["incident_id"] for c in everything] == ["inc-0003", "inc-0002", "inc-0001"]  # newest update first
    assert set(everything[0]) == {
        "incident_id", "status", "assignee", "verdict", "updated_time", "resolved_time", "version",
    }
    by_status = {s: [c["incident_id"] for c in client.get(f"/cases?status={s}", headers=DASH).json()]
                 for s in ("open", "investigating", "resolved")}
    assert by_status == {"open": ["inc-0003"], "investigating": ["inc-0001"], "resolved": ["inc-0002"]}
    assert [c["incident_id"] for c in client.get("/cases?assignee=Analyst 1", headers=DASH).json()] == ["inc-0001"]
    assert [c["incident_id"] for c in client.get("/cases?assignee=Unassigned", headers=DASH).json()] == ["inc-0003", "inc-0002"]
    assert client.get("/cases?status=nope", headers=DASH).status_code == 422
    assert client.get("/cases?status=resolved&assignee=Analyst 1", headers=DASH).json() == []


# --- persistence, corruption, atomic writes ---


def test_second_store_instance_sees_the_data(tmp_path):
    path = tmp_path / "cases.json"
    first = CaseStore(path, clock=FakeClock())
    first.add_note("inc-1", actor="a", text="hello")
    second = CaseStore(path, clock=FakeClock())
    case = second.get("inc-1")
    assert case.version == 2 and case.events[1].data == {"text": "hello"}
    second.add_note("inc-1", actor="b", text="again")
    assert first.get("inc-1").version == 3  # the first instance reloads, no stale cache


@pytest.mark.parametrize("content", ["", "{not json", "[]", '{"inc-1": {"status": "weird"}}', '{"inc-1": 5}'])
def test_corrupt_file_loads_empty_and_is_set_aside_on_next_write(tmp_path, caplog, content):
    path = tmp_path / "cases.json"
    path.write_text(content)
    store = CaseStore(path, clock=FakeClock())
    with caplog.at_level("WARNING", logger="csa_ops.cases"):
        assert store.get("inc-1").version == 0
        assert store.list_summaries() == []
    assert "unreadable" in caplog.text
    assert path.read_text() == content  # reading never rewrites

    store.add_note("inc-1", actor="a", text="fresh")
    assert store.get("inc-1").version == 2
    assert (tmp_path / "cases.json.corrupt").read_text() == content


def test_corrupt_file_does_not_break_the_api(env):
    client, _, path, _ = env
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{definitely not json")
    assert client.get("/cases", headers=DASH).json() == []
    assert client.get(f"/incidents/{INC}/case", headers=DASH).json()["version"] == 0


def test_failed_replace_leaves_the_original_intact_and_no_temp_file(tmp_path, monkeypatch):
    path = tmp_path / "cases.json"
    store = CaseStore(path, clock=FakeClock())
    store.add_note("inc-1", actor="a", text="keep me")
    original = path.read_bytes()

    def boom(src, dst):
        raise OSError("disk went away between write and replace")

    monkeypatch.setattr(case_store_module.os, "replace", boom)
    with pytest.raises(OSError):
        store.add_note("inc-1", actor="a", text="never lands")
    monkeypatch.undo()

    assert path.read_bytes() == original
    assert os.listdir(tmp_path) == ["cases.json"]  # the temp file was cleaned up
    assert store.get("inc-1").version == 2  # and no in-memory state leaked ahead of the file


def test_leftover_temp_file_never_replaces_the_real_file(tmp_path):
    path = tmp_path / "cases.json"
    store = CaseStore(path, clock=FakeClock())
    store.add_note("inc-1", actor="a", text="real")
    (tmp_path / "cases.json.zzz.tmp").write_text('{"inc-1": {"incident_id": "inc-1", "version": 99}}')
    assert store.get("inc-1").version == 2
    store.add_note("inc-1", actor="a", text="more")
    assert store.get("inc-1").version == 3


# --- concurrency ---


def test_twenty_concurrent_notes_yield_twenty_one_events_and_version_twenty_one(env):
    client, _, path, _ = env
    url = f"/incidents/{INC}/case/notes"

    def post(i: int) -> int:
        return client.post(url, headers=DASH, json={"text": f"note {i}"}).status_code

    with ThreadPoolExecutor(max_workers=20) as pool:
        statuses = list(pool.map(post, range(20)))
    assert statuses == [200] * 20

    case = client.get(f"/incidents/{INC}/case", headers=DASH).json()
    # 1 created event + 20 note_added events; version always equals the event count
    assert len(case["events"]) == 21
    assert case["version"] == 21
    assert [e["id"] for e in case["events"]] == [f"evt-{n}" for n in range(1, 22)]
    assert _types(case) == ["created"] + ["note_added"] * 20
    assert sorted(e["data"]["text"] for e in case["events"][1:]) == sorted(f"note {i}" for i in range(20))
    assert json.loads(path.read_text())[INC]["version"] == 21


# --- auth ---


@pytest.mark.parametrize(
    "method,path,body",
    ENDPOINTS + [("get", "/cases", None), ("get", "/cases/assignees", None)],
)
def test_auth_matrix(env, method, path, body):
    client, _, case_path, _ = env
    url = path.format(id=INC)
    assert client.request(method, url, json=body).status_code == 401
    assert client.request(method, url, headers={"X-API-Key": "wrong"}, json=body).status_code == 403
    assert client.request(method, url, headers={"X-API-Key": "test-agent-key"}, json=body).status_code == 403
    assert not case_path.exists()


# --- contract: cases never touch detection, triage or response data ---


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_case_activity_leaves_alerts_incidents_triage_and_response_files_byte_identical(env):
    client, _, case_path, tmp_path = env
    triage = tmp_path / "incident_triage.json"
    actions = tmp_path / "response_actions.json"
    triage.write_text(json.dumps({"inc-0003": {"incident_id": "inc-0003", "verdict": "needs_review", "status": "ok"}}))
    actions.write_text("[]")
    protected = [
        REPO_ROOT / "fixtures" / "alerts.json",
        REPO_ROOT / "fixtures" / "incidents.json",
        triage,
        actions,
    ]
    before = {p: _sha(p) for p in protected}
    incident_before = client.get(f"/incidents/{INC}", headers=DASH).json()

    url = f"/incidents/{INC}/case"
    assert client.patch(url, headers=DASH, json={"status": "investigating", "assignee": "Analyst 2"}).status_code == 200
    assert client.post(f"{url}/notes", headers=DASH, json={"text": "looked at the chain"}).status_code == 200
    assert client.post(f"{url}/resolve", headers=DASH, json={"verdict": "true_positive", "note": "confirmed"}).status_code == 200
    assert client.post(f"{url}/reopen", headers=DASH, json={}).status_code == 200
    assert client.post(f"{url}/resolve", headers=DASH, json={"verdict": "false_positive"}).status_code == 200
    assert case_path.exists()

    assert {p: _sha(p) for p in protected} == before
    assert sorted(p.name for p in tmp_path.iterdir() if p.is_file()) == ["incident_triage.json", "response_actions.json"]
    # the incident as the rest of the API serves it is unchanged too
    assert client.get(f"/incidents/{INC}", headers=DASH).json() == incident_before
    assert client.get("/response/actions", headers=DASH).json() == []
