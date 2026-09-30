from backend.app.routers import ai as ai_router
from engine.ai_explain import prompts
from engine.ai_explain.schemas import Explain

from .conftest import AGENT_KEY, DASHBOARD_KEY

DASH = {"X-API-Key": DASHBOARD_KEY}
AGENT = {"X-API-Key": AGENT_KEY}


def _save_ok_triage(client, incident_id="inc-0003"):
    store = client.app.state.store
    store.save_triage({
        "incident_id": incident_id,
        "triage_time": "2026-09-13T10:16:00.000Z",
        "verdict": "true_positive",
        "confidence": "high",
        "reason": "clear LSASS memory dump via rundll32",
        "model": "openai/deepseek-chat",
        "status": "ok",
        "explain": None,
    })


def test_get_triage_requires_dashboard_key(client):
    assert client.get("/ai/triage/inc-0003").status_code == 401
    assert client.get("/ai/triage/inc-0003", headers=AGENT).status_code == 403


def test_post_explain_requires_dashboard_key(client):
    assert client.post("/ai/explain/inc-0003").status_code == 401
    assert client.post("/ai/explain/inc-0003", headers=AGENT).status_code == 403


def test_get_triage_404_for_unknown_incident(client):
    r = client.get("/ai/triage/does-not-exist", headers=DASH)
    assert r.status_code == 404


def test_get_triage_404_when_incident_exists_but_untriaged(client):
    r = client.get("/ai/triage/inc-0003", headers=DASH)
    assert r.status_code == 404


def test_get_triage_returns_saved_doc(client):
    _save_ok_triage(client)
    r = client.get("/ai/triage/inc-0003", headers=DASH)
    assert r.status_code == 200
    assert r.json()["verdict"] == "true_positive"


def test_post_explain_404_for_unknown_incident(client):
    r = client.post("/ai/explain/does-not-exist", headers=DASH)
    assert r.status_code == 404


def test_post_explain_409_when_not_yet_triaged(client):
    r = client.post("/ai/explain/inc-0003", headers=DASH)
    assert r.status_code == 409


def test_post_explain_409_when_triage_failed(client, monkeypatch):
    # Regression: only the dashboard UI gated the Explain button on
    # triage.status == "ok"; the endpoint itself did not, so a direct API
    # call against a failed triage (verdict/confidence/reason all null)
    # would proceed to call the LLM and persist a fabricated explanation.
    store = client.app.state.store
    store.save_triage({
        "incident_id": "inc-0003", "triage_time": "2026-09-13T10:16:00.000Z",
        "verdict": None, "confidence": None, "reason": None,
        "model": "openai/deepseek-chat", "status": "failed", "explain": None,
    })

    def fail_if_called(incident, triage, response_actions):
        raise AssertionError("explain_incident must not be called when triage failed")

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", fail_if_called)

    r = client.post("/ai/explain/inc-0003", headers=DASH)
    assert r.status_code == 409


def test_post_explain_calls_explain_incident_and_persists_result(client, monkeypatch):
    _save_ok_triage(client)

    called = {}

    def fake_explain_incident(incident, triage, response_actions):
        called["incident_id"] = incident["incident_id"]
        called["triage_verdict"] = triage["verdict"]
        called["response_actions"] = response_actions
        return Explain(
            summary="Credential dumping via rundll32/comsvcs.dll targeting LSASS.",
            objective="Extract credentials from memory for lateral movement.",
            notable_details=["rundll32.exe spawned by encoded PowerShell"],
            next_steps=["Rotate credentials for the affected user"],
            caveats=["Command-line data may be incomplete upstream"],
            generated_time="2026-09-13T10:17:00.000Z",
        )

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", fake_explain_incident)

    r = client.post("/ai/explain/inc-0003", headers=DASH)
    assert r.status_code == 200
    body = r.json()
    assert body["explain"]["summary"].startswith("Credential dumping")
    assert called["incident_id"] == "inc-0003"
    assert called["triage_verdict"] == "true_positive"
    assert called["response_actions"] == []  # no response actions issued for inc-0003 in this test

    # Persisted onto the triage doc.
    r2 = client.get("/ai/triage/inc-0003", headers=DASH)
    assert r2.json()["explain"]["summary"].startswith("Credential dumping")


