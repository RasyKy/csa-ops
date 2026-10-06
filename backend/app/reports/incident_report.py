"""Builds a Markdown incident report from already-written data.

Pure function, no FastAPI/store coupling -- takes the same raw dict shapes
backend/app/store/*.py already returns, so it's trivially unit-testable.
Read-only: never writes anything back to any store.

Two fields referenced by the original report spec -- case-management
(status/assignee/resolution/notes) and is_replay -- don't exist anywhere in
this system's real data today (confirmed by reading backend/app/models/
incident.py and grepping the repo). Rather than hardcoding "always omit",
this reads the incident as a raw dict and checks for those keys with plain
.get(): if they're absent (true for every real incident right now), the
corresponding section/line is omitted; if a future contract change ever
adds them, this picks them up with zero code change here.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from ..case_text import event_sentence, status_label, verdict_label

_CASE_FIELDS = ("status", "assignee", "resolution", "notes")

_TARGET_KIND = {
    "log": "none",
    "alert": "none",
    "kill_process": "process",
    "block_address": "address",
    "quarantine_file": "file",
    "isolate_host": "host",
    "unblock_address": "address",
    "restore_file": "file",
    "unisolate_host": "host",
}

# Mirrors dashboard/lib/responseWording.ts's ACTION_COPY exactly, so a
# response action reads identically in the dashboard and in this report.
# Keep the two in sync if either changes.
_ACTION_COPY = {
    "log": {"base": "log this incident", "present": "logging this incident", "past": "logged this incident"},
    "alert": {"base": "raise an alert", "present": "raising an alert", "past": "raised an alert"},
    "kill_process": {"base": "stop", "present": "stopping", "past": "stopped"},
    "block_address": {"base": "block", "present": "blocking", "past": "blocked"},
    "quarantine_file": {"base": "quarantine", "present": "quarantining", "past": "quarantined"},
    "isolate_host": {"base": "isolate", "present": "isolating", "past": "isolated"},
    "unblock_address": {"base": "unblock", "present": "unblocking", "past": "unblocked"},
    "restore_file": {"base": "restore", "present": "restoring", "past": "restored"},
    "unisolate_host": {"base": "reconnect", "present": "reconnecting", "past": "reconnected"},
}


def _basename(path: str) -> str:
    return path.replace("\\", "/").rsplit("/", 1)[-1]


# Escapes only the characters that can actually corrupt structure when they
# land, unpaired, in interpolated text: a stray backtick or asterisk can
# pair with an unrelated one elsewhere in the document and turn a large
# span into a code block or bold/italic run; a stray "[" can start a link;
# "|" breaks a table row; "<" opens raw HTML (CommonMark renders inline/
# block HTML through by default -- a command_line or AI-generated field
# containing a literal "<script>" would otherwise reach any renderer that
# doesn't itself sanitize HTML, e.g. a browser-based markdown viewer).
# Deliberately NOT escaping backslash or underscore: CommonMark already
# renders a backslash before a non-punctuation character (e.g.
# "CORP\alice", "C:\Users\...") literally with no escaping needed, and a
# mid-word underscore (e.g. "dry_run", "credential_dump_chain") doesn't
# trigger emphasis per CommonMark's intraword-underscore rule -- escaping
# either would only add visible backslash clutter to exactly the kind of
# Windows paths and identifiers this report is full of, with no rendering
# benefit.
_MD_SPECIAL = re.compile(r"([`*\[\]|<])")


def _escape_md(text: Optional[str]) -> str:
    if not text:
        return ""
    return _MD_SPECIAL.sub(r"\\\1", str(text).replace("\r\n", " ").replace("\n", " "))


# Block-start markers (ATX heading "#", bullet "-"/"+"/"*", ordered-list
# "1.", blockquote ">") are recognized by CommonMark during BLOCK parsing,
# which happens before inline backslash-escapes are processed -- so
# _escape_md's inline escaping alone does not stop a notable_detail/
# next_step/caveat that happens to start with one of these from being
# parsed as a NESTED heading or nested list inside its own bullet (e.g. an
# AI-generated detail starting with "# ..." becomes a heading nested in the
# list item, and one starting with "- ..." becomes a nested sub-list) --
# confirmed by rendering both cases. The fix is a backslash before the
# single leading trigger character: since the line then starts with "\",
# not "#"/"-"/etc., block parsing never recognizes it as starting a new
# block in the first place, regardless of what follows. Only applied where
# text becomes the first thing on its own line (bullet list items below);
# mid-sentence occurrences of these characters are not block starts and
# don't need this.
_LEADING_BLOCK_MARKER = re.compile(r"^(?:#{1,6}(?=\s|$)|[-+*](?=\s)|\d+[.)](?=\s)|>)")


def _escape_leading_block_marker(text: str) -> str:
    if not text or not _LEADING_BLOCK_MARKER.match(text):
        return text
    return "\\" + text


# Table cells additionally can't contain a literal newline or an
# unescaped "|" without breaking the row -- _escape_md already escapes "|"
# and collapses newlines to a space, so this is just a readable alias at
# call sites that are specifically building table cells.
def _escape_table_cell(text: Optional[str]) -> str:
    return _escape_md(text)


# Backslash escapes don't work inside a CommonMark code span (content
# between backticks is taken literally) -- escaping a backtick there would
# print a literal backslash and still close the span early. The correct
# fix is to fence with more consecutive backticks than any run already in
# the text, per the spec, with a padding space if the content itself starts
# or ends with a backtick. Used for command_line and image path, which can
# contain anything (shell command substitution, etc.) and are rendered as
# code, not escaped prose.
def _code_span(text: Optional[str]) -> str:
    if not text:
        return ""
    text = str(text).replace("\r\n", " ").replace("\n", " ")
    longest = run = 0
    for ch in text:
        run = run + 1 if ch == "`" else 0
        longest = max(longest, run)
    fence = "`" * (longest + 1)
    pad = " " if text.startswith("`") or text.endswith("`") else ""
    return f"{fence}{pad}{text}{pad}{fence}"


# Unbounded raw fields (not AI-generated, so not schema-length-capped) can
# carry obfuscated/encoded content at arbitrary length -- a long base64 or
# hex-encoded PowerShell payload in command_line is the common case, but
# anything sourced straight from Sysmon (also file_path) has the same
# property. Truncating here is report-rendering only: the dashboard, the
# store, and every other consumer keep the untruncated value: this never
# mutates the incident dict, it only shortens the string right before it's
# interpolated into this document.
_TRUNCATE_AT = 500


def _truncate(text: str) -> str:
    if len(text) <= _TRUNCATE_AT:
        return text
    total = len(text)
    return f"{text[:_TRUNCATE_AT]}...({total} characters total, truncated)"


def _describe_target(action: dict) -> str:
    kind = _TARGET_KIND.get(action.get("action"), "none")
    if kind == "none":
        return ""
    if kind == "host":
        return f"host {action.get('host')}"

    target = action.get("target") or {}
    if kind == "process" and target.get("pids"):
        return f"process {', '.join(str(p) for p in target['pids'])}"
    if kind == "address" and target.get("remote_ips"):
        return f"address {', '.join(target['remote_ips'])}"
    if kind == "file" and target.get("file_paths"):
        return f"file {', '.join(_truncate(_basename(p)) for p in target['file_paths'])}"
    return ""


# Python's str.capitalize() lowercases every character after the first --
# wrong here, since phrases can contain hostnames like "WS04" that must
# stay uppercase. This only uppercases the first character, matching
# dashboard/lib/responseWording.ts's own capitalize() exactly.
def _capitalize(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


def describe_response_action(action: dict) -> str:
    """Plain-language description of one response action. Mirrors
    dashboard/lib/responseWording.ts's describeResponseAction exactly."""
    copy = _ACTION_COPY.get(action.get("action"), {"base": action.get("action", ""), "present": action.get("action", ""), "past": action.get("action", "")})
    target = _describe_target(action)

    def phrase(verb: str) -> str:
        return f"{verb} {target}" if target else verb

    status = action.get("status")
    mode = action.get("mode")

    if status == "blocked_by_kill_switch":
        return f"Blocked by kill switch -- {target} was not touched" if target else "Blocked by kill switch"
    if mode == "dry_run":
        return f"Would have {phrase(copy['past'])} (practice mode)"
    if status == "failed":
        return _capitalize(f"failed to {phrase(copy['base'])}")
    if status == "executed":
        return _capitalize(phrase(copy["past"]))
    return _capitalize(f"{phrase(copy['present'])}…")


