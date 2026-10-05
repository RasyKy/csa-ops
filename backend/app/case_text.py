"""Plain-language wording for analyst case events.

Pure: no imports from the app, no I/O. It mirrors dashboard/lib/caseDisplay.ts
so a case event reads the same in the dashboard and in the incident report. Keep
the two in sync if either changes.

The strings returned here are raw text. Callers that put them in Markdown or HTML
must neutralize or escape them first: actor names and assignees come from people.
"""
from typing import Any, Optional

STATUS_LABELS = {
    "open": "Open",
    "investigating": "Investigating",
    "resolved": "Resolved",
}

VERDICT_LABELS = {
    "true_positive": "True positive",
    "false_positive": "False positive",
    "benign_activity": "Benign activity",
    "undetermined": "Undetermined",
}

ANONYMOUS_ACTOR = "Someone"


def _humanize(value: str) -> str:
    spaced = value.replace("_", " ").strip()
    return spaced[:1].upper() + spaced[1:] if spaced else spaced


def status_label(status: Any) -> str:
    if not isinstance(status, str):
        return "Unknown"
    return STATUS_LABELS.get(status) or _humanize(status)


def verdict_label(verdict: Any) -> str:
    if not isinstance(verdict, str):
        return "Unknown"
    return VERDICT_LABELS.get(verdict) or _humanize(verdict)


def _text(value: Any) -> Optional[str]:
    return value if isinstance(value, str) and value.strip() != "" else None


def event_sentence(event: Any) -> str:
    """One sentence per audit event. Never raises: anything unexpected becomes
    "<actor> updated this case"."""
    try:
        e = event if isinstance(event, dict) else {}
        actor = _text(e.get("actor")) or ANONYMOUS_ACTOR
        raw_data = e.get("data")
        data = raw_data if isinstance(raw_data, dict) else {}
        fallback = f"{actor} updated this case"
        kind = e.get("type")

        if kind == "created":
            return "Case opened"
        if kind == "status_changed":
            old, new = _text(data.get("from")), _text(data.get("to"))
            if old and new:
                return f"{actor} changed the status from {status_label(old)} to {status_label(new)}"
            return fallback
        if kind == "assignee_changed":
            old, new = _text(data.get("from")), _text(data.get("to"))
            if new and old:
                return f"{actor} reassigned this from {old} to {new}"
            if new:
                return f"{actor} assigned this to {new}"
            if old:
                return f"{actor} unassigned this"
            return fallback
        if kind == "note_added":
            return f"{actor} added a note"
        if kind == "resolved":
            verdict = _text(data.get("verdict"))
            if verdict:
                return f"{actor} resolved this as {verdict_label(verdict).lower()}"
            return f"{actor} resolved this"
        if kind == "reopened":
            return f"{actor} reopened this case"
        return fallback
    except Exception:  # pragma: no cover - defensive; the checks above should cover it
        return f"{ANONYMOUS_ACTOR} updated this case"