def test_post_explain_passes_existing_response_actions(client, monkeypatch):
    # Regression: explain had no visibility into response history at all --
    # the router must fetch it from the store and hand it to explain_incident.
    _save_ok_triage(client)
    r = client.post(
        "/response/actions", headers=DASH,
        json={"incident_id": "inc-0003", "action": "log", "target": {}},
    )
    assert r.status_code == 200

    captured = {}

    def fake_explain_incident(incident, triage, response_actions):
        captured["response_actions"] = response_actions
        return Explain(
            summary="s", objective="o", notable_details=[], next_steps=[], caveats=[],
            generated_time="2026-09-13T10:17:00.000Z",
        )

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", fake_explain_incident)

    client.post("/ai/explain/inc-0003", headers=DASH)

    assert len(captured["response_actions"]) == 1
    assert captured["response_actions"][0]["action"] == "log"


def test_post_explain_second_call_is_cached_not_recomputed(client, monkeypatch):
    _save_ok_triage(client)

    calls = {"n": 0}

    def fake_explain_incident(incident, triage, response_actions):
        calls["n"] += 1
        return Explain(
            summary="s", objective="o", notable_details=[], next_steps=[], caveats=[],
            generated_time="2026-09-13T10:17:00.000Z",
        )

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", fake_explain_incident)

    client.post("/ai/explain/inc-0003", headers=DASH)
    client.post("/ai/explain/inc-0003", headers=DASH)

    assert calls["n"] == 1


def _save_stale_explain(client, incident_id="inc-0003"):
    """A cached explain with no prompt_version at all -- the exact shape of
    the real pre-existing fixture (data/incident_triage.json's inc-0003)
    that motivated this fix."""
    store = client.app.state.store
    store.save_triage({
        "incident_id": incident_id, "triage_time": "2026-09-13T10:16:00.000Z",
        "verdict": "true_positive", "confidence": "high", "reason": "clear LSASS memory dump",
        "model": "openai/deepseek-chat", "status": "ok",
        "explain": {
            "summary": "old", "objective": "old", "notable_details": [], "next_steps": [], "caveats": [],
            "generated_time": "2026-09-13T10:17:00.000Z",
        },
    })


def test_get_triage_marks_a_pre_versioning_cached_explain_as_stale(client):
    _save_stale_explain(client)
    r = client.get("/ai/triage/inc-0003", headers=DASH)
    assert r.json()["explain"]["is_stale"] is True


def test_post_explain_returns_stale_cached_explain_without_recomputing(client, monkeypatch):
    _save_stale_explain(client)

    def fail_if_called(incident, triage, response_actions):
        raise AssertionError("a plain POST must never recompute, even when the cached explain is stale")

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", fail_if_called)

    r = client.post("/ai/explain/inc-0003", headers=DASH)
    assert r.status_code == 200
    assert r.json()["explain"]["summary"] == "old"
    assert r.json()["explain"]["is_stale"] is True


def test_post_explain_force_true_recomputes_a_stale_cached_explain(client, monkeypatch):
    _save_stale_explain(client)

    def fake_explain_incident(incident, triage, response_actions):
        return Explain(
            summary="fresh", objective="o", notable_details=[], next_steps=[], caveats=[],
            generated_time="2026-09-28T00:00:00.000Z", prompt_version=prompts.EXPLAIN_PROMPT_VERSION,
        )

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", fake_explain_incident)

    r = client.post("/ai/explain/inc-0003?force=true", headers=DASH)
    assert r.status_code == 200
    assert r.json()["explain"]["summary"] == "fresh"
    assert r.json()["explain"]["is_stale"] is False


def test_post_explain_502_when_llm_call_fails(client, monkeypatch):
    _save_ok_triage(client)

    def failing_explain_incident(incident, triage, response_actions):
        raise RuntimeError("LLM unreachable")

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", failing_explain_incident)

    r = client.post("/ai/explain/inc-0003", headers=DASH)
    assert r.status_code == 502
