"""Behavioural baselines per user and host (FR8).

Remembers which processes, and which parent->child process pairs, have been
seen before for each (host, user). The first time a process or a parent-child
pair appears it is "first-time activity" and is flagged; every later
occurrence is not. This is deliberately simple frequency memory, not
statistics -- enough to surface "this host has never run this before", which
is the FR8 requirement.

State is a plain dict and serialises to JSON, so a baseline learned from a
window of benign traffic can be saved and reused (this is what the FR21
false-positive replay does: learn on benign data, then measure).
"""
from __future__ import annotations

from typing import Optional


def _norm(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _proc(image: Optional[str]) -> str:
    """Reduce a full image path to its executable name, lowercased, so
    C:\\Windows\\System32\\cmd.exe and cmd.exe baseline as the same process."""
    image = _norm(image)
    return image.replace("/", "\\").rsplit("\\", 1)[-1]


class Baseline:
    def __init__(self, state: Optional[dict] = None):
        state = state or {}
        # {"host\x1fuser": {"processes": [...], "pairs": ["parent>child", ...]}}
        self._by_entity: dict[str, dict[str, set]] = {}
        for entity, seen in state.items():
            self._by_entity[entity] = {
                "processes": set(seen.get("processes", [])),
                "pairs": set(seen.get("pairs", [])),
            }

    @staticmethod
    def _entity(host: Optional[str], user: Optional[str]) -> str:
        return f"{_norm(host)}\x1f{_norm(user)}"

    def _bucket(self, host, user) -> dict[str, set]:
        return self._by_entity.setdefault(
            self._entity(host, user), {"processes": set(), "pairs": set()}
        )

    def seen_process(self, host, user, image) -> bool:
        return _proc(image) in self._bucket(host, user)["processes"]

    def seen_pair(self, host, user, parent_image, child_image) -> bool:
        pair = f"{_proc(parent_image)}>{_proc(child_image)}"
        return pair in self._bucket(host, user)["pairs"]

    def observe(self, event: dict) -> dict:
        """Record a process_start event and report what was first-time about it.

        Returns {"first_time_process": bool, "first_time_pair": bool}. Only
        process_start events carry a parent-child pair; other event types just
        return both False and change nothing."""
        result = {"first_time_process": False, "first_time_pair": False}
        if event.get("event_type") != "process_start":
            return result

        host, user = event.get("host"), event.get("user")
        image = event.get("process_name")
        parent = event.get("parent_process_name")
        bucket = self._bucket(host, user)

        proc = _proc(image)
        if proc and proc not in bucket["processes"]:
            result["first_time_process"] = True
            bucket["processes"].add(proc)

        if parent:
            pair = f"{_proc(parent)}>{proc}"
            if pair not in bucket["pairs"]:
                result["first_time_pair"] = True
                bucket["pairs"].add(pair)

        return result

    def learn(self, events) -> "Baseline":
        """Observe a sequence of (benign) events to warm the baseline."""
        for event in events:
            self.observe(event)
        return self

    def to_state(self) -> dict:
        return {
            entity: {
                "processes": sorted(seen["processes"]),
                "pairs": sorted(seen["pairs"]),
            }
            for entity, seen in self._by_entity.items()
        }
