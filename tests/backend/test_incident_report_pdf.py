"""Unit and integration tests for PDF incident report generation.

Covers:
- PDF generation with full data, no AI explanation, no response actions.
- Validation of non-empty output and %PDF- magic bytes.
- Direct adversarial testing of report_markdown_to_html + PDF styling:
  1. HTML injection (<img>, <script>) in code spans and prose.
  2. Block markers (# and -) in notable details.
  3. Pipe characters in table cells.
  4. Non-ASCII (Khmer) Unicode preservation.
- Long unbroken string (500-char base64 blob) wrapping and containment on A4.
"""
import json
import pathlib
import re
import pytest

from backend.app.reports.incident_report import build_incident_report_markdown
from backend.app.reports.pdf_renderer import (
    _PDF_CSS,
    render_pdf_from_html,
    report_markdown_to_html,
)

GENERATED_TIME = "2026-10-02T12:00:00.000Z"

BASE_INCIDENT = {
    "incident_id": "inc-test-pdf",
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
                "event_id": "evt-1",
                "pid": 1280,
                "ppid": 900,
                "image": "C:\\Windows\\System32\\cmd.exe",
                "command_line": "cmd.exe /c whoami",
                "timestamp": "2026-09-13T10:15:01.000Z",
                "technique": None,
                "rule_id": None,
            },
            {
                "event_id": "evt-2",
                "pid": 4412,
                "ppid": 1280,
                "image": "C:\\Windows\\System32\\rundll32.exe",
                "command_line": "rundll32.exe comsvcs.dll, MiniDump 624 lsass.dmp full",
                "timestamp": "2026-09-13T10:15:02.000Z",
                "technique": "T1003.001",
                "rule_id": "T1003_lsass_access",
            },
        ],
        "edges": [],
    },
    "targets": {"pids": [4412], "remote_ips": [], "file_paths": []},
}

RULE_TITLES = {"T1003_lsass_access": "LSASS Memory Access"}

SAMPLE_TRIAGE = {
    "incident_id": "inc-test-pdf",
    "verdict": "true_positive",
    "confidence": "high",
    "status": "ok",
    "reason": "Credential dumping via comsvcs confirmed",
    "explain": {
        "summary": "Attacker dumped LSASS memory.",
        "objective": "Harvest credentials.",
        "notable_details": ["rundll32 spawned by cmd.exe", "target pid 624"],
        "next_steps": ["Isolate host", "Rotate credentials"],
        "caveats": ["Single-host visibility"],
        "generated_time": "2026-10-02T12:01:00.000Z",
        "ungrounded_mentions": [],
        "prompt_version": 2,
        "is_stale": False,
    },
}

SAMPLE_ACTIONS = [
    {
        "action_id": "act-1",
        "incident_id": "inc-test-pdf",
        "host": "WS01",
        "action": "kill_process",
        "target": {"pids": [4412], "remote_ips": [], "file_paths": []},
        "decided_by": {"severity": "high", "matched_scenario": "credential_dump_chain"},
        "mode": "live",
        "status": "executed",
        "command_issued_time": "2026-09-13T10:15:04.000Z",
        "agent_received_time": "2026-09-13T10:15:04.500Z",
        "response_executed_time": "2026-09-13T10:15:05.000Z",
        "result": "Process terminated",
    }
]


# ==============================================================================
# 1. Primary PDF Generation Tests
# ==============================================================================

def test_pdf_generation_full_data():
    """PDF generation succeeds for an incident with full data (chain, AI, actions)."""
    md = build_incident_report_markdown(BASE_INCIDENT, SAMPLE_TRIAGE, SAMPLE_ACTIONS, RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)
    pdf = render_pdf_from_html(html)

    assert len(pdf) > 0
    assert pdf.startswith(b"%PDF-")


def test_pdf_generation_no_ai_explanation():
    """PDF generation succeeds for an incident with no AI explanation yet."""
    md = build_incident_report_markdown(BASE_INCIDENT, None, SAMPLE_ACTIONS, RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)
    assert "No AI explanation has been generated for this incident yet." in html
    assert "No AI triage verdict is available" in html

    pdf = render_pdf_from_html(html)
    assert len(pdf) > 0
    assert pdf.startswith(b"%PDF-")


def test_pdf_generation_no_response_actions():
    """PDF generation succeeds for an incident with no response actions."""
    md = build_incident_report_markdown(BASE_INCIDENT, SAMPLE_TRIAGE, [], RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)
    assert "No response actions have been issued for this incident." in html

    pdf = render_pdf_from_html(html)
    assert len(pdf) > 0
    assert pdf.startswith(b"%PDF-")


