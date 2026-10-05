"""Operational adversarial checks for GET /incidents/{id}/report: no stale
caching across repeated calls, and immediate consistency with a just-written
AI explanation."""
import time

from backend.app.routers import ai as ai_router
from engine.ai_explain.schemas import Explain

from .conftest import DASHBOARD_KEY

DASH = {"X-API-Key": DASHBOARD_KEY}


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


# 11. Exporting the same incident twice, a few seconds apart, must produce
# two independently-fresh reports -- nothing cached or memoized at the
# router/builder level.
def test_exporting_same_incident_twice_produces_fresh_timestamps(client):
    r1 = client.get("/incidents/inc-0003/report", headers=DASH)
    time.sleep(1.2)
    r2 = client.get("/incidents/inc-0003/report", headers=DASH)

    assert r1.status_code == 200 and r2.status_code == 200

    footer1 = [l for l in r1.text.splitlines() if "Report generated" in l][0]
    footer2 = [l for l in r2.text.splitlines() if "Report generated" in l][0]
    assert footer1 != footer2, "footer timestamp did not advance between calls -- looks cached"

    disposition1 = r1.headers["content-disposition"]
    disposition2 = r2.headers["content-disposition"]
    # Same incident, same day -> filename is expected to match (daily
    # granularity is intentional); it's the footer that must prove freshness.
    assert "inc-0003" in disposition1 and "inc-0003" in disposition2


# 12. Export immediately after a fresh POST /ai/explain/{id} must reflect
# that new explanation, not a stale/raced version of it.
def test_report_reflects_explain_generated_moments_before(client, monkeypatch):
    _save_ok_triage(client)

    def fake_explain_incident(incident, triage, response_actions):
        return Explain(
            summary="UNIQUE-MARKER-this-is-the-freshly-generated-explanation",
            objective="o", notable_details=[], next_steps=[], caveats=[],
            generated_time="2026-09-13T10:17:00.000Z",
        )

    monkeypatch.setattr(ai_router.ai_explain, "explain_incident", fake_explain_incident)

    post_resp = client.post("/ai/explain/inc-0003", headers=DASH)
    assert post_resp.status_code == 200

    report_resp = client.get("/incidents/inc-0003/report", headers=DASH)
    assert report_resp.status_code == 200
    assert "UNIQUE-MARKER-this-is-the-freshly-generated-explanation" in report_resp.text
