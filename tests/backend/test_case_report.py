"""The analyst case in the incident report (Markdown and PDF).

Pure builder tests use hand-built dicts and a fake clock. Endpoint tests run the
in-process TestClient with DATA_ROOT and every runtime path in a tmp dir, so
nothing is written under the repo's data/ or fixtures/."""
import json
import re
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.case_text import event_sentence, status_label, verdict_label
from backend.app.config import get_settings
from backend.app.main import app
from backend.app.models.case import CaseStatus, Verdict
from backend.app.reports.incident_report import MAX_CASE_EVENTS, build_incident_report_markdown
from backend.app.reports.pdf_renderer import _PDF_CSS, render_pdf_from_html, report_markdown_to_html
from backend.app.store import get_case_store
from backend.app.store.case_store import CaseStore

REPO_ROOT = Path(__file__).resolve().parents[2]
SHOTS = REPO_ROOT / "dashboard" / "e2e" / "screenshots"
DASHBOARD_KEY = "test-dashboard-key"
DASH = {"X-API-Key": DASHBOARD_KEY}
GENERATED_TIME = "2026-10-05T12:00:00.000Z"

INCIDENT = {
    "incident_id": "inc-test",
    "incident_raised_time": "2026-09-13T10:15:03.001Z",
    "host": "WS01",
    "user": "CORP\\alice",
    "severity": "high",
    "risk_score": 27,
    "matched_scenario": "credential_dump_chain",
    "techniques": ["T1003.001"],
    "tactics": ["credential_access"],
    "alert_ids": ["alert-1"],
    "chain": {
        "nodes": [
            {"event_id": "evt-1", "pid": 1280, "ppid": 900, "image": "C:\\Windows\\System32\\cmd.exe",
             "command_line": "cmd.exe /c whoami", "timestamp": "2026-09-13T10:15:01.000Z",
             "technique": None, "rule_id": None},
            {"event_id": "evt-2", "pid": 4412, "ppid": 1280, "image": "C:\\Windows\\System32\\rundll32.exe",
             "command_line": None, "timestamp": "2026-09-13T10:15:02.000Z",
             "technique": "T1003.001", "rule_id": "T1003_lsass_access"},
        ],
        "edges": [],
    },
    "targets": {"pids": [4412], "remote_ips": [], "file_paths": []},
}
RULE_TITLES = {"T1003_lsass_access": "LSASS Memory Access"}
TRIAGE = {
    "incident_id": "inc-test", "verdict": "true_positive", "confidence": "high", "status": "ok",
    "reason": "Credential dumping confirmed", "explain": None,
}
ACTIONS = [{
    "action_id": "act-1", "incident_id": "inc-test", "host": "WS01", "action": "kill_process",
    "target": {"pids": [4412], "remote_ips": [], "file_paths": []}, "decided_by": {},
    "mode": "live", "status": "executed", "command_issued_time": "2026-09-13T10:15:04.000Z",
    "agent_received_time": None, "response_executed_time": "2026-09-13T10:15:05.000Z", "result": "ok",
}]


class FakeClock:
    """Each call is one second later, so event order is visible in the times."""

    def __init__(self):
        self._t = datetime(2026, 10, 4, 10, 0, 0, tzinfo=timezone.utc)

    def __call__(self) -> str:
        self._t += timedelta(seconds=1)
        return self._t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def full_case(tmp_path, incident_id="inc-test") -> dict:
    """A case with every event type, written through the real store."""
    store = CaseStore(tmp_path / "cases.json", clock=FakeClock())
    store.update(incident_id, actor="Priya", status=CaseStatus.investigating)
    store.update(incident_id, actor="Priya", assignee="Analyst 1", set_assignee=True)
    store.add_note(incident_id, actor="Priya", text="Checked the process tree.\nLooks like a dump.")
    store.update(incident_id, actor="Sam", assignee="Analyst 2", set_assignee=True)
    store.update(incident_id, actor="Sam", assignee=None, set_assignee=True)
    store.resolve(incident_id, actor="Sam", verdict=Verdict.true_positive, note="Confirmed credential dump.")
    store.reopen(incident_id, actor="Lee")
    store.resolve(incident_id, actor="Lee", verdict=Verdict.false_positive, note="It was a test.")
    return store.get(incident_id).model_dump(mode="json")


