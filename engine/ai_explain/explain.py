"""explain_incident(incident, triage) -> Explain. Called only from
POST /ai/explain/{id}. The router caches the result on the triage doc;
this function itself does no caching or storage."""
from datetime import datetime, timezone

from . import llm_client, prompts
from .schemas import Explain, ExplainContent


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def explain_incident(incident: dict, triage: dict) -> Explain:
    content = llm_client.complete(
        system=prompts.EXPLAIN_SYSTEM_PROMPT,
        user=prompts.build_explain_user_prompt(incident, triage),
        schema=ExplainContent,
    )
    return Explain(**content.model_dump(), generated_time=_now())
