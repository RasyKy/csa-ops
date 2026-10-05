"""Unit tests for backend.app.reports.incident_report.build_incident_report_markdown.
Pure function, hand-built dicts, no store/HTTP needed."""
import re

from backend.app.reports.incident_report import build_incident_report_markdown

GENERATED_TIME = "2026-10-02T12:00:00.000Z"

BASE_INCIDENT = {
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
            {
                "event_id": "evt-1", "pid": 1280, "ppid": 900, "image": "C:\\Windows\\System32\\cmd.exe",
                "command_line": "cmd.exe /c whoami", "timestamp": "2026-09-13T10:15:01.000Z",
                "technique": None, "rule_id": None,
            },
            {
                "event_id": "evt-2", "pid": 4412, "ppid": 1280, "image": "C:\\Windows\\System32\\rundll32.exe",
                "command_line": None, "timestamp": "2026-09-13T10:15:02.000Z",
                "technique": "T1003.001", "rule_id": "T1003_lsass_access",
            },
        ],
        "edges": [],
    },
    "targets": {"pids": [4412], "remote_ips": [], "file_paths": []},
}

RULE_TITLES = {"T1003_lsass_access": "LSASS Memory Access"}


def _action(**overrides):
    base = {
        "action_id": "act-1", "incident_id": "inc-test", "host": "WS01", "action": "kill_process",
        "target": {"pids": [4412], "remote_ips": [], "file_paths": [], "pid_images": {"4412": "rundll32.exe"}},
        "decided_by": {"severity": "high", "matched_scenario": "credential_dump_chain", "policy_rule": "by_scenario"},
        "mode": "dry_run", "status": "executed",
        "command_issued_time": "2026-09-13T10:15:04.000Z",
        "agent_received_time": "2026-09-13T10:15:04.500Z",
        "response_executed_time": "2026-09-13T10:15:05.000Z",
        "result": "simulated",
    }
    base.update(overrides)
    return base


def test_basic_report_has_header_and_attack_chain():
    md = build_incident_report_markdown(BASE_INCIDENT, None, [], RULE_TITLES, GENERATED_TIME)
    assert "# Incident Report: inc-test" in md
    assert "**Severity:** HIGH" in md
    assert "## Attack Chain" in md
    assert "**1." in md and "**2." in md
    assert "LSASS Memory Access" in md
    assert "Command line unavailable" in md
    assert "cmd.exe /c whoami" in md


def test_open_vs_closed_response_action_wording():
    open_action = _action(status="issued", mode="live", result=None)
    closed_action = _action(status="executed", mode="dry_run")

    open_md = build_incident_report_markdown(BASE_INCIDENT, None, [open_action], RULE_TITLES, GENERATED_TIME)
    closed_md = build_incident_report_markdown(BASE_INCIDENT, None, [closed_action], RULE_TITLES, GENERATED_TIME)

    assert "issued" in open_md
    assert "Would have stopped process 4412 (practice mode)" in closed_md


def test_no_triage_yet_shows_fallback_not_empty_section():
    md = build_incident_report_markdown(BASE_INCIDENT, None, [], RULE_TITLES, GENERATED_TIME)
    assert "## AI Analysis" in md
    assert "No AI explanation has been generated for this incident yet." in md
    assert "## AI Triage" in md
    assert "No AI triage verdict is available" in md


def test_no_response_actions_shows_fallback():
    md = build_incident_report_markdown(BASE_INCIDENT, None, [], RULE_TITLES, GENERATED_TIME)
    assert "## Response Actions" in md
    assert "No response actions have been issued for this incident." in md


def test_explain_section_renders_with_prompt_version_and_staleness():
    triage = {
        "incident_id": "inc-test", "verdict": "true_positive", "confidence": "high",
        "reason": "Credential dumping confirmed", "status": "ok",
        "explain": {
            "summary": "Attacker dumped LSASS memory.",
            "objective": "Steal credential material.",
            "notable_details": ["rundll32 spawned by cmd.exe"],
            "next_steps": ["Rotate credentials"],
            "caveats": ["Single-host analysis only"],
            "generated_time": "2026-09-13T10:16:00.000Z",
            "ungrounded_mentions": [],
            "prompt_version": 1,
            "is_stale": True,
        },
    }
    md = build_incident_report_markdown(BASE_INCIDENT, triage, [], RULE_TITLES, GENERATED_TIME)
    assert "### Summary" in md
    assert "Attacker dumped LSASS memory." in md
    assert "older prompt version" in md
    assert "## AI Triage" in md
    assert "TRUE POSITIVE" in md


def test_is_replay_true_adds_footer_note():
    incident = {**BASE_INCIDENT, "is_replay": True}
    md = build_incident_report_markdown(incident, None, [], RULE_TITLES, GENERATED_TIME)
    assert "replayed/simulated event stream" in md