def _sorted_nodes(nodes: list[dict]) -> list[dict]:
    return sorted(nodes, key=lambda n: n.get("timestamp") or "")


def _derive_impact(incident: dict) -> str:
    user = incident.get("user") or "unknown user"
    host = incident.get("host") or "unknown host"
    scenario = incident.get("matched_scenario")
    severity = (incident.get("severity") or "unknown").lower()

    if scenario == "credential_dump_chain":
        statement = f"Potential compromise of user {user}'s credentials on host {host}."
    elif scenario == "lateral_movement_chain":
        statement = f"Potential unauthorized lateral movement from user {user} across host {host}."
    elif scenario == "exfiltration_chain":
        statement = f"Potential data exfiltration from host {host} under user {user} account."
    elif scenario == "malware_drop_chain":
        statement = f"Potential malware drop and execution on host {host} affecting user {user}."
    else:
        statement = f"{severity.capitalize()} severity incident detected for user {user} on host {host}."

    return _escape_md(statement)


def _render_header(incident: dict, rule_titles: dict[str, str]) -> str:
    lines = [f"# Incident Report: {incident['incident_id']}", ""]

    chain_nodes = incident.get("chain", {}).get("nodes", [])
    trigger_rule_ids = [n["rule_id"] for n in chain_nodes if n.get("rule_id")]
    if trigger_rule_ids:
        titles = [rule_titles.get(rid, rid) for rid in dict.fromkeys(trigger_rule_ids)]
    else:
        titles = list(dict.fromkeys(rule_titles.values()))
    detected_by = ", ".join(_escape_md(t) for t in titles) if titles else "_none_"

    impact = _derive_impact(incident)

    lines.append(
        f"**Severity:** {_escape_md(incident.get('severity', '').upper())}  \n"
        f"**Detected by:** {detected_by}  \n"
        f"**Impact:** {impact}  \n"
        f"**Host:** {_escape_md(incident.get('host'))}   **User:** {_escape_md(incident.get('user'))}  \n"
        f"**Matched scenario:** {_escape_md(incident.get('matched_scenario')) or '_none_'}  \n"
        f"**Raised:** {incident.get('incident_raised_time')}"
    )
    return "\n".join(lines)


