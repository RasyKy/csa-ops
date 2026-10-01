"""Tests for the entity linker and chain builder (FR9)."""
from engine.correlation.linker import build_chain, cluster_events


def _ev(event_id, pid, ppid, etype="process_start", host="WS01", ts="2026-09-20T09:00:00.000Z", **extra):
    return {"event_id": event_id, "pid": pid, "parent_pid": ppid, "event_type": etype,
            "host": host, "timestamp": ts, "process_name": f"proc{pid}.exe", **extra}


def test_parent_child_links_into_one_cluster():
    events = [_ev("a", 100, 4), _ev("b", 200, 100), _ev("c", 300, 200)]
    clusters = cluster_events(events)
    assert len(clusters) == 1
    assert {e["event_id"] for e in clusters[0]} == {"a", "b", "c"}


def test_unrelated_pids_are_separate_clusters():
    events = [_ev("a", 100, 4), _ev("b", 999, 5)]
    assert len(cluster_events(events)) == 2


def test_different_hosts_never_link():
    events = [_ev("a", 100, 4, host="WS01"), _ev("b", 200, 100, host="WS02")]
    assert len(cluster_events(events)) == 2


def test_resource_event_links_by_shared_pid():
    events = [_ev("p", 100, 4, etype="process_start"),
              _ev("n", 100, 4, etype="network_connection", dest_ip="1.2.3.4")]
    assert len(cluster_events(events)) == 1


def test_time_window_excludes_far_apart_events():
    events = [_ev("a", 100, 4, ts="2026-09-20T09:00:00.000Z"),
              _ev("b", 200, 100, ts="2026-09-20T10:00:00.000Z")]  # 1h apart
    assert len(cluster_events(events, window_seconds=300)) == 2


def test_build_chain_edges():
    events = [
        _ev("p", 100, 4, etype="process_start"),
        _ev("c", 200, 100, etype="process_start"),
        _ev("f", 200, 100, etype="file_event", file_path="C:\\x.exe"),
    ]
    alerts_by_id = {"c": {"technique": "T1105", "rule_id": "r"}}
    chain = build_chain(events, alerts_by_id)
    assert len(chain["nodes"]) == 3
    parent_edge = {"from": "p", "to": "c", "relation": "parent"}
    file_edge = {"from": "c", "to": "f", "relation": "file"}
    assert parent_edge in chain["edges"]
    assert file_edge in chain["edges"]
    triggered = next(n for n in chain["nodes"] if n["event_id"] == "c")
    assert triggered["technique"] == "T1105" and triggered["rule_id"] == "r"