def build(case=None, **kwargs):
    return build_incident_report_markdown(INCIDENT, TRIAGE, ACTIONS, RULE_TITLES, GENERATED_TIME, case=case, **kwargs)


def case_section(md: str) -> str:
    start = md.index("## Case\n")
    end = md.index("\n---\n", start)
    return md[start:end].rstrip()


# ---------------------------------------------------------------------------
# case_text


def test_event_sentences_are_exact():
    def ev(kind, actor="Priya", **data):
        return {"id": "e", "time": "t", "actor": actor, "type": kind, "data": data}

    assert event_sentence(ev("created")) == "Case opened"
    assert event_sentence(ev("status_changed", **{"from": "open", "to": "investigating"})) == (
        "Priya changed the status from Open to Investigating"
    )
    assert event_sentence(ev("status_changed", **{"from": "investigating", "to": "open"})) == (
        "Priya changed the status from Investigating to Open"
    )
    assert event_sentence(ev("assignee_changed", **{"from": None, "to": "Analyst 1"})) == "Priya assigned this to Analyst 1"
    assert event_sentence(ev("assignee_changed", **{"from": "Analyst 1", "to": None})) == "Priya unassigned this"
    assert event_sentence(ev("assignee_changed", **{"from": "Analyst 1", "to": "Analyst 2"})) == (
        "Priya reassigned this from Analyst 1 to Analyst 2"
    )
    assert event_sentence(ev("note_added", text="x")) == "Priya added a note"
    for verdict, label in [("true_positive", "true positive"), ("false_positive", "false positive"),
                           ("benign_activity", "benign activity"), ("undetermined", "undetermined")]:
        assert event_sentence(ev("resolved", verdict=verdict)) == f"Priya resolved this as {label}"
    assert event_sentence(ev("reopened")) == "Priya reopened this case"


def test_missing_actor_becomes_someone():
    for actor in (None, "", "   ", 5):
        assert event_sentence({"type": "note_added", "actor": actor, "data": {}}) == "Someone added a note"
    assert event_sentence({"type": "reopened"}) == "Someone reopened this case"


def test_labels():
    assert [status_label(s) for s in ("open", "investigating", "resolved")] == ["Open", "Investigating", "Resolved"]
    assert [verdict_label(v) for v in ("true_positive", "false_positive", "benign_activity", "undetermined")] == [
        "True positive", "False positive", "Benign activity", "Undetermined",
    ]
    assert status_label("on_hold") == "On hold"
    assert status_label(None) == "Unknown" and verdict_label(5) == "Unknown"


@pytest.mark.parametrize(
    "event",
    [None, 5, "x", [], {}, {"type": "mystery"}, {"type": 7, "actor": "A"}, {"type": "status_changed", "data": "no"},
     {"type": "status_changed", "actor": "A", "data": {"from": "open"}}, {"type": "assignee_changed", "actor": "A"},
     {"type": "resolved", "actor": "A", "data": None}, {"type": "created", "data": 5}],
)
def test_malformed_events_never_throw(event):
    sentence = event_sentence(event)
    assert isinstance(sentence, str) and sentence


def test_unknown_event_falls_back():
    assert event_sentence({"type": "mystery", "actor": "Priya"}) == "Priya updated this case"
    assert event_sentence({"type": "status_changed", "actor": "Priya", "data": {}}) == "Priya updated this case"


# ---------------------------------------------------------------------------
# the builder


def test_case_none_is_byte_identical_to_the_old_output():
    without = build_incident_report_markdown(INCIDENT, TRIAGE, ACTIONS, RULE_TITLES, GENERATED_TIME)
    assert build(case=None) == without
    assert "## Case\n" not in without
    assert "Case activity" not in without


