"""Post-hoc grounding check for explain output: does the model mention
entities (IPs, PIDs, hostnames, file paths) that don't appear anywhere in
the data it was given? Pure functions, no I/O -- same isolation posture as
backend/metrics/calc.py elsewhere in this project.

Deliberately simple regexes, not a full NER pass (per the audit's own
"simple regexes" framing): this will miss some real hostnames and can
occasionally under- or over-match. It's a cheap sanity signal for an
analyst, not a proof of correctness.
"""
import re

_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_PID_RE = re.compile(r"\bPID\s*[:#]?\s*\(?(\d{2,7})\)?", re.IGNORECASE)
_FILE_PATH_RE = re.compile(r"\b[A-Za-z]:\\(?:[^\\/:*?\"<>|\r\n\s]+\\)*[^\\/:*?\"<>|\r\n\s]+")
# Hostname-like token: an uppercase-led alphanumeric (with optional hyphens)
# that contains at least one digit -- catches WS01, SRV-042, DESKTOP1, etc.
# without trying to model every real naming convention.
_HOSTNAME_RE = re.compile(r"\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b")


def extract_entities(text: str) -> set[str]:
    """Every IP, PID reference, Windows file path, and hostname-like token
    found in `text`. PIDs are captured as the bare digit string (e.g. "4412"
    from "PID 4412") so they can be matched against how they'd appear
    elsewhere (e.g. in a JSON field) rather than requiring the word "PID"
    to repeat in the source."""
    entities: set[str] = set()
    entities.update(_IP_RE.findall(text))
    entities.update(_PID_RE.findall(text))
    entities.update(_FILE_PATH_RE.findall(text))
    entities.update(_HOSTNAME_RE.findall(text))
    return entities


def find_ungrounded(explain_text: str, source_text: str) -> list[str]:
    """Entities mentioned in `explain_text` that don't appear anywhere in
    `source_text` (a plain substring check -- source_text is the same JSON
    text the model was actually given, so this compares against exactly
    what it saw). Sorted for stable, deterministic output."""
    mentioned = extract_entities(explain_text)
    return sorted(entity for entity in mentioned if entity not in source_text)
