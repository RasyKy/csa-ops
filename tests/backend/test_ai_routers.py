from backend.app.routers import ai as ai_router
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

    def fail_if_called(incident, triage):
        raise AssertionError("explain_incident must not be called when triage failed")

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", fail_if_called)

    r = client.post("/ai/explain/inc-0003", headers=DASH)
    assert r.status_code == 409


def test_post_explain_calls_explain_incident_and_persists_result(client, monkeypatch):
    _save_ok_triage(client)

    called = {}

    def fake_explain_incident(incident, triage):
        called["incident_id"] = incident["incident_id"]
        called["triage_verdict"] = triage["verdict"]
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

    # Persisted onto the triage doc.
    r2 = client.get("/ai/triage/inc-0003", headers=DASH)
    assert r2.json()["explain"]["summary"].startswith("Credential dumping")


def test_post_explain_second_call_is_cached_not_recomputed(client, monkeypatch):
    _save_ok_triage(client)

    calls = {"n": 0}

    def fake_explain_incident(incident, triage):
        calls["n"] += 1
        return Explain(
            summary="s", objective="o", notable_details=[], next_steps=[], caveats=[],
            generated_time="2026-09-13T10:17:00.000Z",
        )

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", fake_explain_incident)

    client.post("/ai/explain/inc-0003", headers=DASH)
    client.post("/ai/explain/inc-0003", headers=DASH)

    assert calls["n"] == 1


def test_post_explain_502_when_llm_call_fails(client, monkeypatch):
    _save_ok_triage(client)

    def failing_explain_incident(incident, triage):
        raise RuntimeError("LLM unreachable")

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", failing_explain_incident)

    r = client.post("/ai/explain/inc-0003", headers=DASH)
    assert r.status_code == 502
