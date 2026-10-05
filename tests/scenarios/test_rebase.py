"""scripts/rebase_runtime_data.py: align triage and response timestamps with
incident times without touching anything else."""
import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest

from scripts.generate_scenarios import generate
from scripts.rebase_runtime_data import ACTION_FIELDS, TRIAGE_FIELDS, main, parse_ts

SET = "realistic"


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


@pytest.fixture
def sample(tmp_path):
    """Fixture-shaped runtime data written the way the store writes it, dated
    days after the incidents like a real wall-clock intake run would be."""
    fixtures_root, data_root = tmp_path / "fixtures", tmp_path / "data"
    generated = generate("2026-10-04T12:00:00.000Z", fixtures_root / SET)
    wall_clock = datetime(2026, 10, 9, 8, 30, 0, 123000, tzinfo=timezone.utc)

    triage, actions = {}, []
    for n, incident in enumerate(generated["incidents"]):
        started = wall_clock + timedelta(minutes=n, milliseconds=17 * n)
        triage[incident["incident_id"]] = {
            "incident_id": incident["incident_id"],
            "triage_time": _iso(started + timedelta(milliseconds=1700 + 111 * n)),
            "triage_started_time": _iso(started),
            "verdict": "likely_true_positive",
            "confidence": "high",
            "reason": "sample",
            "model": "test/none",
            "status": "ok",
            "explain": {"summary": "s", "generated_time": "2026-10-09T09:00:00.000Z"},
        }
        issued = started - timedelta(milliseconds=2)
        actions.append({
            "action_id": f"act-{n}", "incident_id": incident["incident_id"], "host": incident["host"],
            "action": "log", "mode": "dry_run", "status": "executed",
            "command_issued_time": _iso(issued),
            "agent_received_time": _iso(issued + timedelta(milliseconds=2345)),
            "response_executed_time": _iso(issued + timedelta(milliseconds=3145)),
            "result": "ok",
        })
    manual_for = generated["incidents"][0]["incident_id"]
    manual_issued = wall_clock + timedelta(hours=2)
    actions.append({
        "action_id": "act-manual", "incident_id": manual_for, "host": generated["incidents"][0]["host"],
        "action": "unblock_address", "mode": "dry_run", "status": "issued",
        "command_issued_time": _iso(manual_issued), "agent_received_time": None,
        "response_executed_time": None, "result": None,
    })

    data_dir = data_root / SET
    data_dir.mkdir(parents=True)
    (data_dir / "incident_triage.json").write_text(json.dumps(triage))
    (data_dir / "response_actions.json").write_text(json.dumps(actions))
    (data_dir / "intake_state.json").write_text(json.dumps({"watermark": None, "processed_ids": []}))
    (data_root / "incident_triage.json").write_text(json.dumps({"untouched": True}))
    return {"fixtures_root": fixtures_root, "data_root": data_root, "data_dir": data_dir, "incidents": generated["incidents"]}


def _args(sample, *extra, set_name=SET):
    return ["--set", set_name, "--data-root", str(sample["data_root"]), "--fixture-root", str(sample["fixtures_root"]), *extra]


def _snapshot(path):
    return {p.relative_to(path).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(path.rglob("*")) if p.is_file()}


def _load(sample):
    return (
        json.loads((sample["data_dir"] / "incident_triage.json").read_text()),
        json.loads((sample["data_dir"] / "response_actions.json").read_text()),
    )


def _seconds(a: str, b: str) -> float:
    return (parse_ts(a) - parse_ts(b)).total_seconds()


def test_dry_run_changes_nothing_and_prints_a_table(sample, capsys):
    before = _snapshot(sample["data_root"])
    assert main(_args(sample)) == 0
    assert _snapshot(sample["data_root"]) == before
    out = capsys.readouterr().out
    assert "dry run, nothing written" in out
    for incident in sample["incidents"]:
        assert incident["incident_id"] in out
    print("\n" + out)