def _render_indicators(incident: dict) -> str:
    targets = incident.get("targets") or {}
    remote_ips = targets.get("remote_ips") or []
    file_paths = targets.get("file_paths") or []

    if not remote_ips and not file_paths:
        return "## Indicators\n\n_No indicators recorded for this incident._"

    lines = ["## Indicators", ""]
    for ip in sorted(set(remote_ips)):
        lines.append(f"- Remote IP: {_code_span(ip)}")
    for path in sorted(set(file_paths)):
        lines.append(f"- File: {_code_span(_truncate(path))}")
    return "\n".join(lines).rstrip()


def _render_attack_chain(incident: dict, rule_titles: dict[str, str]) -> str:
    nodes = _sorted_nodes(incident.get("chain", {}).get("nodes", []))
    if not nodes:
        return "## Attack Chain\n\n_No events recorded in this chain._"

    lines = ["## Attack Chain", ""]
    for i, node in enumerate(nodes, start=1):
        rule_id = node.get("rule_id")
        is_trigger = rule_id is not None
        image = _code_span(_truncate(_basename(node.get("image", ""))))
        pid = node.get("pid")
        ppid = node.get("ppid")
        timestamp = node.get("timestamp", "")

        if is_trigger:
            title = rule_titles.get(rule_id, rule_id)
            technique = node.get("technique")
            tag = f" ({_escape_md(technique)})" if technique else ""
            step = f"**{i}. {timestamp}** -- **{_escape_md(title)}** triggered{tag}: {image} (pid {pid}, parent pid {ppid})"
        else:
            step = f"**{i}. {timestamp}** -- Process started: {image} (pid {pid}, parent pid {ppid})"

        lines.append(step)
        command_line = node.get("command_line")
        if command_line:
            lines.append(f"   - Command line: {_code_span(_truncate(command_line))}")
        else:
            lines.append("   - _Command line unavailable_")
        lines.append("")

    return "\n".join(lines).rstrip()


