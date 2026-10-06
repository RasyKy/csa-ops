"""Case metrics: pure functions and GET /metrics/cases.

Pure tests use hand-built dicts. Endpoint tests run the in-process TestClient
with DATA_ROOT and every runtime path in a tmp dir, so nothing is written under
the repo's data/ or fixtures/."""
import json
from datetime import datetime, timedelta, timezone
from itertools import product
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import get_settings
from backend.app.main import app
from backend.app.models.case import CaseStatus, Verdict
from backend.app.routers import metrics as metrics_router
from backend.app.store import get_case_store
from backend.metrics import case_metrics as cm

DASHBOARD_KEY = "test-dashboard-key"
DASH = {"X-API-Key": DASHBOARD_KEY}


# ---------------------------------------------------------------------------
# helpers


def inc(incident_id, alert_ids=()):
    return {"incident_id": incident_id, "alert_ids": list(alert_ids)}


def resolved_case(incident_id, verdict):
    return {"incident_id": incident_id, "status": "resolved", "verdict": verdict, "events": []}


def triage(verdict, status="ok"):
    return {"verdict": verdict, "status": status}


def event(kind, time, **data):
    return {"id": "e", "time": time, "actor": "A", "type": kind, "data": data}


def t(seconds):
    base = datetime(2026, 10, 4, 10, 0, 0, tzinfo=timezone.utc)
    return (base + timedelta(seconds=seconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# sides


@pytest.mark.parametrize(
    "verdict, side",
    [("true_positive", "malicious"), ("likely_true_positive", "malicious"), ("false_positive", "benign"),
     ("likely_false_positive", "benign"), ("needs_review", "uncertain"), (None, None), ("", None),
     ("benign_activity", None), ("something_else", None), (5, None), ({}, None)],
)
def test_side_of_ai(verdict, side):
    assert cm.side_of_ai(verdict) == side


@pytest.mark.parametrize(
    "verdict, side",
    [("true_positive", "malicious"), ("false_positive", "benign"), ("benign_activity", "benign"),
     ("undetermined", None), (None, None), ("likely_true_positive", None), ("needs_review", None), (3, None)],
)
def test_side_of_analyst(verdict, side):
    assert cm.side_of_analyst(verdict) == side


# ---------------------------------------------------------------------------
# AI agreement


AI_VERDICTS = ["true_positive", "likely_true_positive", "false_positive", "likely_false_positive", "needs_review"]
ANALYST_VERDICTS = ["true_positive", "false_positive", "benign_activity", "undetermined"]


def expected_bucket(ai_verdict, analyst_verdict):
    analyst = cm.side_of_analyst(analyst_verdict)
    ai = cm.side_of_ai(ai_verdict)
    if analyst is None:
        return "unscored"
    if ai == "uncertain":
        return "ai_uncertain"
    return "agree" if ai == analyst else "disagree"


@pytest.mark.parametrize("ai_verdict, analyst_verdict", list(product(AI_VERDICTS, ANALYST_VERDICTS)))
def test_agreement_for_every_combination(ai_verdict, analyst_verdict):
    result = cm.compute_ai_agreement(
        [inc("a")], {"a": triage(ai_verdict)}, {"a": resolved_case("a", analyst_verdict)}
    )
    bucket = expected_bucket(ai_verdict, analyst_verdict)
    assert result["resolved_total"] == 1
    assert result["scored"] == (1 if bucket in ("agree", "disagree") else 0)
    assert result["agree"] == (1 if bucket == "agree" else 0)
    assert result["disagree"] == (1 if bucket == "disagree" else 0)
    assert result["ai_uncertain"] == (1 if bucket == "ai_uncertain" else 0)
    assert result["unscored"] == (1 if bucket == "unscored" else 0)
    assert sum(result["confusion"].values()) == result["scored"]


def test_the_four_confusion_cells():
    incidents = [inc(x) for x in "abcd"]
    triage_by_id = {"a": triage("true_positive"), "b": triage("likely_true_positive"),
                    "c": triage("likely_false_positive"), "d": triage("false_positive")}
    cases = {"a": resolved_case("a", "true_positive"), "b": resolved_case("b", "false_positive"),
             "c": resolved_case("c", "true_positive"), "d": resolved_case("d", "benign_activity")}
    result = cm.compute_ai_agreement(incidents, triage_by_id, cases)
    assert result["confusion"] == {
        "ai_malicious_analyst_malicious": 1,
        "ai_malicious_analyst_benign": 1,
        "ai_benign_analyst_malicious": 1,
        "ai_benign_analyst_benign": 1,
    }
    assert (result["agree"], result["disagree"], result["scored"]) == (2, 2, 4)


def test_missing_failed_and_verdictless_triage_are_unscored():
    incidents = [inc(x) for x in ("none", "failed", "noverdict", "weird", "notadict")]
    cases = {i["incident_id"]: resolved_case(i["incident_id"], "true_positive") for i in incidents}
    triage_by_id = {
        "failed": triage("true_positive", status="failed"),
        "noverdict": {"status": "ok"},
        "weird": triage("not_a_verdict"),
        "notadict": "garbage",
    }
    result = cm.compute_ai_agreement(incidents, triage_by_id, cases)
    assert result["resolved_total"] == 5 and result["unscored"] == 5
    assert result["scored"] == result["agree"] == result["disagree"] == result["ai_uncertain"] == 0


def test_only_resolved_cases_count():
    incidents = [inc(x) for x in ("resolved", "reopened", "open", "investigating", "nocase")]
    cases = {
        "resolved": resolved_case("resolved", "true_positive"),
        # a reopened case is investigating again and keeps no verdict
        "reopened": {"incident_id": "reopened", "status": "investigating", "verdict": None, "events": []},
        "open": {"incident_id": "open", "status": "open", "verdict": None},
        "investigating": {"incident_id": "investigating", "status": "investigating", "verdict": "true_positive"},
    }
    triage_by_id = {i["incident_id"]: triage("true_positive") for i in incidents}
    result = cm.compute_ai_agreement(incidents, triage_by_id, cases)
    assert result["resolved_total"] == 1 and result["agree"] == 1


def test_every_resolved_case_lands_in_exactly_one_bucket():
    combos = list(product(AI_VERDICTS + [None], ANALYST_VERDICTS))
    incidents = [inc(f"i{n}") for n in range(len(combos))]
    triage_by_id = {f"i{n}": triage(ai) for n, (ai, _) in enumerate(combos) if ai}
    cases = {f"i{n}": resolved_case(f"i{n}", analyst) for n, (_, analyst) in enumerate(combos)}
    r = cm.compute_ai_agreement(incidents, triage_by_id, cases)
    assert r["resolved_total"] == len(combos)
    assert r["scored"] + r["ai_uncertain"] + r["unscored"] == r["resolved_total"]
    assert r["agree"] + r["disagree"] == r["scored"]


def test_agreement_with_nothing_resolved():
    r = cm.compute_ai_agreement([inc("a")], {}, {})
    assert r["resolved_total"] == 0 and sum(r["confusion"].values()) == 0
    assert set(r["confusion"]) == {
        "ai_malicious_analyst_malicious", "ai_malicious_analyst_benign",
        "ai_benign_analyst_malicious", "ai_benign_analyst_benign",
    }
    # garbage in, no exception out
    cm.compute_ai_agreement(None, None, None)
    cm.compute_ai_agreement([None, 5, {}], {"a": 1}, {"a": "x"})


# ---------------------------------------------------------------------------
# status counts


def test_status_counts_with_and_without_cases():
    incidents = [inc(x) for x in ("a", "b", "c", "d", "e")]
    assert cm.compute_status_counts(incidents, {}) == {"open": 5, "investigating": 0, "resolved": 0}
    cases = {
        "a": {"status": "investigating"}, "b": {"status": "resolved"}, "c": {"status": "open"},
        "d": {"status": "on_hold"},  # unknown reads as open, like the dashboard
    }
    assert cm.compute_status_counts(incidents, cases) == {"open": 3, "investigating": 1, "resolved": 1}
    assert cm.compute_status_counts([], cases) == {"open": 0, "investigating": 0, "resolved": 0}
    # a case for an incident that is not in the list is ignored
    assert cm.compute_status_counts([inc("a")], {"zzz": {"status": "resolved"}}) == {
        "open": 1, "investigating": 0, "resolved": 0,
    }


# ---------------------------------------------------------------------------
# resolve times


def timed_case(*events, status="resolved"):
    return {"status": status, "events": list(events)}


def test_one_resolved_case():
    case = timed_case(event("created", t(0)), event("resolved", t(90), verdict="true_positive"))
    r = cm.compute_resolve_times({"a": case}, ["a"])
    assert r == {"count": 1, "median_seconds": 90.0, "p90_seconds": 90.0, "values_seconds": [90.0]}


def test_odd_and_even_counts():
    def case(seconds):
        return timed_case(event("created", t(0)), event("resolved", t(seconds)))

    cases = {k: case(v) for k, v in {"a": 10, "b": 30, "c": 20, "d": 40, "e": 50}.items()}
    odd = cm.compute_resolve_times(cases, ["a", "b", "c"])
    assert odd["median_seconds"] == 20 and odd["values_seconds"] == [10, 20, 30]
    even = cm.compute_resolve_times(cases, ["a", "b", "c", "d"])
    assert even["median_seconds"] == 25  # mean of the middle two
    assert even["p90_seconds"] == pytest.approx(37)  # linear interpolation, like the other p90 values
    assert cm.compute_resolve_times(cases, ["a", "b", "c", "d", "e"])["median_seconds"] == 30


def test_reopened_then_resolved_again_uses_the_last_resolved_event():
    case = timed_case(
        event("created", t(0)),
        event("resolved", t(60), verdict="true_positive"),
        event("reopened", t(120)),
        event("resolved", t(300), verdict="false_positive"),
    )
    assert cm.compute_resolve_times({"a": case}, ["a"])["values_seconds"] == [300.0]


def test_a_case_that_is_reopened_and_still_open_is_not_counted():
    case = timed_case(event("created", t(0)), event("resolved", t(60)), event("reopened", t(120)), status="investigating")
    assert cm.compute_resolve_times({"a": case}, ["a"])["count"] == 0


def test_unparseable_missing_and_backwards_times_are_skipped():
    good = timed_case(event("created", t(0)), event("resolved", t(100)))
    bad = {
        "bad_start": timed_case(event("created", "not a time"), event("resolved", t(10))),
        "bad_end": timed_case(event("created", t(0)), event("resolved", "nope")),
        "no_time": timed_case({"type": "created"}, event("resolved", t(10))),
        "no_resolved_event": timed_case(event("created", t(0)), event("note_added", t(10))),
        "no_events": timed_case(),
        "events_not_a_list": {"status": "resolved", "events": "x"},
        "backwards": timed_case(event("created", t(100)), event("resolved", t(10))),
        "number_time": timed_case(event("created", 5), event("resolved", t(10))),
    }
    cases = {"good": good, **bad}
    r = cm.compute_resolve_times(cases, list(cases))
    assert r["count"] == 1 and r["values_seconds"] == [100.0]


def test_resolve_times_empty_and_filtering_by_incident_ids():
    assert cm.compute_resolve_times({}, []) == {
        "count": 0, "median_seconds": None, "p90_seconds": None, "values_seconds": None,
    }
    case = timed_case(event("created", t(0)), event("resolved", t(5)))
    assert cm.compute_resolve_times({"a": case}, ["other"])["count"] == 0
    assert cm.compute_resolve_times({"a": case}, ["a", "a-missing"])["count"] == 1
    cm.compute_resolve_times(None, None)


# ---------------------------------------------------------------------------
# verdicts by rule

ALERTS = [
    {"alert_id": "a1", "rule_id": "R1"}, {"alert_id": "a2", "rule_id": "R2"},
    {"alert_id": "a3", "rule_id": "R1"}, {"alert_id": "a4", "rule_id": "R1"},
    {"alert_id": "a5", "rule_id": "R3"},
]


def test_verdicts_by_rule_counts_every_alert_of_a_resolved_incident():
    incidents = [
        inc("i1", ["a1", "a2"]),       # resolved true positive
        inc("i2", ["a3", "a4"]),       # resolved false positive: two alerts of one rule
        inc("i3", ["a1"]),             # still investigating: not counted
        inc("i4", ["a5", "missing"]),  # resolved undetermined; an unknown alert id is skipped
        inc("i5", ["a2", "a2"]),       # resolved benign; a repeated id counts once
    ]
    cases = {
        "i1": resolved_case("i1", "true_positive"), "i2": resolved_case("i2", "false_positive"),
        "i3": {"status": "investigating"}, "i4": resolved_case("i4", "undetermined"),
        "i5": resolved_case("i5", "benign_activity"),
    }
    r = cm.compute_verdicts_by_rule(ALERTS, incidents, cases)
    assert r == {
        "R1": {"true_positive": 1, "false_positive": 2, "benign_activity": 0, "undetermined": 0, "total": 3},
        "R2": {"true_positive": 1, "false_positive": 0, "benign_activity": 1, "undetermined": 0, "total": 2},
        "R3": {"true_positive": 0, "false_positive": 0, "benign_activity": 0, "undetermined": 1, "total": 1},
    }
    for row in r.values():
        assert row["total"] == row["true_positive"] + row["false_positive"] + row["benign_activity"] + row["undetermined"]


def test_verdicts_by_rule_empty_cases():
    assert cm.compute_verdicts_by_rule(ALERTS, [inc("i1", ["a1"])], {}) == {}
    assert cm.compute_verdicts_by_rule([], [inc("i1", ["a1"])], {"i1": resolved_case("i1", "true_positive")}) == {}
    cm.compute_verdicts_by_rule(None, None, None)
    cm.compute_verdicts_by_rule([{"alert_id": 1}, 5], [{"incident_id": "i", "alert_ids": 5}, 7], {"i": 1})


# ---------------------------------------------------------------------------
# the endpoint


@pytest.fixture
def case_client(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHBOARD_API_KEY", DASHBOARD_KEY)
    monkeypatch.setenv("AGENT_API_KEY", "test-agent-key")
    monkeypatch.setenv("STORE_BACKEND", "fixtures")
    monkeypatch.setenv("KILL_SWITCH_PATH", str(tmp_path / "killswitch"))
    monkeypatch.setenv("INTAKE_STATE_PATH", str(tmp_path / "intake_state.json"))
    monkeypatch.setenv("RESPONSE_ACTIONS_PATH", str(tmp_path / "response_actions.json"))
    monkeypatch.setenv("INCIDENT_TRIAGE_PATH", str(tmp_path / "incident_triage.json"))
    monkeypatch.setenv("DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv("INTAKE_ENABLED", "false")
    monkeypatch.setenv("AGENT_LONG_POLL_SECONDS", "0")
    get_settings.cache_clear()
    with TestClient(app) as client:
        yield client
    get_settings.cache_clear()


def cases_file(tmp_path) -> Path:
    return tmp_path / "data" / "cases.json"


def save_triage(client, incident_id, verdict, status="ok"):
    client.app.state.store.save_triage({
        "incident_id": incident_id, "triage_time": "2026-09-13T10:16:00.000Z", "verdict": verdict,
        "confidence": "high", "reason": "test", "model": "test/model", "status": status, "explain": None,
    })


def seed_triage(client):
    for incident_id, verdict in [("inc-0001", "likely_false_positive"), ("inc-0002", "likely_true_positive"),
                                 ("inc-0003", "true_positive"), ("inc-0004", "needs_review"),
                                 ("inc-0005", "likely_true_positive")]:
        save_triage(client, incident_id, verdict)


def seed_cases():
    store = get_case_store()
    store.resolve("inc-0001", actor="A", verdict=Verdict.false_positive)
    store.resolve("inc-0003", actor="A", verdict=Verdict.true_positive, note="confirmed")
    store.resolve("inc-0005", actor="A", verdict=Verdict.false_positive)
    store.resolve("inc-0002", actor="A", verdict=Verdict.undetermined)
    store.update("inc-0004", actor="A", status=CaseStatus.investigating)


def seed(client):
    """inc-0001 FP (AI likely FP: agree), inc-0003 TP (AI TP: agree), inc-0005 FP (AI likely TP: disagree),
    inc-0002 undetermined (not scored), inc-0004 investigating."""
    seed_triage(client)
    seed_cases()


def get(client, query="?range=all"):
    res = client.get(f"/metrics/cases{query}", headers=DASH)
    assert res.status_code == 200, res.text
    return res.json()


def test_shape_with_no_cases(case_client, tmp_path):
    body = get(case_client)
    assert set(body) == {"range", "since", "as_of", "status_counts", "ai_agreement", "resolve_time", "verdicts_by_rule"}
    assert body["range"] == "all" and body["since"] is None
    assert body["status_counts"] == {"value": {"open": 5, "investigating": 0, "resolved": 0}, "status": "ok"}
    assert body["ai_agreement"]["status"] == "no_data" and body["ai_agreement"]["value"]["resolved_total"] == 0
    assert body["resolve_time"]["status"] == "no_data" and body["resolve_time"]["value"]["count"] == 0
    assert body["verdicts_by_rule"] == {"value": {}, "status": "no_data"}
    for key in ("status_counts", "ai_agreement", "resolve_time", "verdicts_by_rule"):
        assert set(body[key]) == {"value", "status"}
    assert not cases_file(tmp_path).exists(), "reading metrics must not create cases.json"


def test_values_with_cases(case_client):
    seed(case_client)
    body = get(case_client)
    assert body["status_counts"]["value"] == {"open": 0, "investigating": 1, "resolved": 4}

    agreement = body["ai_agreement"]
    assert agreement["status"] == "ok"
    assert agreement["value"] == {
        "resolved_total": 4, "scored": 3, "agree": 2, "disagree": 1, "ai_uncertain": 0, "unscored": 1,
        "confusion": {
            "ai_malicious_analyst_malicious": 1, "ai_malicious_analyst_benign": 1,
            "ai_benign_analyst_malicious": 0, "ai_benign_analyst_benign": 1,
        },
    }

    resolve = body["resolve_time"]
    assert resolve["status"] == "ok" and resolve["value"]["count"] == 4
    assert resolve["value"]["median_seconds"] >= 0
    assert len(resolve["value"]["values_seconds"]) == 4

    by_rule = body["verdicts_by_rule"]
    assert by_rule["status"] == "ok"
    assert by_rule["value"]["T1059.001_encoded_powershell"] == {
        "true_positive": 1, "false_positive": 0, "benign_activity": 0, "undetermined": 1, "total": 2,
    }
    assert by_rule["value"]["T1012_registry_query"]["false_positive"] == 1
    assert by_rule["value"]["T1046_port_scan"]["false_positive"] == 1
    assert "T1047_wmi_lateral_movement" not in by_rule["value"]  # inc-0004 is not resolved


def test_a_reopened_case_leaves_the_agreement(case_client):
    seed(case_client)
    get_case_store().reopen("inc-0003", actor="A")
    body = get(case_client)
    assert body["ai_agreement"]["value"]["resolved_total"] == 3
    assert body["status_counts"]["value"] == {"open": 0, "investigating": 2, "resolved": 3}


def test_range_filters_by_incident_raised_time(case_client, monkeypatch):
    seed(case_client)
    # Fixture incidents: 0005 Aug 1, 0001 Sep 10, 0002 Sep 11, 0004 Sep 12, 0003 Sep 13.
    monkeypatch.setattr(
        metrics_router, "_since_for_range", lambda r: None if r == "all" else "2026-09-11T00:00:00.000Z"
    )
    narrow = get(case_client, "?range=30d")
    assert narrow["since"] == "2026-09-11T00:00:00.000Z"
    assert sum(narrow["status_counts"]["value"].values()) == 3  # 0002, 0003, 0004
    assert narrow["ai_agreement"]["value"]["resolved_total"] == 2  # 0002 and 0003
    assert "T1046_port_scan" not in narrow["verdicts_by_rule"]["value"]  # inc-0005 is out of range
    assert sum(get(case_client, "?range=all")["status_counts"]["value"].values()) == 5


def test_a_range_with_no_incidents_is_all_no_data(case_client, monkeypatch):
    seed(case_client)
    monkeypatch.setattr(metrics_router, "_since_for_range", lambda r: "2030-01-01T00:00:00.000Z")
    body = get(case_client, "?range=24h")
    assert body["status_counts"]["status"] == "no_data"
    assert body["ai_agreement"]["status"] == "no_data" and body["ai_agreement"]["value"]["resolved_total"] == 0
    assert body["resolve_time"]["status"] == "no_data"
    assert body["verdicts_by_rule"]["status"] == "no_data"


def test_no_resolved_case_is_no_data_but_counts_stay_ok(case_client):
    get_case_store().update("inc-0001", actor="A", status=CaseStatus.investigating)
    body = get(case_client)
    assert body["status_counts"] == {"value": {"open": 4, "investigating": 1, "resolved": 0}, "status": "ok"}
    assert body["ai_agreement"]["status"] == body["resolve_time"]["status"] == body["verdicts_by_rule"]["status"] == "no_data"


def test_default_range_is_7d(case_client):
    assert get(case_client, "")["range"] == "7d"


def test_auth(case_client):
    assert case_client.get("/metrics/cases").status_code == 401
    assert case_client.get("/metrics/cases", headers={"X-API-Key": "wrong"}).status_code == 403
    assert case_client.get("/metrics/cases", headers={"X-API-Key": "test-agent-key"}).status_code == 403


def test_a_corrupt_cases_file_reads_as_no_cases(case_client, tmp_path):
    cases_file(tmp_path).parent.mkdir(parents=True, exist_ok=True)
    cases_file(tmp_path).write_text("{ nope", encoding="utf-8")
    body = get(case_client)
    assert body["status_counts"]["value"] == {"open": 5, "investigating": 0, "resolved": 0}
    assert body["ai_agreement"]["status"] == "no_data"
    assert cases_file(tmp_path).read_text(encoding="utf-8") == "{ nope"


def test_the_endpoint_never_writes_the_cases_file(case_client, tmp_path):
    seed(case_client)
    before = cases_file(tmp_path).read_bytes()
    mtime = cases_file(tmp_path).stat().st_mtime_ns
    get(case_client)
    get(case_client, "?range=24h")
    assert cases_file(tmp_path).read_bytes() == before
    assert cases_file(tmp_path).stat().st_mtime_ns == mtime


EXISTING = ["summary", "timeseries", "top", "mitre", "response", "triage", "pipeline"]


def test_existing_metrics_endpoints_are_unchanged_by_cases(case_client):
    """Case data is bookkeeping: writing cases changes no existing metrics body."""

    def snapshot():
        out = {}
        for name in EXISTING:
            res = case_client.get(f"/metrics/{name}?range=all", headers=DASH)
            assert res.status_code == 200, name
            body = res.json()
            body.pop("as_of", None)
            out[name] = body
        return out

    seed_triage(case_client)  # triage records are not case data; they are in place before the first snapshot
    before = snapshot()
    seed_cases()
    assert snapshot() == before
    store = get_case_store()
    store.add_note("inc-0001", actor="Someone", text="a note")
    store.update("inc-0002", actor="Someone", assignee="Analyst 1", set_assignee=True)
    store.reopen("inc-0003", actor="Someone")
    assert snapshot() == before


def test_the_incidents_list_and_detail_are_unchanged_by_cases(case_client):
    def snapshot():
        return (
            case_client.get("/incidents", headers=DASH).json(),
            case_client.get("/incidents/inc-0003", headers=DASH).json(),
        )

    seed_triage(case_client)
    before = snapshot()
    seed_cases()
    assert snapshot() == before