def test_write_lands_within_ten_seconds_after_raised_and_keeps_latencies(sample):
    triage_before, actions_before = _load(sample)
    assert main(_args(sample, "--write")) == 0
    triage_after, actions_after = _load(sample)
    raised = {i["incident_id"]: i["incident_raised_time"] for i in sample["incidents"]}

    for incident_id, record in triage_after.items():
        old = triage_before[incident_id]
        gap = _seconds(record["triage_started_time"], raised[incident_id])
        assert gap == 3.0
        assert 0 < _seconds(record["triage_time"], raised[incident_id]) <= 10
        assert _seconds(record["triage_time"], record["triage_started_time"]) == _seconds(
            old["triage_time"], old["triage_started_time"]
        )

    by_incident_before, by_incident_after = {}, {}
    for old, new in zip(actions_before, actions_after):
        by_incident_before.setdefault(old["incident_id"], []).append(old)
        by_incident_after.setdefault(new["incident_id"], []).append(new)
    for incident_id, group in by_incident_after.items():
        first_new = min(a["command_issued_time"] for a in group)
        assert _seconds(first_new, raised[incident_id]) == 4.0
        for old, new in zip(by_incident_before[incident_id], group):
            assert _seconds(new["command_issued_time"], old["command_issued_time"]) == _seconds(
                group[0]["command_issued_time"], by_incident_before[incident_id][0]["command_issued_time"]
            )
            for left, right in (("agent_received_time", "command_issued_time"), ("response_executed_time", "agent_received_time")):
                if old[left]:
                    assert _seconds(new[left], new[right]) == _seconds(old[left], old[right])
        for action in group:
            if action["action_id"] != "act-manual":
                assert 0 < _seconds(action["response_executed_time"], raised[incident_id]) <= 10


def test_only_the_listed_timestamp_fields_change(sample):
    triage_before, actions_before = _load(sample)
    main(_args(sample, "--write"))
    triage_after, actions_after = _load(sample)

    assert list(triage_after) == list(triage_before)
    for incident_id, old in triage_before.items():
        new = triage_after[incident_id]
        assert list(new) == list(old)
        assert {k: v for k, v in new.items() if k not in TRIAGE_FIELDS} == {
            k: v for k, v in old.items() if k not in TRIAGE_FIELDS
        }
        assert new["explain"]["generated_time"] == old["explain"]["generated_time"]
    assert [a["action_id"] for a in actions_after] == [a["action_id"] for a in actions_before]
    for old, new in zip(actions_before, actions_after):
        assert list(new) == list(old)
        assert {k: v for k, v in new.items() if k not in ACTION_FIELDS} == {
            k: v for k, v in old.items() if k not in ACTION_FIELDS
        }
        for field in ACTION_FIELDS:
            assert (new[field] is None) == (old[field] is None)
    text = (sample["data_dir"] / "response_actions.json").read_text()
    assert "\n" not in text, "compact store format is preserved"


def test_only_files_under_data_name_are_written(sample):
    before = _snapshot(sample["data_root"])
    fixtures_before = _snapshot(sample["fixtures_root"])
    main(_args(sample, "--write"))
    after = _snapshot(sample["data_root"])
    changed = {name for name in after if after[name] != before.get(name)}
    assert changed and all(name.startswith(f"{SET}/") for name in changed)
    assert after["incident_triage.json"] == before["incident_triage.json"]
    assert f"{SET}/intake_state.json" not in changed
    assert _snapshot(sample["fixtures_root"]) == fixtures_before


def test_idempotent(sample):
    main(_args(sample, "--write"))
    once = _snapshot(sample["data_root"])
    assert main(_args(sample, "--write")) == 0
    assert _snapshot(sample["data_root"]) == once


@pytest.mark.parametrize("name", ["default", "", "Bad Name", "../x"])
def test_refuses_default_and_invalid_names(sample, name, capsys):
    before = _snapshot(sample["data_root"])
    assert main(_args(sample, "--write", set_name=name)) == 2
    assert _snapshot(sample["data_root"]) == before
    assert "error:" in capsys.readouterr().err
