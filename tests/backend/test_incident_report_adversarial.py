"""Adversarial test pass on build_incident_report_markdown: content edge
cases and structural/security safety that reading the real output (not
just grepping for substrings) surfaced. See incident_report.py's comments
for the CommonMark reasoning behind each fix these lock in."""
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
    "techniques": [],
    "tactics": [],
    "alert_ids": [],
    "chain": {"nodes": [], "edges": []},
    "targets": {"pids": [], "remote_ips": [], "file_paths": []},
}


def _node(**overrides):
    base = {
        "event_id": "evt-1", "pid": 100, "ppid": 1, "image": "cmd.exe",
        "command_line": None, "timestamp": "2026-09-13T10:15:01.000Z",
        "technique": None, "rule_id": None,
    }
    base.update(overrides)
    return base


def _action(**overrides):
    base = {
        "action_id": "act-1", "incident_id": "inc-test", "host": "WS01", "action": "kill_process",
        "target": {"pids": [4412], "remote_ips": [], "file_paths": [], "pid_images": {}},
        "decided_by": {}, "mode": "dry_run", "status": "executed",
        "command_issued_time": "2026-09-13T10:15:04.000Z", "agent_received_time": None,
        "response_executed_time": None, "result": None,
    }
    base.update(overrides)
    return base


def _incident_with_nodes(*nodes):
    return {**BASE_INCIDENT, "chain": {"nodes": list(nodes), "edges": []}}


def _unescaped_pipe_count(line: str) -> int:
    return len(re.findall(r"(?<!\\)\|", line))


# 1. Pipe reaching the Response Actions table via a quarantine_file path.
def test_pipe_in_target_path_does_not_break_table():
    action = _action(
        action="quarantine_file",
        target={"file_paths": ["C:\\evil|payload.exe"], "pids": [], "remote_ips": []},
    )
    md = build_incident_report_markdown(BASE_INCIDENT, None, [action], {}, GENERATED_TIME)
    assert r"evil\|payload.exe" in md
    for line in md.splitlines():
        if line.startswith("| ") and "---" not in line and "Time" not in line:
            assert _unescaped_pipe_count(line) == 6


# 2. Backtick fence scales to an arbitrary run length, not just one extra.
def test_code_fence_scales_to_arbitrary_backtick_run_length():
    for run_len in (1, 3, 4, 10):
        cl = f"echo {'`' * run_len}payload{'`' * run_len}"
        incident = _incident_with_nodes(_node(command_line=cl))
        md = build_incident_report_markdown(incident, None, [], {}, GENERATED_TIME)
        fence = "`" * (run_len + 1)
        assert f"{fence} {cl} {fence}" in md, f"failed for run_len={run_len}"


# 3. AI-generated bullet text starting with a block-structure trigger must
# not become a nested heading or nested list -- confirmed by direct
# rendering that the unescaped version does exactly that.
def test_notable_detail_starting_with_hash_does_not_become_heading():
    triage = {
        "incident_id": "x", "verdict": "needs_review", "confidence": "low", "reason": "r", "status": "ok",
        "explain": {
            "summary": "s", "objective": "o",
            "notable_details": ["# This looks like a heading"],
            "next_steps": [], "caveats": [],
            "generated_time": "t", "ungrounded_mentions": [], "prompt_version": 2,
        },
    }
    md = build_incident_report_markdown(BASE_INCIDENT, triage, [], {}, GENERATED_TIME)
    assert "- \\# This looks like a heading" in md
    assert "- # This looks like a heading" not in md


def test_notable_detail_starting_with_dash_does_not_become_nested_list():
    triage = {
        "incident_id": "x", "verdict": "needs_review", "confidence": "low", "reason": "r", "status": "ok",
        "explain": {
            "summary": "s", "objective": "o",
            "notable_details": ["- This looks like a list item"],
            "next_steps": [], "caveats": [],
            "generated_time": "t", "ungrounded_mentions": [], "prompt_version": 2,
        },
    }
    md = build_incident_report_markdown(BASE_INCIDENT, triage, [], {}, GENERATED_TIME)
    assert "- \\- This looks like a list item" in md
    assert "- - This looks like a list item" not in md


def test_notable_detail_with_bracket_paren_does_not_form_a_link():
    triage = {
        "incident_id": "x", "verdict": "needs_review", "confidence": "low", "reason": "r", "status": "ok",
        "explain": {
            "summary": "s", "objective": "o",
            "notable_details": ["click here](javascript:alert(1))"],
            "next_steps": [], "caveats": [],
            "generated_time": "t", "ungrounded_mentions": [], "prompt_version": 2,
        },
    }
    md = build_incident_report_markdown(BASE_INCIDENT, triage, [], {}, GENERATED_TIME)
    assert r"click here\](javascript:alert(1))" in md


# 4. Non-ASCII (Khmer) text is preserved byte-for-byte, not mangled.
def test_non_ascii_khmer_username_preserved():
    incident = {**BASE_INCIDENT, "user": "\u1780\u17c6\u1796\u17bb\u1787\u17b6", "host": "\u1798\u17d2\u1785\u17b6\u179f-WS09"}
    md = build_incident_report_markdown(incident, None, [], {}, GENERATED_TIME)
    assert "\u1780\u17c6\u1796\u17bb\u1787\u17b6" in md
    assert "\u1798\u17d2\u1785\u17b6\u179f-WS09" in md


