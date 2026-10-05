"""Opt-in FIXTURE_SET: serve fixtures/NAME/ with runtime data under data/NAME/.

Unset, empty or "default" keeps the existing paths exactly. Any other NAME must
match ^[a-z0-9_-]+$ and fixtures/NAME/ must hold alerts.json and incidents.json,
otherwise startup fails with a clear message. FIXTURE_ROOT and DATA_ROOT
redirect the two base directories (tests point them at a tmp dir).
"""
import json
import re
from pathlib import Path

from ..config import Settings

SET_NAME_RE = re.compile(r"^[a-z0-9_-]+$")
DEFAULT_NAMES = ("", "default")

EMPTY_RUNTIME_FILES = {
    "intake_state.json": {"watermark": None, "processed_ids": []},
    "response_actions.json": [],
    "incident_triage.json": {},
}


def is_default_set(name: str) -> bool:
    return name.strip() in DEFAULT_NAMES


def validate_set_name(name: str) -> str:
    name = name.strip()
    if not SET_NAME_RE.match(name):
        raise ValueError(
            f"Invalid FIXTURE_SET {name!r}: use 'default' or a name matching ^[a-z0-9_-]+$ "
            "(lowercase letters, digits, '_' and '-')."
        )
    return name


def resolve_store_paths(settings: Settings) -> dict:
    """Keyword arguments for FixtureStore, honoring FIXTURE_SET."""
    if is_default_set(settings.fixture_set):
        return {
            "fixtures_dir": settings.fixtures_dir,
            "intake_state_path": settings.intake_state_path,
            "response_actions_path": settings.response_actions_path,
            "incident_triage_path": settings.incident_triage_path,
        }

    name = validate_set_name(settings.fixture_set)
    fixtures_dir = Path(settings.fixture_root) / name
    missing = [f for f in ("alerts.json", "incidents.json") if not (fixtures_dir / f).is_file()]
    if not fixtures_dir.is_dir() or missing:
        raise ValueError(
            f"FIXTURE_SET={name!r}: expected {fixtures_dir} to contain alerts.json and incidents.json"
            + (f" (missing: {', '.join(missing)})" if fixtures_dir.is_dir() else " (directory not found)")
            + ". Generate it with scripts/generate_scenarios.py or unset FIXTURE_SET."
        )

    data_dir = Path(settings.data_root) / name
    data_dir.mkdir(parents=True, exist_ok=True)
    for filename, empty in EMPTY_RUNTIME_FILES.items():
        target = data_dir / filename
        if not target.exists():
            target.write_text(json.dumps(empty))

    return {
        "fixtures_dir": str(fixtures_dir),
        "intake_state_path": str(data_dir / "intake_state.json"),
        "response_actions_path": str(data_dir / "response_actions.json"),
        "incident_triage_path": str(data_dir / "incident_triage.json"),
    }


def resolve_cases_path(settings: Settings) -> Path:
    """cases.json beside the runtime data of the active set: DATA_ROOT/cases.json
    for the default set, DATA_ROOT/NAME/cases.json for a named one. Only
    computes the path; the case store creates the file on the first write."""
    if is_default_set(settings.fixture_set):
        return Path(settings.data_root) / "cases.json"
    return Path(settings.data_root) / validate_set_name(settings.fixture_set) / "cases.json"
