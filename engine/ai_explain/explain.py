"""explain_incident(incident, triage) -> Explain. Called only from
POST /ai/explain/{id}. The router caches the result on the triage doc;
this function itself does no caching or storage."""
import json
from datetime import datetime, timezone

from . import grounding, llm_client, prompts
from .schemas import Explain, ExplainContent


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def explain_incident(incident: dict, triage: dict, response_actions: list[dict] | None = None) -> Explain:
    content = llm_client.complete(
        system=prompts.EXPLAIN_SYSTEM_PROMPT,
        user=prompts.build_explain_user_prompt(incident, triage, response_actions),
        schema=ExplainContent,
    )

    # Grounding check: does the explanation mention anything (an IP, PID,
    # hostname, file path) that isn't anywhere in what the model was given?
    # Compared against the same data it actually saw, not a fresh
    # re-serialization, so this can't drift from the real prompt content.
    source_text = json.dumps(incident) + json.dumps(triage) + json.dumps(response_actions or [])
    explain_text = "\n".join([
        content.summary, content.objective,
        *content.notable_details, *content.next_steps, *content.caveats,
    ])
    ungrounded = grounding.find_ungrounded(explain_text, source_text)

    return Explain(
        **content.model_dump(),
        generated_time=_now(),
        ungrounded_mentions=ungrounded,
        prompt_version=prompts.EXPLAIN_PROMPT_VERSION,
    )


def annotate_staleness(triage: dict) -> dict:
    """Adds a computed (never persisted) is_stale flag to a triage dict's
    explain sub-document, if it has one. is_stale is recomputed on every
    call against the current prompts.EXPLAIN_PROMPT_VERSION, so bumping
    that constant instantly marks every existing cached explain as stale
    with no migration -- callers (backend/app/routers/ai.py,
    backend/app/routers/incidents.py) apply this to every triage dict
    before returning it to the dashboard."""
    explain = triage.get("explain")
    if explain is None:
        return triage
    is_stale = explain.get("prompt_version") != prompts.EXPLAIN_PROMPT_VERSION
    return {**triage, "explain": {**explain, "is_stale": is_stale}}
