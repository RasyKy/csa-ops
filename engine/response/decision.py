"""Loads policy.yaml. decide(incident) -> Decision | None."""
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

POLICY_PATH = Path(__file__).parent / "policy.yaml"


@dataclass
class Decision:
    action: str
    target: dict
    policy_rule: str


def load_policy(path: Path = POLICY_PATH) -> dict:
    return yaml.safe_load(path.read_text())


def never_auto_actions(policy: Optional[dict] = None) -> set:
    policy = policy or load_policy()
    return set(policy.get("never_auto", []))


def all_actions(policy: Optional[dict] = None) -> set:
    policy = policy or load_policy()
    actions = set(policy.get("by_severity", {}).values())
    actions |= set(policy.get("by_scenario", {}).values())
    actions |= set(policy.get("never_auto", []))
    return actions


def _pid_image_map(incident: dict) -> dict:
    """pid -> image for every chain node that has both. Lets kill_process's
    PID-reuse guard (Phase 4) verify the process it's about to kill is still
    the one that triggered the incident, without incident.targets itself
    needing to carry image names."""
    return {
        n["pid"]: n["image"]
        for n in incident.get("chain", {}).get("nodes", [])
        if n.get("pid") is not None and n.get("image")
    }


def _derive_target(incident: dict) -> dict:
    targets = incident.get("targets") or {}
    if targets.get("pids") or targets.get("remote_ips") or targets.get("file_paths"):
        result = dict(targets)
    else:
        # targets missing/empty: best-effort fallback from chain.nodes. The chain
        # node schema (docs/interfaces.md 4.3) only carries pid/ppid, not dest_ip
        # or file_path, so only pids can actually be recovered this way.
        pids = [n["pid"] for n in incident.get("chain", {}).get("nodes", []) if n.get("pid") is not None]
        result = {"pids": pids, "remote_ips": [], "file_paths": []}

    result["pid_images"] = _pid_image_map(incident)
    return result


def decide(incident: dict, policy: Optional[dict] = None) -> Optional[Decision]:
    policy = policy or load_policy()
    severity = incident.get("severity")
    scenario = incident.get("matched_scenario")

    action = None
    rule = None
    if scenario and scenario in policy.get("by_scenario", {}):
        action = policy["by_scenario"][scenario]
        rule = f"by_scenario:{scenario}"
    elif severity in policy.get("by_severity", {}):
        action = policy["by_severity"][severity]
        rule = f"by_severity:{severity}"

    if action is None:
        return None

    return Decision(action=action, target=_derive_target(incident), policy_rule=rule)