# 5. Extremely long content doesn't crash or get silently mangled, and is
# truncated in the rendered report (500 chars + a "...(N total)" note) --
# report-rendering only, this never touches the underlying data.
def test_very_long_command_line_is_truncated_in_report():
    long_cl = "A" * 5000
    incident = _incident_with_nodes(_node(command_line=long_cl))
    md = build_incident_report_markdown(incident, None, [], {}, GENERATED_TIME)
    assert long_cl not in md
    assert "A" * 500 + "...(5000 characters total, truncated)" in md


def test_very_long_file_path_target_is_truncated_in_report():
    long_path = "C:\\temp\\" + "B" * 5000 + ".exe"
    action = _action(action="quarantine_file", target={"file_paths": [long_path], "pids": [], "remote_ips": []})
    md = build_incident_report_markdown(BASE_INCIDENT, None, [action], {}, GENERATED_TIME)
    assert long_path not in md
    assert "...(5004 characters total, truncated)" in md


# 6. Numbering stays correct and sequential at both a single node and a
# long chain.
def test_single_node_chain_numbers_correctly():
    incident = _incident_with_nodes(_node())
    md = build_incident_report_markdown(incident, None, [], {}, GENERATED_TIME)
    assert "**1. " in md
    assert "**2. " not in md


def test_twenty_five_node_chain_numbers_sequentially():
    nodes = [_node(event_id=f"evt-{i}", pid=1000 + i, timestamp=f"2026-09-13T10:15:{i:02d}.000Z") for i in range(25)]
    incident = _incident_with_nodes(*nodes)
    md = build_incident_report_markdown(incident, None, [], {}, GENERATED_TIME)
    step_numbers = [int(m.group(1)) for m in re.finditer(r"^\*\*(\d+)\. ", md, re.MULTILINE)]
    assert step_numbers == list(range(1, 26))


# 7. A trigger node whose rule_id has no matching alert (deleted/never
# written) must degrade to the raw rule_id, not crash or silently drop the
# step.
def test_missing_rule_title_falls_back_to_raw_rule_id():
    incident = _incident_with_nodes(_node(rule_id="T9999_deleted_rule", technique="T9999"))
    md = build_incident_report_markdown(incident, None, [], {}, GENERATED_TIME)  # empty rule_titles
    assert "T9999_deleted_rule" in md
    assert "triggered" in md


# 8. Two incidents with different prompt_versions, built back to back,
# must not share any cached/mutable state.
def test_different_prompt_versions_are_independent_across_calls():
    def _triage(version, stale):
        return {
            "incident_id": "x", "verdict": "needs_review", "confidence": "low", "reason": "r", "status": "ok",
            "explain": {
                "summary": "s", "objective": "o", "notable_details": [], "next_steps": [], "caveats": [],
                "generated_time": "t", "ungrounded_mentions": [], "prompt_version": version, "is_stale": stale,
            },
        }

    md_stale = build_incident_report_markdown(BASE_INCIDENT, _triage(1, True), [], {}, GENERATED_TIME)
    md_fresh = build_incident_report_markdown(BASE_INCIDENT, _triage(2, False), [], {}, GENERATED_TIME)
    assert "older prompt version (prompt version 1)" in md_stale
    assert "older prompt version" not in md_fresh
    assert "_Generated with prompt version 2._" in md_fresh


# 9. HTML injection: a literal <script>/<img> tag in either a code-span
# field (command_line) or a prose field (AI-generated text) must not reach
# the output as live, unescaped HTML.
def test_script_tag_in_command_line_is_inert_inside_code_span():
    incident = _incident_with_nodes(_node(command_line="echo <script>alert(1)</script>"))
    md = build_incident_report_markdown(incident, None, [], {}, GENERATED_TIME)
    # CommonMark code-span content is always literal/escaped on render, so
    # the raw text appearing inside backticks is the safe outcome here.
    assert "`echo <script>alert(1)</script>`" in md


def test_script_tag_in_ai_text_is_escaped():
    triage = {
        "incident_id": "x", "verdict": "needs_review", "confidence": "low", "reason": "r", "status": "ok",
        "explain": {
            "summary": "s", "objective": "o",
            "notable_details": ["<img src=x onerror=alert(1)>", "<script>evil()</script>"],
            "next_steps": [], "caveats": [],
            "generated_time": "t", "ungrounded_mentions": [], "prompt_version": 2,
        },
    }
    md = build_incident_report_markdown(BASE_INCIDENT, triage, [], {}, GENERATED_TIME)
    # The escaped form trivially contains the raw tag as a substring, so the
    # real check is that every "<" is backslash-escaped (no bare "<" slips
    # through), not a plain "not in" check against the unescaped string.
    assert re.search(r"(?<!\\)<", md) is None
    assert r"\<img src=x onerror=alert(1)>" in md
    assert r"\<script>evil()\</script>" in md