def test_full_case_section(tmp_path):
    case = full_case(tmp_path)
    md = build(case)
    section = case_section(md)

    # Position: after the incident summary, indicators and response actions, before the footer.
    for earlier in ("# Incident Report", "## Indicators", "## AI Triage", "## Response Actions"):
        assert md.index(earlier) < md.index("## Case\n")
    assert md.index("## Case\n") < md.index("_Report generated")

    lines = section.splitlines()
    assert lines[0] == "## Case"
    assert "**Status:** Resolved" in section
    assert "**Assignee:** Unassigned" in section
    assert "**Verdict:** False positive" in section
    assert "**Resolution note:** It was a test." in section
    assert f"**Resolved time:** {case['resolved_time']}" in section
    assert "### Case activity" in section

    # Events oldest first, one list item each, sentences exactly as case_text writes them.
    items = [line for line in lines if line.startswith("- ")]
    assert len(items) == len(case["events"]) == 9
    for event, item in zip(case["events"], items):
        assert item == f"- {event['time']} | {event_sentence(event)}"
    times = [i.split(" | ")[0][2:] for i in items]
    assert times == sorted(times)
    assert items[0].endswith("| Case opened")
    assert items[-1].endswith("| Lee resolved this as false positive")

    expected_sentences = [
        "Case opened",
        "Priya changed the status from Open to Investigating",
        "Priya assigned this to Analyst 1",
        "Priya added a note",
        "Sam reassigned this from Analyst 1 to Analyst 2",
        "Sam unassigned this",
        "Sam resolved this as true positive",
        "Lee reopened this case",
        "Lee resolved this as false positive",
    ]
    assert [i.split(" | ", 1)[1] for i in items] == expected_sentences

    # Notes: an indented block quote directly under its event, one quote line per note line.
    note_at = items.index(next(i for i in items if i.endswith("Priya added a note")))
    start = lines.index(items[note_at])
    assert lines[start + 1] == "  > Checked the process tree."
    assert lines[start + 2] == "  > Looks like a dump."
    resolved_at = lines.index(next(i for i in items if i.endswith("Sam resolved this as true positive")))
    assert lines[resolved_at + 1] == "  > Confirmed credential dump."


def test_open_case_has_no_verdict_lines():
    case = {
        "incident_id": "inc-test", "status": "investigating", "assignee": "Analyst 1", "verdict": None,
        "resolution_note": None, "resolved_time": None, "updated_time": "2026-10-04T10:00:02.000Z",
        "version": 2,
        "events": [
            {"id": "evt-1", "time": "2026-10-04T10:00:01.000Z", "actor": "Priya", "type": "created", "data": {}},
            {"id": "evt-2", "time": "2026-10-04T10:00:02.000Z", "actor": "Priya", "type": "status_changed",
             "data": {"from": "open", "to": "investigating"}},
        ],
    }
    section = case_section(build(case))
    assert "**Status:** Investigating" in section
    assert "**Assignee:** Analyst 1" in section
    assert "**Verdict:**" not in section and "**Resolved time:**" not in section and "**Resolution note:**" not in section


def test_virtual_case_is_one_line():
    virtual = {"incident_id": "inc-test", "status": "open", "assignee": None, "verdict": None,
               "resolution_note": None, "resolved_time": None, "updated_time": None, "events": [], "version": 0}
    section = case_section(build(virtual))
    assert section == "## Case\n\nNo analyst activity recorded. Status: Open."


@pytest.mark.parametrize("bad", ["x", 5, [], 0])
def test_unusable_case_leaves_the_section_out(bad):
    assert build(bad) == build(None)


def _note_events(count):
    base = datetime(2026, 10, 4, 10, 0, 0, tzinfo=timezone.utc)
    return [
        {"id": f"evt-{n + 1}", "time": (base + timedelta(seconds=n)).isoformat().replace("+00:00", "Z"),
         "actor": "Priya", "type": "note_added", "data": {"text": f"note {n + 1}"}}
        for n in range(count)
    ]


def _case_with(events, **extra):
    return {"incident_id": "inc-test", "status": "investigating", "assignee": None, "verdict": None,
            "resolution_note": None, "resolved_time": None, "updated_time": None,
            "events": events, "version": len(events), **extra}


def test_activity_is_capped_at_200_events():
    assert MAX_CASE_EVENTS == 200
    events = _note_events(250)
    section = case_section(build(_case_with(events)))
    items = [line for line in section.splitlines() if line.startswith("- ")]
    assert len(items) == 200
    assert "  > note 250" in section and "  > note 51" in section
    assert "  > note 50\n" not in section + "\n"
    assert section.rstrip().endswith("_50 older events omitted._")
    # Still oldest first within what is shown.
    assert items[0].startswith(f"- {events[50]['time']}")
    assert items[-1].startswith(f"- {events[-1]['time']}")


def test_exactly_200_events_has_no_omission_line_and_201_says_one_event():
    assert "omitted" not in case_section(build(_case_with(_note_events(200))))
    assert case_section(build(_case_with(_note_events(201)))).rstrip().endswith("_1 older event omitted._")