def test_is_replay_absent_omits_footer_note():
    md = build_incident_report_markdown(BASE_INCIDENT, None, [], RULE_TITLES, GENERATED_TIME)
    assert "replayed/simulated" not in md


def test_case_details_rendered_only_when_present():
    incident_with_case = {**BASE_INCIDENT, "status": "open", "assignee": "analyst1"}
    md = build_incident_report_markdown(incident_with_case, None, [], RULE_TITLES, GENERATED_TIME)
    assert "## Case Details" in md
    assert "**Status:** open" in md
    assert "**Assignee:** analyst1" in md
    assert "**Resolution:**" not in md
    assert "**Notes:**" not in md


def test_case_details_omitted_entirely_when_absent():
    md = build_incident_report_markdown(BASE_INCIDENT, None, [], RULE_TITLES, GENERATED_TIME)
    assert "## Case Details" not in md


def test_status_in_header_only_when_present():
    md_without = build_incident_report_markdown(BASE_INCIDENT, None, [], RULE_TITLES, GENERATED_TIME)
    assert "**Status:**" not in md_without

    incident_with_status = {**BASE_INCIDENT, "status": "open"}
    md_with = build_incident_report_markdown(incident_with_status, None, [], RULE_TITLES, GENERATED_TIME)
    assert "**Status:** open" in md_with


def test_command_line_containing_pipe_does_not_break_table():
    action = _action(result="done | with a pipe char")
    md = build_incident_report_markdown(BASE_INCIDENT, None, [action], RULE_TITLES, GENERATED_TIME)
    assert r"done \| with a pipe char" in md
    # Table rows must stay 5 cells: only *unescaped* pipes count as real
    # delimiters -- a markdown table parser ignores a backslash-escaped one.
    for line in md.splitlines():
        if line.startswith("| ") and "---" not in line and "Time" not in line:
            unescaped = len(re.findall(r"(?<!\\)\|", line))
            assert unescaped == 6  # 5 cells -> 6 real delimiters


def test_backtick_in_command_line_does_not_break_code_span():
    incident = {
        **BASE_INCIDENT,
        "chain": {
            "nodes": [
                {
                    "event_id": "evt-1", "pid": 1, "ppid": 0, "image": "cmd.exe",
                    "command_line": "echo `whoami`", "timestamp": "2026-09-13T10:15:01.000Z",
                    "technique": None, "rule_id": None,
                },
            ],
            "edges": [],
        },
    }
    md = build_incident_report_markdown(incident, None, [], RULE_TITLES, GENERATED_TIME)
    # A backtick-containing command line must be fenced with a longer run of
    # backticks (CommonMark requires space-padding when content touches a
    # backtick) so the span doesn't close prematurely on the inner backtick.
    assert "`` echo `whoami` ``" in md


def test_notable_detail_with_markdown_syntax_is_escaped():
    triage = {
        "incident_id": "inc-test", "verdict": "needs_review", "confidence": "low",
        "reason": "unclear", "status": "ok",
        "explain": {
            "summary": "s", "objective": "o",
            "notable_details": ["contains *asterisks* and [brackets] and `backticks`"],
            "next_steps": [], "caveats": [],
            "generated_time": "2026-09-13T10:16:00.000Z",
            "ungrounded_mentions": [], "prompt_version": 2,
        },
    }
    md = build_incident_report_markdown(BASE_INCIDENT, triage, [], RULE_TITLES, GENERATED_TIME)
    assert r"\*asterisks\*" in md
    assert r"\[brackets\]" in md
    assert r"\`backticks\`" in md


def test_indicators_section_renders_consolidated_ips_and_files():
    incident = {
        **BASE_INCIDENT,
        "targets": {
            "remote_ips": ["203.0.113.7", "198.51.100.2"],
            "file_paths": ["C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp"],
        },
    }
    md = build_incident_report_markdown(incident, None, [], RULE_TITLES, GENERATED_TIME)
    assert "## Indicators" in md
    assert "- Remote IP: `198.51.100.2`" in md
    assert "- Remote IP: `203.0.113.7`" in md
    assert r"- File: `C:\Users\alice\AppData\Local\Temp\lsass.dmp`" in md


def test_indicators_section_fallback_when_empty():
    incident = {**BASE_INCIDENT, "targets": {"remote_ips": [], "file_paths": []}}
    md = build_incident_report_markdown(incident, None, [], RULE_TITLES, GENERATED_TIME)
    assert "## Indicators" in md
    assert "No indicators recorded for this incident." in md


def test_header_detected_by_and_impact():
    md = build_incident_report_markdown(BASE_INCIDENT, None, [], RULE_TITLES, GENERATED_TIME)
    assert "**Detected by:** LSASS Memory Access" in md
    assert "**Impact:** Potential compromise of user CORP\\alice's credentials on host WS01." in md
    assert "**Assignee:**" not in md

