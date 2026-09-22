"""triage_incident(incident) -> IncidentTriage. Registered with the intake
watcher after the response handler. Never raises into the watcher."""
import logging
import os
from datetime import datetime, timezone

from . import llm_client, prompts
from .schemas import IncidentTriage, TriageVerdict

logger = logging.getLogger("csa_ops.ai_explain.triage")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _model_label() -> str:
    return f"{os.getenv('LLM_PROVIDER', 'anthropic')}/{os.getenv('LLM_MODEL', '')}"


def triage_incident(incident: dict, *, store=None) -> IncidentTriage:
    """`store` is optional (and untyped, to keep this module decoupled from
    backend.app.store -- see rule 5) so existing direct-call unit tests keep
    working. The watcher's real call site always passes it: rule 12 requires
    checking incident_triage for an existing record before re-running the
    LLM, rather than relying solely on the watcher's shared processed-set.
    """
    incident_id = incident["incident_id"]

    if store is not None:
        existing = store.get_triage(incident_id)
        if existing is not None:
            logger.info("incident %s already has a triage record; skipping re-triage", incident_id)
            return IncidentTriage(**existing)

    model_label = _model_label()

    try:
        verdict = llm_client.complete(
            system=prompts.TRIAGE_SYSTEM_PROMPT,
            user=prompts.build_triage_user_prompt(incident),
            schema=TriageVerdict,
        )
    except Exception:
        logger.exception("triage failed for incident %s", incident_id)
        return IncidentTriage(
            incident_id=incident_id, triage_time=_now(), model=model_label, status="failed",
        )

    return IncidentTriage(
        incident_id=incident_id,
        triage_time=_now(),
        verdict=verdict.verdict,
        confidence=verdict.confidence,
        reason=verdict.reason,
        model=model_label,
        status="ok",
    )
