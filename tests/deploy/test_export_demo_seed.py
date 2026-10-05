import json
import shutil
import tempfile
from pathlib import Path

import pytest

from scripts.export_demo_seed import ALLOWED_FILES, export_demo_seed


@pytest.fixture
def tmp_seed_env():
    tmp = Path(tempfile.mkdtemp(prefix="test_export_seed_"))
    source = tmp / "source"
    source.mkdir()
    out = tmp / "out"

    # Minimal valid dataset
    triage = {}
    for i in range(1, 9):
        inc_id = f"inc-100{i}"
        triage[inc_id] = {
            "incident_id": inc_id,
            "verdict": "true_positive",
            "confidence": "high",
            "status": "ok",
            "explain": None,
        }

    (source / "incident_triage.json").write_text(json.dumps(triage, indent=2) + "\n", encoding="utf-8")
    (source / "response_actions.json").write_text("[]\n", encoding="utf-8")
    (source / "intake_state.json").write_text(json.dumps({"watermark": None, "processed_ids": []}) + "\n", encoding="utf-8")
    (source / "cases.json").write_text("[]\n", encoding="utf-8")
    # Add an extra forbidden file that should NOT be exported
    (source / "secret_notes.txt").write_text("do not export me\n", encoding="utf-8")

    yield source, out, tmp
    shutil.rmtree(tmp, ignore_errors=True)


def test_export_copies_only_allowed_files(tmp_seed_env):
    source, out, _ = tmp_seed_env
    rows = export_demo_seed("realistic", source, out)
    assert len(rows) == 8

    # Only allowed files should be copied
    exported_names = set(p.name for p in out.iterdir())
    assert exported_names == set(ALLOWED_FILES)
    assert "secret_notes.txt" not in exported_names


def test_export_refuses_failed_triage(tmp_seed_env):
    source, out, _ = tmp_seed_env
    triage_path = source / "incident_triage.json"
    triage = json.loads(triage_path.read_text(encoding="utf-8"))
    triage["inc-1001"]["status"] = "failed"
    triage_path.write_text(json.dumps(triage), encoding="utf-8")

    with pytest.raises(ValueError) as exc_info:
        export_demo_seed("realistic", source, out)
    assert "failed" in str(exc_info.value)


def test_export_refuses_sk_secret(tmp_seed_env):
    source, out, _ = tmp_seed_env
    triage_path = source / "incident_triage.json"
    triage = json.loads(triage_path.read_text(encoding="utf-8"))
    triage["inc-1001"]["reason"] = "Leak sk-1234567890abcdef"
    triage_path.write_text(json.dumps(triage), encoding="utf-8")

    with pytest.raises(ValueError) as exc_info:
        export_demo_seed("realistic", source, out)
    assert "forbidden token" in str(exc_info.value)


def test_export_is_deterministic(tmp_seed_env):
    source, out1, tmp = tmp_seed_env
    out2 = tmp / "out2"

    export_demo_seed("realistic", source, out1)
    export_demo_seed("realistic", source, out2)

    for f in ALLOWED_FILES:
        p1 = out1 / f
        p2 = out2 / f
        assert p1.read_bytes() == p2.read_bytes()


def test_export_never_writes_outside_out(tmp_seed_env):
    source, out, tmp = tmp_seed_env
    before_parent = set(tmp.iterdir())
    export_demo_seed("realistic", source, out)
    after_parent = set(tmp.iterdir())

    # Only 'out' was added under parent
    assert after_parent - before_parent == {out}

