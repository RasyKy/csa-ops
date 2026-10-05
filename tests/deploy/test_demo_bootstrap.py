import copy
import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import REPO_ROOT, Settings, get_settings
from backend.app.demo_bootstrap import bootstrap_demo
from backend.app.main import create_app
from scripts.rebase_runtime_data import parse_ts


def _hash_tree(root: Path) -> dict[str, str]:
    hashes = {}
    if not root.exists():
        return hashes
    for p in sorted(root.rglob("*")):
        if p.is_file():
            rel = str(p.relative_to(root))
            hashes[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    return hashes


def test_demo_bootstrap_full_lifecycle(monkeypatch):
    # Capture baseline hashes of repo fixtures/ and data/
    repo_fixtures = REPO_ROOT / "fixtures"
    repo_data = REPO_ROOT / "data"
    fixtures_before = _hash_tree(repo_fixtures)
    data_before = _hash_tree(repo_data)

    tmp_parent = Path(tempfile.mkdtemp(prefix="test_demo_boot_"))
    try:
        work_dir = tmp_parent / "work"
        seed_copy_dir = tmp_parent / "seed_copy" / "realistic"
        seed_copy_dir.mkdir(parents=True, exist_ok=True)

        real_seed_dir = REPO_ROOT / "deploy" / "seed" / "realistic"
        for item in real_seed_dir.glob("*.json"):
            shutil.copy2(item, seed_copy_dir / item.name)

        key = "b" * 32
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("STORE_BACKEND", "fixtures")
        monkeypatch.setenv("FIXTURE_SET", "realistic")
        monkeypatch.setenv("DEMO_BOOTSTRAP", "1")
        monkeypatch.setenv("INTAKE_ENABLED", "false")
        monkeypatch.setenv("DEMO_WORK_DIR", str(work_dir))
        monkeypatch.setenv("DEMO_SEED_DIR", str(seed_copy_dir))
        monkeypatch.setenv("DASHBOARD_API_KEY", key)
        get_settings.cache_clear()

        app = create_app()
        with TestClient(app) as client:
            # 1. 8 incidents served
            res = client.get("/incidents", headers={"X-API-Key": key})
            assert res.status_code == 200
            incidents = res.json()
            assert len(incidents) == 8

            now = datetime.now(timezone.utc)

            # 2. Every triage time lands 0 to 10 seconds after its incident's raised time
            for inc in incidents:
                inc_id = inc["incident_id"]
                detail_res = client.get(f"/incidents/{inc_id}", headers={"X-API-Key": key})
                assert detail_res.status_code == 200
                detail = detail_res.json()
                triage = detail.get("triage")
                assert triage is not None, f"Triage missing for {inc_id}"

                raised = parse_ts(inc["incident_raised_time"])
                t_started = parse_ts(triage["triage_started_time"])
                t_time = parse_ts(triage["triage_time"])

                delta_started = (t_started - raised).total_seconds()
                delta_time = (t_time - raised).total_seconds()

                assert 0.0 <= delta_started <= 10.0, f"{inc_id} triage_started delta {delta_started} not in [0, 10]"
                assert 0.0 <= delta_time <= 10.0, f"{inc_id} triage_time delta {delta_time} not in [0, 10]"

            # 3. Newest incident is raised within one hour of now
            newest_inc = max(incidents, key=lambda i: i["incident_raised_time"])
            newest_raised = parse_ts(newest_inc["incident_raised_time"])
            diff_newest = (now - newest_raised).total_seconds()
            assert 0.0 <= diff_newest <= 3600.0, f"Newest incident raised {diff_newest}s ago, not within 1 hour"

            # 4. /metrics/summary?range=24h total_incidents equals incidents raised within 24 hours of now
            cutoff_24h = now - timedelta(hours=24)
            expected_24h = sum(1 for i in incidents if parse_ts(i["incident_raised_time"]) >= cutoff_24h)

            summary_res = client.get("/metrics/summary?range=24h", headers={"X-API-Key": key})
            assert summary_res.status_code == 200
            summary_data = summary_res.json()
            total_inc = summary_data["total_incidents"]["value"] if isinstance(summary_data["total_incidents"], dict) else summary_data["total_incidents"]
            assert total_inc == expected_24h

            # 5. A second bootstrap over the same work dir gives the same result
            bootstrap_demo(get_settings(), seed_dir=seed_copy_dir)
            res2 = client.get("/incidents", headers={"X-API-Key": key})
            assert res2.status_code == 200
            assert len(res2.json()) == 8

        # 6. A seed referencing an unknown incident id aborts startup naming it
        bad_seed_dir = tmp_parent / "bad_seed"
        bad_seed_dir.mkdir(parents=True, exist_ok=True)
        bad_triage = json.loads((seed_copy_dir / "incident_triage.json").read_text(encoding="utf-8"))
        bad_triage["inc-9999"] = {
            "incident_id": "inc-9999",
            "verdict": "true_positive",
            "confidence": "high",
            "status": "ok",
            "triage_started_time": "2026-10-01T00:00:00.000Z",
            "triage_time": "2026-10-01T00:00:01.000Z",
        }
        (bad_seed_dir / "incident_triage.json").write_text(json.dumps(bad_triage), encoding="utf-8")
        shutil.copy2(seed_copy_dir / "response_actions.json", bad_seed_dir / "response_actions.json")
        shutil.copy2(seed_copy_dir / "intake_state.json", bad_seed_dir / "intake_state.json")

        bad_settings = copy.deepcopy(get_settings())
        with pytest.raises(RuntimeError) as exc_info:
            bootstrap_demo(bad_settings, seed_dir=bad_seed_dir)
        assert "inc-9999" in str(exc_info.value)

        # 7. With DEMO_BOOTSTRAP unset, the work dir is never created
        never_dir = tmp_parent / "never_created_work"
        no_boot_settings = Settings(
            demo_bootstrap=False,
            fixture_set="realistic",
            demo_work_dir=str(never_dir),
        )
        bootstrap_demo(no_boot_settings)
        assert not never_dir.exists()

    finally:
        shutil.rmtree(tmp_parent, ignore_errors=True)
        get_settings.cache_clear()

    # 8. Repository fixtures/ and data/ are byte-identical afterwards (sha256)
    fixtures_after = _hash_tree(repo_fixtures)
    data_after = _hash_tree(repo_data)
    assert fixtures_before == fixtures_after
    assert data_before == data_after