def _render_ai_analysis(triage: Optional[dict]) -> str:
    explain = (triage or {}).get("explain")
    if not explain:
        return "## AI Analysis\n\n_No AI explanation has been generated for this incident yet._"

    lines = ["## AI Analysis", ""]
    prompt_version = explain.get("prompt_version")
    version_note = f"prompt version {prompt_version}" if prompt_version is not None else "prompt version unknown (predates version tracking)"
    if explain.get("is_stale"):
        lines.append(f"> **Note:** generated with an older prompt version ({version_note}) -- may not reflect current analysis.")
        lines.append("")
    else:
        lines.append(f"_Generated with {version_note}._")
        lines.append("")

    lines.append("### Summary")
    lines.append(_escape_md(explain.get("summary")))
    lines.append("")
    lines.append("### Likely Objective")
    lines.append(_escape_md(explain.get("objective")))
    lines.append("")

    for heading, key in (("Notable Details", "notable_details"), ("Next Steps", "next_steps"), ("Caveats", "caveats")):
        items = explain.get(key) or []
        lines.append(f"### {heading}")
        if items:
            lines.extend(f"- {_escape_leading_block_marker(_escape_md(item))}" for item in items)
        else:
            lines.append("_None noted._")
        lines.append("")

    ungrounded = explain.get("ungrounded_mentions") or []
    if ungrounded:
        lines.append(f"> **Caution:** mentions not traceable to the source data: {', '.join(_escape_md(m) for m in ungrounded)}")
        lines.append("")

    return "\n".join(lines).rstrip()


def _render_ai_triage(triage: Optional[dict]) -> str:
    if not triage or triage.get("status") != "ok":
        reason = "triage has not run yet" if not triage else "the last triage attempt failed"
        return f"## AI Triage\n\n_No AI triage verdict is available ({reason})._"

    verdict = (triage.get("verdict") or "").replace("_", " ").upper()
    confidence = (triage.get("confidence") or "").upper()
    reason = _escape_md(triage.get("reason"))
    return (
        "## AI Triage\n\n"
        f"**Verdict:** {verdict}   **Confidence:** {confidence}  \n"
        f"**Reason:** {reason}"
    )


def _render_response_actions(response_history: list[dict]) -> str:
    if not response_history:
        return "## Response Actions\n\n_No response actions have been issued for this incident._"

    lines = [
        "## Response Actions",
        "",
        "| Time | Action | Mode | Status | Result |",
        "| --- | --- | --- | --- | --- |",
    ]
    for action in sorted(response_history, key=lambda a: a.get("command_issued_time") or ""):
        time = _escape_table_cell(action.get("command_issued_time"))
        description = _escape_table_cell(describe_response_action(action))
        mode = _escape_table_cell(action.get("mode"))
        status = _escape_table_cell(action.get("status"))
        result = _escape_table_cell(action.get("result")) or "_--_"
        lines.append(f"| {time} | {description} | {mode} | {status} | {result} |")

    return "\n".join(lines)


def _render_case_details(incident: dict) -> Optional[str]:
    present = {k: incident.get(k) for k in _CASE_FIELDS if incident.get(k)}
    if not present:
        return None
    lines = ["## Case Details", ""]
    for key, value in present.items():
        lines.append(f"**{key.capitalize()}:** {_escape_md(value)}  ")
    return "\n".join(lines).rstrip()