def test_events_given_out_of_order_are_listed_oldest_first():
    events = list(reversed(_note_events(4)))
    items = [l for l in case_section(build(_case_with(events))).splitlines() if l.startswith("- ")]
    times = [i.split(" | ")[0][2:] for i in items]
    assert times == sorted(times)


# ---------------------------------------------------------------------------
# hostile text

HOSTILE = {
    "heading": "# Heading",
    "bullet": "- item",
    "fence": "```\nrm -rf /\n```",
    "link": "[x](javascript:alert(1))",
    "script": "<script>alert(1)</script>",
    "table": "| a | b |",
    "long": "A" * 5000,
    "linebreak": "Priya\n# Injected heading\n- injected item",
    "khmer": "\u1780\u17c6\u1796\u17bb\u1787\u17b6 \u1798\u17d2\u1785\u17b6\u179f",
}

# Every line of the Case section must be one of the shapes the builder writes. An
# analyst string that created Markdown structure would show up as a line of another shape.
ALLOWED_LINE = re.compile(
    r"^(## Case"
    r"|### Case activity"
    r"|\*\*(Status|Assignee|Verdict|Resolution note|Resolved time):\*\*( .*)?"
    r"|- \S+ \| .+"
    r"|  >( .*)?"
    r"|_.*_"
    r"|No analyst activity recorded\. Status: .+\.)$"
)


def hostile_case(field: str, value: str) -> dict:
    t = ["2026-10-04T10:00:0%d.000Z" % n for n in range(1, 6)]
    actor = value if field == "actor" else "Priya"
    assignee = value if field == "assignee" else "Analyst 1"
    note = value if field == "note" else "plain note"
    resolution = value if field == "resolution" else "plain resolution"
    events = [
        {"id": "evt-1", "time": t[0], "actor": actor, "type": "created", "data": {}},
        {"id": "evt-2", "time": t[1], "actor": actor, "type": "assignee_changed", "data": {"from": None, "to": assignee}},
        {"id": "evt-3", "time": t[2], "actor": actor, "type": "note_added", "data": {"text": note}},
        {"id": "evt-4", "time": t[3], "actor": actor, "type": "resolved",
         "data": {"verdict": "true_positive", "note": resolution}},
    ]
    return {"incident_id": "inc-test", "status": "resolved", "assignee": assignee, "verdict": "true_positive",
            "resolution_note": resolution, "resolved_time": t[3], "updated_time": t[3], "events": events, "version": 4}


def count(html: str, needle: str) -> int:
    return html.count(needle)


@pytest.mark.parametrize("field", ["actor", "assignee", "note", "resolution"])
@pytest.mark.parametrize("name", list(HOSTILE))
def test_hostile_text_creates_no_markdown_structure_and_is_escaped_in_html(field, name):
    value = HOSTILE[name]
    case = hostile_case(field, value)
    md = build(case)
    section = case_section(md)

    for line in section.splitlines():
        if line == "":
            continue
        assert ALLOWED_LINE.match(line), f"unexpected line shape: {line[:80]!r}"

    # Raw trigger text never survives unescaped.
    assert not re.search(r"(?<!\\)<", section), "an unescaped < in the Case section"
    assert "[x](" not in md
    assert not re.search(r"(?<!\\)`", section), "an unescaped backtick in the Case section"
    # A pipe from the analyst's text is escaped (the " | " separator is the builder's own).
    if name == "table":
        assert "\\| a \\| b \\|" in section
    # The text itself is not lost.
    if name == "long":
        assert value in section
    if name == "khmer":
        assert value in section

    html = report_markdown_to_html(md)
    assert "<script>" not in html
    assert "<a " not in html and "javascript:alert(1)</a>" not in html
    if name == "script":
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    # Structure is exactly what an ordinary case produces.
    benign = report_markdown_to_html(build(hostile_case("actor", "Priya")))
    for tag in ("<h1>", "<h2>", "<h3>", '<ul class="case-activity">', '<div class="case-event">', '<div class="case-note">'):
        assert count(html, tag) == count(benign, tag), tag
    assert count(html, "<li>") == count(benign, "<li>")
    # Long strings wrap: the case section carries wrapping rules.
    assert "overflow-wrap: anywhere" in _PDF_CSS
    assert 'class="report-section case-section"' in html


