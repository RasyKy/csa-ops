"""handle_incident(incident): kill switch check, mode resolution, decision, write response_actions, enqueue for the host."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from . import decision as decision_module
from .safety import KillSwitch, resolve_mode

logger = logging.getLogger("csa_ops.response.commander")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def handle_incident(incident: dict, *, store, settings) -> Optional[dict]:
    """Registered with the intake watcher. Fixed safety order: kill switch, mode, decision (rule 3.1).

    Idempotency guard runs first, ahead of that order: the watcher's shared
    processed-set is not the only defense against re-acting on an incident
    (rule 12). A processed-set reset (e.g. clearing intake_state to re-test
    triage) must not cause a second automatic action -- including a second
    blocked_by_kill_switch doc -- for an incident already handled.
    """
    incident_id = incident["incident_id"]
    existing = store.list_response_actions(incident_id)
    if existing:
        logger.info(
            "incident %s already has a response_actions record (action_id=%s); "
            "skipping automatic re-dispatch",
            incident_id, existing[-1].get("action_id"),
        )
        return existing[-1]

    host = incident["host"]
    kill_switch = KillSwitch(settings.kill_switch_path)

    if kill_switch.is_set():
        doc = _blocked_doc(incident, host)
        store.save_response_action(doc)
        logger.warning("kill switch active; blocked response for incident %s", incident["incident_id"])
        return doc

    mode = resolve_mode(settings.response_live, settings.response_live_hosts, host)

    dec = decision_module.decide(incident)
    if dec is None:
        return None

    if dec.action in decision_module.never_auto_actions():
        logger.error(
            "policy misconfiguration: %s is never_auto but was selected automatically for incident %s; "
            "refusing to dispatch",
            dec.action, incident["incident_id"],
        )
        return None

    doc = _issue_doc(incident, host, dec.action, dec.target, dec.policy_rule, mode)
    store.save_response_action(doc)
    logger.info("issued %s (mode=%s) for incident %s", dec.action, mode, incident["incident_id"])
    return doc


def issue_manual_action(*, store, settings, incident: dict, action: str, target: dict) -> dict:
    """POST /response/actions. The only path allowed to issue never_auto actions. Still subject to kill switch and mode."""
    host = incident["host"]
    kill_switch = KillSwitch(settings.kill_switch_path)

    if kill_switch.is_set():
        doc = _blocked_doc(incident, host)
        store.save_response_action(doc)
        return doc

    mode = resolve_mode(settings.response_live, settings.response_live_hosts, host)
    doc = _issue_doc(incident, host, action, target, policy_rule="manual", mode=mode)
    store.save_response_action(doc)
    return doc


def _issue_doc(incident: dict, host: str, action: str, target: dict, policy_rule: str, mode: str) -> dict:
    return {
        "action_id": str(uuid.uuid4()),
        "incident_id": incident["incident_id"],
        "host": host,
        "action": action,
        "target": target,
        "decided_by": {
            "severity": incident.get("severity"),
            "matched_scenario": incident.get("matched_scenario"),
            "policy_rule": policy_rule,
        },
        "mode": mode,
        "status": "issued",
        "command_issued_time": _now(),
        "agent_received_time": None,
        "response_executed_time": None,
        "result": None,
    }


def _blocked_doc(incident: dict, host: str) -> dict:
    return {
        "action_id": str(uuid.uuid4()),
        "incident_id": incident["incident_id"],
        "host": host,
        "action": None,
        "target": None,
        "decided_by": None,
        "mode": None,
        "status": "blocked_by_kill_switch",
        "command_issued_time": _now(),
        "agent_received_time": None,
        "response_executed_time": None,
        "result": "blocked by kill switch before a decision was made",
    }
