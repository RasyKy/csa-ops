"""Live tests for agent/actions/windows.py.

These touch real OS state: they spawn and kill a real process, add and
remove real Windows Firewall rules, and move a real file with ACL changes.

Skipped by default. Run only on a disposable, snapshotted Windows VM,
elevated (Administrator), with:

    $env:CSA_OPS_LIVE_TESTS = "1"
    pytest tests/agent/test_windows_actions.py -m live

The env var is the actual safety gate (it's what keeps these from ever
running in CI or on a real dev machine by accident); -m live is just how
you additionally scope a run to only these tests.
"""
import json
import os
import subprocess
import sys
import time

import pytest

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(sys.platform != "win32", reason="Windows-only actions"),
    pytest.mark.skipif(
        os.environ.get("CSA_OPS_LIVE_TESTS") != "1",
        reason="live tests touch real OS state; set CSA_OPS_LIVE_TESTS=1 on a disposable, "
                "elevated Windows VM to run them (see module docstring)",
    ),
]

psutil = pytest.importorskip("psutil")

from agent.actions import windows  # noqa: E402

TEST_NET_IP = "192.0.2.1"  # RFC 5737 documentation range -- never routable, safe to block


def test_kill_process_terminates_and_reports():
    proc = subprocess.Popen(["notepad.exe"])
    time.sleep(1)
    assert psutil.pid_exists(proc.pid)

    target = {"pids": [proc.pid], "pid_images": {proc.pid: "notepad.exe"}}
    outcome = windows.kill_process(target, live=True)

    proc.wait(timeout=5)
    assert not psutil.pid_exists(proc.pid)
    assert "terminated" in outcome["result"] or "still exiting" in outcome["result"]


def test_kill_process_refuses_on_pid_reuse_mismatch():
    proc = subprocess.Popen(["notepad.exe"])
    time.sleep(1)
    try:
        target = {"pids": [proc.pid], "pid_images": {proc.pid: "not_notepad.exe"}}
        outcome = windows.kill_process(target, live=True)
        assert "refused" in outcome["result"]
        assert psutil.pid_exists(proc.pid)
    finally:
        proc.kill()
        proc.wait(timeout=5)


def test_block_and_unblock_address_roundtrip():
    target = {"remote_ips": [TEST_NET_IP]}
    try:
        block_outcome = windows.block_address(target, live=True)
        assert "refused" not in block_outcome["result"]

        show = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name=CSAOPS_BLOCK_{TEST_NET_IP}"],
            capture_output=True, text=True,
        )
        assert "No rules match" not in show.stdout
    finally:
        unblock_outcome = windows.unblock_address(target, live=True)
        assert "refused" not in unblock_outcome["result"]

        show = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name=CSAOPS_BLOCK_{TEST_NET_IP}"],
            capture_output=True, text=True,
        )
        assert "No rules match" in show.stdout


def test_quarantine_and_restore_file_roundtrip(tmp_path):
    original = tmp_path / "suspicious.txt"
    original.write_text("not actually malware, just a test fixture")

    quarantine_outcome = windows.quarantine_file({"file_paths": [str(original)]}, live=True)
    assert "refused" not in quarantine_outcome["result"]
    assert not original.exists()

    import hashlib
    digest = hashlib.sha256(b"not actually malware, just a test fixture").hexdigest()
    quarantined_path = windows.QUARANTINE_DIR / digest
    sidecar_path = quarantined_path.with_suffix(quarantined_path.suffix + ".json")
    assert quarantined_path.exists()
    assert json.loads(sidecar_path.read_text())["original_path"] == str(original)

    restore_outcome = windows.restore_file({"sha256": digest}, live=True)
    assert "refused" not in restore_outcome["result"]
    assert original.exists()
    assert original.read_text() == "not actually malware, just a test fixture"
    assert not quarantined_path.exists()