# The activity list shows at most this many events, newest kept: the case's
# resolution is at the end and matters more than its earliest bookkeeping.
MAX_CASE_EVENTS = 200


def _render_note_block(text: str) -> list[str]:
    """A note as an indented block quote under its event. Every line goes through
    the same escaping as other untrusted prose, and a leading block marker is
    defused so a note cannot open a heading or list inside the quote."""
    lines = str(text).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return [f"  > {_escape_leading_block_marker(_escape_md(line))}".rstrip() for line in lines]


def _render_case(case: Any) -> Optional[str]:
    """The "Case" section: status, assignee, verdict and the activity timeline,
    oldest first. Analyst-written text (actor, assignee, notes) is untrusted and
    only ever appears escaped. Returns None when no usable case was given."""
    if not isinstance(case, dict):
        return None

    raw_events = case.get("events")
    events = [e for e in raw_events if isinstance(e, dict)] if isinstance(raw_events, list) else []
    status = case.get("status") or "open"

    if not events and not case.get("version"):
        # The virtual default: nothing has ever been recorded for this incident.
        return f"## Case\n\nNo analyst activity recorded. Status: {_escape_md(status_label(status))}."

    assignee = case.get("assignee")
    lines = [
        "## Case",
        "",
        f"**Status:** {_escape_md(status_label(status))}  ",
        f"**Assignee:** {_escape_md(assignee) if isinstance(assignee, str) and assignee.strip() else 'Unassigned'}  ",
    ]
    if status == "resolved":
        lines.append(f"**Verdict:** {_escape_md(verdict_label(case.get('verdict')))}  ")
        note = case.get("resolution_note")
        if isinstance(note, str) and note.strip():
            lines.append(f"**Resolution note:** {_escape_md(note)}  ")
        if case.get("resolved_time"):
            lines.append(f"**Resolved time:** {_escape_md(case.get('resolved_time'))}  ")
    lines[-1] = lines[-1].rstrip()

    ordered = sorted(events, key=lambda e: str(e.get("time") or ""))
    omitted = max(0, len(ordered) - MAX_CASE_EVENTS)
    shown = ordered[omitted:]

    lines += ["", "### Case activity", ""]
    if not shown:
        lines.append("_No activity recorded._")
    for event in shown:
        when = _escape_md(event.get("time")) or "unknown time"
        lines.append(f"- {when} | {_escape_md(event_sentence(event))}")
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        text = None
        if event.get("type") == "note_added":
            text = data.get("text")
        elif event.get("type") == "resolved":
            text = data.get("note")
        if isinstance(text, str) and text.strip():
            lines.extend(_render_note_block(text))
    if omitted:
        noun = "event" if omitted == 1 else "events"
        lines += ["", f"_{omitted} older {noun} omitted._"]
    return "\n".join(lines)


def _render_footer(generated_time: str, incident: dict) -> str:
    lines = ["---", "", f"_Report generated {generated_time} by CSA-OPS._"]
    if incident.get("is_replay"):
        lines.append("")
        lines.append("_This incident was generated from a replayed/simulated event stream, not live production traffic._")
    return "\n".join(lines)


def build_incident_report_markdown(
    incident: dict,
    triage: Optional[dict],
    response_history: list[dict],
    rule_titles: dict[str, str],
    generated_time: str,
    case: Optional[dict] = None,
) -> str:
    """case, when given, is a dict shaped like backend.app.models.case.Case (the
    virtual default included); the report then gets a "Case" section. With
    case=None the output is exactly what it was before cases existed."""
    sections = [
        _render_header(incident, rule_titles),
        _render_attack_chain(incident, rule_titles),
        _render_indicators(incident),
        _render_ai_analysis(triage),
        _render_ai_triage(triage),
        _render_response_actions(response_history),
    ]

    case_section = _render_case(case)
    if case_section:
        sections.append(case_section)

    case_details = _render_case_details(incident)
    if case_details:
        sections.append(case_details)

    sections.append(_render_footer(generated_time, incident))

    return "\n\n".join(sections) + "\n"
