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
_FILE_PATH_RE = re.compile(r"(?:\b[A-Za-z]:|\\\\[^\\/:*?\"<>|\r\n\s]+)\\(?:[^\\/:*?\"<>|\r\n\s]+\\)*[^\\/:*?\"<>|\r\n\s]+")
# Hostname-like token: an uppercase-led alphanumeric (with optional hyphens)
# that contains at least one digit -- catches WS01, SRV-042, DESKTOP1, etc.
# without trying to model every real naming convention.
_HOSTNAME_RE = re.compile(r"\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b")
_TRAILING_PUNCT = ".,;:!?)]}\"\'"

# Security abbreviations and protocol/crypto shorthands that match
# _HOSTNAME_RE but are never actual hostnames. Checked case-insensitively.
_SECURITY_TERMS: frozenset[str] = frozenset({
    "SHA1", "SHA256", "MD5", "AES256", "TLS1", "TLS12",
    "HTTP2", "SMB1", "SMB2", "SMB3", "SMBV1", "NTLMV2",
    "IPV4", "IPV6", "BASE64", "UTF8", "UTF16",
    "WIN10", "WIN11", "AMD64", "X64", "X86",
})

# Minimum character length for a hostname candidate. Real names like WS01,
# DC01, SRV-042 are 4+ characters; short tokens like C2 are not hostnames.
_HOSTNAME_MIN_LEN = 4


def _is_path(entity: str) -> bool:
    return bool(re.match(r"^(?:[A-Za-z]:\\|\\\\)", entity))


def extract_entities(text: str) -> set[str]:
    """Every IP, PID reference, Windows file path, and hostname-like token
    found in `text`. PIDs are captured as the bare digit string (e.g. "4412"
    from "PID 4412") so they can be matched against how they'd appear
    elsewhere (e.g. in a JSON field) rather than requiring the word "PID"
    to repeat in the source."""
    entities: set[str] = set()
    entities.update(_IP_RE.findall(text))
    entities.update(_PID_RE.findall(text))
    for p in _FILE_PATH_RE.findall(text):
        cleaned = p.rstrip(_TRAILING_PUNCT)
        if cleaned:
            entities.add(cleaned)
    for h in _HOSTNAME_RE.findall(text):
        if len(h) < _HOSTNAME_MIN_LEN:
            continue
        if h.upper() in _SECURITY_TERMS:
            continue
        entities.add(h)
    return entities


def find_ungrounded(explain_text: str, source_text: str) -> list[str]:
    """Entities mentioned in `explain_text` that don't appear anywhere in
    `source_text` (normalized substring check). Windows paths are compared
    case-insensitively against unescaped source text, while other entities
    require exact matches. Sorted for stable, deterministic output."""
    norm_source = source_text.replace("\\\\", "\\")
    norm_source_lower = norm_source.lower()
    mentioned = extract_entities(explain_text)

    ungrounded: list[str] = []
    seen_paths_lower: set[str] = set()

    for entity in sorted(mentioned):
        if _is_path(entity):
            entity_lower = entity.lower()
            if entity_lower in norm_source_lower:
                continue
            if entity_lower in seen_paths_lower:
                continue
            seen_paths_lower.add(entity_lower)
            ungrounded.append(entity)
        else:
            if entity not in norm_source:
                ungrounded.append(entity)

    return sorted(ungrounded)