def test_hostile_line_break_in_a_name_stays_on_one_line():
    section = case_section(build(hostile_case("actor", HOSTILE["linebreak"])))
    items = [l for l in section.splitlines() if l.startswith("- ")]
    assert len(items) == 4
    assert all("\n" not in i for i in items)
    assert not any(l.startswith("#") and l != "### Case activity" and l != "## Case" for l in section.splitlines())


def test_hostile_note_lines_each_stay_in_the_quote():
    section = case_section(build(hostile_case("note", "# one\n- two\n> three\n1. four\n```")))
    quote_lines = [l for l in section.splitlines() if l.startswith("  >")]
    assert quote_lines[:5] == [
        "  > \\# one",
        "  > \\- two",
        "  > \\> three",
        "  > \\1. four",
        "  > \\`\\`\\`",
    ]
    assert all(l.startswith("  >") for l in quote_lines)
    assert not re.search(r"(?<!\\)`", section)


def test_every_hostile_string_renders_to_a_pdf():
    """One PDF carrying all the hostile strings: it renders, with the wrapping rules."""
    events = []
    for n, (name, value) in enumerate(HOSTILE.items(), start=1):
        events.append({"id": f"evt-{n}", "time": f"2026-10-04T10:00:{n:02d}.000Z", "actor": value,
                       "type": "note_added", "data": {"text": value}})
    case = _case_with(events)
    html = report_markdown_to_html(build(case))
    assert "<script>" not in html
    pdf = render_pdf_from_html(html)
    assert pdf.startswith(b"%PDF-") and len(pdf) > 1000


# ---------------------------------------------------------------------------
# the endpoints


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


INC = "inc-0003"


def test_endpoint_reports_a_stored_case(case_client, tmp_path):
    store = get_case_store()
    store.update(INC, actor="Priya", status=CaseStatus.investigating)
    store.add_note(INC, actor="Priya", text="Found the dump file.")
    store.resolve(INC, actor="Sam", verdict=Verdict.true_positive, note="Confirmed.")

    res = case_client.get(f"/incidents/{INC}/report", headers=DASH)
    assert res.status_code == 200
    section = case_section(res.text)
    assert "**Status:** Resolved" in section
    assert "**Verdict:** True positive" in section
    assert "  > Found the dump file." in section
    assert "Sam resolved this as true positive" in section
    assert res.text.index("## Response Actions") < res.text.index("## Case\n")


def test_endpoint_reports_a_virtual_case_without_writing(case_client, tmp_path):
    assert not cases_file(tmp_path).exists()
    res = case_client.get(f"/incidents/{INC}/report", headers=DASH)
    assert res.status_code == 200
    assert case_section(res.text) == "## Case\n\nNo analyst activity recorded. Status: Open."
    assert not cases_file(tmp_path).exists(), "reading the case must not create cases.json"
    assert not (tmp_path / "data").exists() or list((tmp_path / "data").glob("cases*")) == []


def test_include_case_false_omits_the_section(case_client):
    get_case_store().add_note(INC, actor="Priya", text="hello")
    with_case = case_client.get(f"/incidents/{INC}/report", headers=DASH).text
    without = case_client.get(f"/incidents/{INC}/report?include_case=false", headers=DASH).text
    assert "## Case\n" in with_case
    assert "## Case\n" not in without and "Case activity" not in without
    # Everything else is the same (only the generated time may differ).
    strip = lambda t: re.sub(r"_Report generated .*_", "", t)
    assert strip(with_case).replace(case_section(with_case), "").count("## ") == strip(without).count("## ")


def test_corrupt_cases_file_still_exports_without_a_case_section(case_client, tmp_path):
    cases_file(tmp_path).parent.mkdir(parents=True, exist_ok=True)
    cases_file(tmp_path).write_text("{ this is not json", encoding="utf-8")
    before = cases_file(tmp_path).read_bytes()
    res = case_client.get(f"/incidents/{INC}/report", headers=DASH)
    assert res.status_code == 200
    assert "## Case\n" not in res.text
    assert "## Attack Chain" in res.text
    assert cases_file(tmp_path).read_bytes() == before, "a report never repairs or rewrites the case file"

    pdf = case_client.get(f"/incidents/{INC}/report?format=pdf", headers=DASH)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")


def test_cases_file_with_a_bad_entry_also_leaves_the_section_out(case_client, tmp_path):
    cases_file(tmp_path).parent.mkdir(parents=True, exist_ok=True)
    cases_file(tmp_path).write_text(json.dumps({INC: {"incident_id": INC, "status": "nonsense"}}), encoding="utf-8")
    res = case_client.get(f"/incidents/{INC}/report", headers=DASH)
    assert res.status_code == 200 and "## Case\n" not in res.text