# ==============================================================================
# 2. Adversarial Tests on report_markdown_to_html + PDF Styling
# ==============================================================================

def test_adversarial_html_injection_in_ai_text_is_escaped():
    """Live <script> and <img> tags in AI-generated text must be escaped as HTML entities in HTML."""
    triage = {
        "incident_id": "inc-test-pdf",
        "verdict": "needs_review",
        "confidence": "low",
        "reason": "malicious input test",
        "status": "ok",
        "explain": {
            "summary": "Attacker payload: <script>alert('xss')</script>",
            "objective": "Test <img src=x onerror=alert(1)> injection",
            "notable_details": ["<svg onload=alert(2)>", "<iframe src='evil.com'></iframe>"],
            "next_steps": ["Ensure & safe entities"],
            "caveats": [],
            "generated_time": "2026-10-02T12:00:00.000Z",
            "ungrounded_mentions": [],
            "prompt_version": 2,
            "is_stale": False,
        },
    }
    md = build_incident_report_markdown(BASE_INCIDENT, triage, [], RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    # In the rendered HTML document, there must be NO unescaped <script>, <img>, <svg>, or <iframe> tags
    assert "<script>" not in html
    assert "<img src=x" not in html
    assert "<svg onload" not in html
    assert "<iframe" not in html

    # Instead, they must appear properly entity-escaped:
    assert "&lt;script&gt;alert('xss')&lt;/script&gt;" in html
    assert "&lt;img src=x onerror=alert(1)&gt;" in html
    assert "&lt;svg onload=alert(2)&gt;" in html


def test_adversarial_html_injection_in_command_line_is_escaped_inside_code_span():
    """<script> tags inside a command line must be HTML-escaped inside <code>."""
    incident = {
        **BASE_INCIDENT,
        "chain": {
            "nodes": [
                {
                    "event_id": "evt-xss",
                    "pid": 100,
                    "ppid": 1,
                    "image": "cmd.exe",
                    "command_line": "echo <script>alert('cmd')</script>",
                    "timestamp": "2026-09-13T10:15:01.000Z",
                    "technique": None,
                    "rule_id": None,
                }
            ],
            "edges": [],
        },
    }
    md = build_incident_report_markdown(incident, None, [], RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    assert "<script>alert('cmd')</script>" not in html
    assert '<code class="code-span">echo &lt;script&gt;alert(\'cmd\')&lt;/script&gt;</code>' in html


def test_adversarial_notable_detail_starting_with_hash_does_not_become_html_heading():
    """A notable_detail starting with '#' must stay a list item and NOT become an <h1> or <h2>."""
    triage = {
        "incident_id": "inc-test-pdf",
        "verdict": "needs_review",
        "confidence": "low",
        "reason": "heading injection test",
        "status": "ok",
        "explain": {
            "summary": "s",
            "objective": "o",
            "notable_details": ["# This looks like a heading"],
            "next_steps": [],
            "caveats": [],
            "generated_time": "2026-10-02T12:00:00.000Z",
            "ungrounded_mentions": [],
            "prompt_version": 2,
            "is_stale": False,
        },
    }
    md = build_incident_report_markdown(BASE_INCIDENT, triage, [], RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    # Must be inside a list item <li># This looks like a heading</li>
    assert "<li># This looks like a heading</li>" in html
    # Must NOT create an h1 or h2 with that text
    assert "<h1># This looks like a heading</h1>" not in html
    assert "<h2># This looks like a heading</h2>" not in html


def test_adversarial_notable_detail_starting_with_dash_does_not_become_nested_list():
    """A notable_detail starting with '-' must stay a single list item and NOT create a nested <ul>."""
    triage = {
        "incident_id": "inc-test-pdf",
        "verdict": "needs_review",
        "confidence": "low",
        "reason": "list injection test",
        "status": "ok",
        "explain": {
            "summary": "s",
            "objective": "o",
            "notable_details": ["- This looks like a list item"],
            "next_steps": [],
            "caveats": [],
            "generated_time": "2026-10-02T12:00:00.000Z",
            "ungrounded_mentions": [],
            "prompt_version": 2,
            "is_stale": False,
        },
    }
    md = build_incident_report_markdown(BASE_INCIDENT, triage, [], RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    assert "<li>- This looks like a list item</li>" in html


def test_adversarial_pipe_in_table_cell_does_not_corrupt_html_table():
    """A pipe character in a target path must not split the table cell or corrupt the columns."""
    action = {
        "action_id": "act-pipe",
        "incident_id": "inc-test-pdf",
        "host": "WS01",
        "action": "quarantine_file",
        "target": {"file_paths": ["C:\\evil|payload.exe"], "pids": [], "remote_ips": []},
        "decided_by": {},
        "mode": "dry_run",
        "status": "executed",
        "command_issued_time": "2026-09-13T10:15:04.000Z",
        "agent_received_time": None,
        "response_executed_time": None,
        "result": "done | with pipe",
    }
    md = build_incident_report_markdown(BASE_INCIDENT, None, [action], RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    # HTML table must exist
    assert '<table class="response-table">' in html
    # Exactly one row in tbody
    assert html.count("<tr>") == 2  # 1 thead row + 1 tbody row
    # The cell must contain the literal pipe character
    assert "evil|payload.exe" in html
    assert "done | with pipe" in html


def test_adversarial_khmer_unicode_preserved_in_html_and_pdf():
    """Khmer non-ASCII text must be preserved byte-for-byte in HTML and render into PDF."""
    incident = {
        **BASE_INCIDENT,
        "user": "\u1780\u17c6\u1796\u17bb\u1787\u17b6",
        "host": "\u1798\u17d2\u1785\u17b6\u179f-WS09",
    }
    md = build_incident_report_markdown(incident, None, [], RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    assert "\u1780\u17c6\u1796\u17bb\u1787\u17b6" in html
    assert "\u1798\u17d2\u1785\u17b6\u179f-WS09" in html

    pdf = render_pdf_from_html(html)
    assert len(pdf) > 0
    assert pdf.startswith(b"%PDF-")


# ==============================================================================
# 3. Long Unbroken String Wrapping Test (A4 Containment)
# ==============================================================================

def test_long_unbroken_base64_string_wraps_in_pdf():
    """A 500-char unbroken base64 string inside command_line must wrap and stay contained on A4."""
    # 500 characters of unbroken base64 data
    base64_blob = "A" * 500
    incident = {
        **BASE_INCIDENT,
        "chain": {
            "nodes": [
                {
                    "event_id": "evt-long",
                    "pid": 1280,
                    "ppid": 900,
                    "image": "powershell.exe",
                    "command_line": base64_blob,
                    "timestamp": "2026-09-13T10:15:01.000Z",
                    "technique": None,
                    "rule_id": None,
                }
            ],
            "edges": [],
        },
    }
    md = build_incident_report_markdown(incident, None, [], RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    # Verify CSS contains wrapping rules
    assert "overflow-wrap: break-word;" in _PDF_CSS
    assert "word-break: break-all;" in _PDF_CSS
    assert "white-space: pre-wrap;" in _PDF_CSS

    # Verify the code element was generated with the code-span class containing the unbroken 500-char blob
    assert f'<code class="code-span">{base64_blob}</code>' in html

    # Verify PDF renders successfully
    pdf = render_pdf_from_html(html)
    assert len(pdf) > 0
    assert pdf.startswith(b"%PDF-")


def test_attack_chain_bold_does_not_leak_asterisks():
    """Attack chain steps must convert **timestamp** and **title** to strong tags with no literal asterisks."""
    md = build_incident_report_markdown(BASE_INCIDENT, SAMPLE_TRIAGE, SAMPLE_ACTIONS, RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    # Must contain strong tags for timestamp and rule title
    assert "<strong>2026-09-13T10:15:02.000Z</strong>" in html
    assert "<strong>LSASS Memory Access</strong>" in html
    # Must NOT contain literal asterisks in the attack chain section
    assert "**" not in html


def test_attack_chain_does_not_merge_into_following_section():
    """Attack chain items must be encapsulated in their own section and not merge into Indicators or AI Analysis."""
    md = build_incident_report_markdown(BASE_INCIDENT, SAMPLE_TRIAGE, SAMPLE_ACTIONS, RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    # Attack chain section must be closed before Indicators and AI Analysis
    chain_idx = html.find('class="report-section attack-chain-section"')
    ind_idx = html.find('class="report-section indicators-section"')
    ai_idx = html.find('class="report-section ai-analysis-section"')

    assert chain_idx != -1
    assert ind_idx != -1
    assert ai_idx != -1
    assert chain_idx < ind_idx < ai_idx


def test_indicators_section_renders_in_html():
    """Indicators section renders a bullet list with styled code spans."""
    incident = {
        **BASE_INCIDENT,
        "targets": {
            "remote_ips": ["203.0.113.7"],
            "file_paths": ["C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp"],
        },
    }
    md = build_incident_report_markdown(incident, SAMPLE_TRIAGE, [], RULE_TITLES, GENERATED_TIME)
    html = report_markdown_to_html(md)

    assert "<h2>Indicators</h2>" in html
    assert '<code class="code-span">203.0.113.7</code>' in html
    assert '<code class="code-span">C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp</code>' in html


