"""Entity linker and attack-chain graph builder (FR9).

Given a set of normalized events, links those that belong to the same activity
by shared host and process lineage (pid / parent_pid), within a time window,
and builds the {nodes, edges} chain shape from docs/interfaces.md 4.3.

Two events link when they share a host and either:
  * one is the parent of the other (A.pid == B.parent_pid), or
  * they share the same pid (a process and the network/file/registry events it
    produced),
and their timestamps fall within `window_seconds` of each other.

Clustering is the connected components of that link graph. A component is an
incident candidate only if it contains at least one event that triggered a
rule -- benign lineage on its own never raises an incident.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

# event_type -> chain edge relation for a resource event hung off its process.
_RESOURCE_RELATION = {
    "network_connection": "network",
    "file_event": "file",
    "registry_event": "registry",
}


def _parse(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def _within_window(a: dict, b: dict, window_seconds: float) -> bool:
    ta, tb = _parse(a.get("timestamp")), _parse(b.get("timestamp"))
    if ta is None or tb is None:
        return True  # missing timestamps: don't let time exclude a real lineage link
    return abs((ta - tb).total_seconds()) <= window_seconds


def _linked(a: dict, b: dict, window_seconds: float) -> bool:
    if a.get("host") != b.get("host"):
        return False
    if not _within_window(a, b, window_seconds):
        return False
    a_pid, b_pid = a.get("pid"), b.get("pid")
    a_ppid, b_ppid = a.get("parent_pid"), b.get("parent_pid")
    if a_pid is not None and a_pid == b_pid:
        return True
    if a_pid is not None and a_pid == b_ppid:
        return True
    if b_pid is not None and b_pid == a_ppid:
        return True
    return False


class _UnionFind:
    def __init__(self, n: int):
        self._parent = list(range(n))

    def find(self, i: int) -> int:
        while self._parent[i] != i:
            self._parent[i] = self._parent[self._parent[i]]
            i = self._parent[i]
        return i

    def union(self, i: int, j: int) -> None:
        ri, rj = self.find(i), self.find(j)
        if ri != rj:
            self._parent[ri] = rj


def cluster_events(events: list[dict], window_seconds: float = 300) -> list[list[dict]]:
    """Partition events into linked clusters (connected components)."""
    uf = _UnionFind(len(events))
    for i in range(len(events)):
        for j in range(i + 1, len(events)):
            if _linked(events[i], events[j], window_seconds):
                uf.union(i, j)

    groups: dict[int, list[dict]] = {}
    for idx, event in enumerate(events):
        groups.setdefault(uf.find(idx), []).append(event)
    return list(groups.values())


def build_chain(events: list[dict], alerts_by_event_id: dict[str, dict]) -> dict:
    """Build the {nodes, edges} chain (interfaces.md 4.3) for one cluster.

    A node's technique/rule_id are set when that event triggered a rule. Edges
    are parent links (pid lineage) plus resource links (a process to the
    network/file/registry event it produced)."""
    ordered = sorted(events, key=lambda e: (e.get("timestamp") or "", str(e.get("event_id"))))
    nodes = [_node(e, alerts_by_event_id.get(e.get("event_id"))) for e in ordered]

    by_pid_process: dict = {}
    for e in ordered:
        if e.get("event_type") == "process_start" and e.get("pid") is not None:
            by_pid_process.setdefault((e.get("host"), e.get("pid")), e)

    edges: list[dict] = []
    seen: set = set()
    for e in ordered:
        eid = e.get("event_id")
        # parent link: the process_start whose pid is this event's parent_pid
        parent = by_pid_process.get((e.get("host"), e.get("parent_pid")))
        if parent is not None and parent.get("event_id") != eid:
            _add_edge(edges, seen, parent.get("event_id"), eid, "parent")
        # resource link: a non-process event hung off its own process_start
        relation = _RESOURCE_RELATION.get(e.get("event_type"))
        if relation is not None:
            proc = by_pid_process.get((e.get("host"), e.get("pid")))
            if proc is not None and proc.get("event_id") != eid:
                _add_edge(edges, seen, proc.get("event_id"), eid, relation)

    return {"nodes": nodes, "edges": edges}


def _node(event: dict, alert: Optional[dict]) -> dict:
    return {
        "event_id": event.get("event_id"),
        "pid": event.get("pid"),
        "ppid": event.get("parent_pid"),
        "image": event.get("process_name"),
        "command_line": event.get("command_line"),
        "timestamp": event.get("timestamp"),
        "technique": alert.get("technique") if alert else None,
        "rule_id": alert.get("rule_id") if alert else None,
    }


def _add_edge(edges: list, seen: set, frm, to, relation: str) -> None:
    key = (frm, to, relation)
    if frm is None or to is None or key in seen:
        return
    seen.add(key)
    edges.append({"from": frm, "to": to, "relation": relation})
