"""Tests for the behavioural baseline (FR8): first-time process and
first-time parent-child activity, per user and host, and round-trip state."""
from engine.detection.baseline import Baseline


def _proc(host, user, image, parent=None, parent_pid=None):
    return {
        "event_type": "process_start", "host": host, "user": user,
        "process_name": image, "parent_process_name": parent,
        "pid": 1, "parent_pid": parent_pid,
    }


def test_first_time_process_then_not():
    b = Baseline()
    first = b.observe(_proc("WS01", "alice", "C:\\x\\powershell.exe"))
    assert first["first_time_process"] is True
    second = b.observe(_proc("WS01", "alice", "C:\\other\\powershell.exe"))
    assert second["first_time_process"] is False  # same exe name, same entity


def test_baseline_is_per_host_and_per_user():
    b = Baseline()
    b.observe(_proc("WS01", "alice", "x\\cmd.exe"))
    # same exe, different host -> first-time again
    assert b.observe(_proc("WS02", "alice", "x\\cmd.exe"))["first_time_process"] is True
    # same exe, same host, different user -> first-time again
    assert b.observe(_proc("WS01", "bob", "x\\cmd.exe"))["first_time_process"] is True


def test_first_time_parent_child_pair():
    b = Baseline()
    r = b.observe(_proc("WS01", "alice", "x\\powershell.exe", parent="x\\winword.exe"))
    assert r["first_time_pair"] is True
    again = b.observe(_proc("WS01", "alice", "x\\powershell.exe", parent="x\\winword.exe"))
    assert again["first_time_pair"] is False


def test_non_process_start_events_change_nothing():
    b = Baseline()
    r = b.observe({"event_type": "network_connection", "host": "WS01", "user": "a"})
    assert r == {"first_time_process": False, "first_time_pair": False}
    assert b.to_state() == {}


def test_state_round_trips():
    b = Baseline()
    b.learn([_proc("WS01", "alice", "x\\cmd.exe", parent="x\\explorer.exe")])
    restored = Baseline(b.to_state())
    # the restored baseline already knows cmd.exe on WS01/alice
    assert restored.seen_process("WS01", "alice", "y\\cmd.exe") is True
    assert restored.observe(_proc("WS01", "alice", "z\\cmd.exe"))["first_time_process"] is False
