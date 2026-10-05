"""Rebuild demo state on Render startup into an ephemeral work directory."""
from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import REPO_ROOT, Settings

logger = logging.getLogger("csa_ops.demo_bootstrap")

SEED_FILES = (
    "incident_triage.json",
    "response_actions.json",
    "intake_state.json",
    "cases.json",
)


def bootstrap_demo(settings: Settings, seed_dir: Path | None = None) -> None:
    """Bootstrap demo state if DEMO_BOOTSTRAP=1 and FIXTURE_SET is non-default."""
    if not settings.demo_bootstrap:
        return

    set_name = settings.fixture_set.strip() if settings.fixture_set else ""
    if not set_name or set_name == "default":
        return

    # Determine work dir
    if settings.demo_work_dir:
        work_dir = Path(settings.demo_work_dir).resolve()
    else:
        work_dir = (Path(tempfile.gettempdir()) / "csa-ops-demo").resolve()

    # Create work fixtures and data directories
    work_fixtures = work_dir / "fixtures"
    work_data = work_dir / "data"
    work_fixtures.mkdir(parents=True, exist_ok=True)
    work_data.mkdir(parents=True, exist_ok=True)

    # Point existing settings to the work directory
    settings.fixture_root = str(work_fixtures)
    settings.data_root = str(work_data)
    settings.kill_switch_path = str(work_data / "killswitch")

    # Generate the fixture set with anchor = current UTC time
    now_utc = datetime.now(timezone.utc)
    from scripts.generate_scenarios import generate

    set_fixtures_dir = work_fixtures / set_name
    gen_result = generate(now_utc, set_fixtures_dir)
    generated_incidents = gen_result["incidents"]
    generated_ids = {i["incident_id"] for i in generated_incidents}

    # Resolve seed source directory
    if seed_dir is None:
        env_seed = os.getenv("DEMO_SEED_DIR")
        if env_seed:
            source_seed = Path(env_seed).resolve()
        else:
            source_seed = (REPO_ROOT / "deploy" / "seed" / set_name).resolve()
    else:
        source_seed = Path(seed_dir).resolve()

    if not source_seed.is_dir():
        raise RuntimeError(f"Demo bootstrap failed: seed directory not found: {source_seed}")

    triage_path = source_seed / "incident_triage.json"
    actions_path = source_seed / "response_actions.json"
    intake_path = source_seed / "intake_state.json"
    cases_path = source_seed / "cases.json"

    if not triage_path.is_file():
        raise RuntimeError(f"Demo bootstrap failed: missing seed file: {triage_path}")

    triage_data: dict[str, Any] = json.loads(triage_path.read_text(encoding="utf-8"))
    actions_data: list[dict[str, Any]] = (
        json.loads(actions_path.read_text(encoding="utf-8")) if actions_path.is_file() else []
    )
    intake_data: dict[str, Any] = (
        json.loads(intake_path.read_text(encoding="utf-8"))
        if intake_path.is_file()
        else {"watermark": None, "processed_ids": []}
    )
    cases_data: dict[str, Any] | list[dict[str, Any]] | None = (
        json.loads(cases_path.read_text(encoding="utf-8")) if cases_path.is_file() else None
    )

    # Verify every seeded incident ID exists in the generated set
    seeded_ids: set[str] = set(triage_data.keys())
    for action in actions_data:
        if "incident_id" in action:
            seeded_ids.add(action["incident_id"])
    if cases_data:
        if isinstance(cases_data, dict):
            for case_id in cases_data.keys():
                seeded_ids.add(case_id)
        elif isinstance(cases_data, list):
            for case in cases_data:
                if isinstance(case, dict) and "incident_id" in case:
                    seeded_ids.add(case["incident_id"])

    unknown_ids = sorted(seeded_ids - generated_ids)
    if unknown_ids:
        raise RuntimeError(
            f"Demo bootstrap failed: seeded incident IDs not in generated set {set_name!r}: {unknown_ids}"
        )

    # Rebase timestamps
    from scripts.rebase_runtime_data import compute_rebase

    new_triage, new_actions, _ = compute_rebase(generated_incidents, triage_data, actions_data)

    # Copy / write into work_data / set_name
    set_data_dir = work_data / set_name
    set_data_dir.mkdir(parents=True, exist_ok=True)

    (set_data_dir / "incident_triage.json").write_text(
        json.dumps(new_triage, indent=2) + "\n", encoding="utf-8"
    )
    (set_data_dir / "response_actions.json").write_text(
        json.dumps(new_actions, indent=2) + "\n", encoding="utf-8"
    )
    (set_data_dir / "intake_state.json").write_text(
        json.dumps(intake_data, indent=2) + "\n", encoding="utf-8"
    )
    if cases_data is not None:
        (set_data_dir / "cases.json").write_text(
            json.dumps(cases_data, indent=2) + "\n", encoding="utf-8"
        )

    # Log single summary line (no keys)
    logger.info(
        "Demo bootstrap complete: set=%s, incidents=%d, anchor=%s, work_dir=%s",
        set_name,
        len(generated_incidents),
        gen_result["anchor"],
        work_dir,
    )