def test_report_endpoint_never_writes_the_cases_file(case_client, tmp_path):
    get_case_store().add_note(INC, actor="Priya", text="hello")
    before = cases_file(tmp_path).read_bytes()
    mtime = cases_file(tmp_path).stat().st_mtime_ns
    for query in ("", "?format=pdf", "?include_case=false"):
        assert case_client.get(f"/incidents/{INC}/report{query}", headers=DASH).status_code == 200
    assert cases_file(tmp_path).read_bytes() == before
    assert cases_file(tmp_path).stat().st_mtime_ns == mtime


def test_report_needs_the_dashboard_key(case_client):
    assert case_client.get(f"/incidents/{INC}/report").status_code == 401


# ---------------------------------------------------------------------------
# PDF text order

pdftotext = shutil.which("pdftotext")


def pdf_text(pdf_bytes: bytes, tmp_path: Path) -> str:
    src = tmp_path / "report.pdf"
    src.write_bytes(pdf_bytes)
    out = tmp_path / "report.txt"
    subprocess.run([pdftotext, "-layout", str(src), str(out)], check=True, timeout=60)
    return out.read_text(encoding="utf-8", errors="replace")


def page_count(pdf_bytes: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page(?![a-zA-Z])", pdf_bytes))


def test_pdf_has_the_case_in_order(case_client, tmp_path):
    store = get_case_store()
    store.update(INC, actor="Priya", status=CaseStatus.investigating)
    store.update(INC, actor="Priya", assignee="Analyst 1", set_assignee=True)
    store.add_note(INC, actor="Priya", text="Found the dump file on the desktop.")
    store.resolve(INC, actor="Sam", verdict=Verdict.false_positive, note="Admin tooling, expected.")

    res = case_client.get(f"/incidents/{INC}/report?format=pdf", headers=DASH)
    assert res.status_code == 200 and res.content.startswith(b"%PDF-")

    # The HTML the PDF is made from has the same order (checked even without pdftotext).
    html = report_markdown_to_html(case_client.get(f"/incidents/{INC}/report", headers=DASH).text)
    order = ["Case opened", "Priya changed the status from Open to Investigating", "Priya assigned this to Analyst 1",
             "Priya added a note", "Sam resolved this as false positive"]
    positions = [html.index(s) for s in order]
    assert positions == sorted(positions)
    assert html.index("Status:") < html.index(order[0])

    if not pdftotext:
        pytest.skip("pdftotext is not installed; the PDF text order was checked on the HTML only")
    text = pdf_text(res.content, tmp_path)
    flat = re.sub(r"\s+", " ", text)
    assert "Case activity" in flat
    start = flat.index("Case Status") if "Case Status" in flat else flat.index("Status:")
    markers = ["Status: Resolved", "Assignee: Analyst 1", "Verdict: False positive",
               "Resolution note: Admin tooling, expected."] + order[:4] + [
        "Found the dump file on the desktop.", order[4]]
    last = start - 1
    for marker in markers:
        found = flat.find(marker, last + 1)
        assert found != -1, f"{marker!r} is missing or out of order in the PDF text"
        last = found


def test_write_a_sample_pdf(case_client, tmp_path):
    """A readable sample for a person to open: written under the gitignored
    dashboard/e2e/screenshots folder."""
    store = get_case_store()
    store.update(INC, actor="Priya", status=CaseStatus.investigating)
    store.update(INC, actor="Priya", assignee="Analyst 1", set_assignee=True)
    store.add_note(INC, actor="Priya", text="Found the dump file on the desktop.\nChecked the parent process.")
    store.resolve(INC, actor="Sam", verdict=Verdict.true_positive, note="Confirmed credential dump, host isolated.")
    res = case_client.get(f"/incidents/{INC}/report?format=pdf", headers=DASH)
    assert res.status_code == 200
    SHOTS.mkdir(parents=True, exist_ok=True)
    target = SHOTS / "case-report-sample.pdf"
    target.write_bytes(res.content)
    pages = page_count(res.content)
    print(f"case-report-sample.pdf {len(res.content)} bytes, {pages} pages")
    assert pages >= 1 and target.stat().st_size > 1000
