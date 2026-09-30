"""explain_incident()'s prompt-version stamp, and annotate_staleness()'s
pure staleness computation -- no real LLM call in either case."""
from engine.ai_explain import explain, prompts
from engine.ai_explain.schemas import ExplainContent

INCIDENT = {"incident_id": "inc-test", "host": "WS01"}
TRIAGE = {"incident_id": "inc-test", "verdict": "true_positive"}


def test_explain_incident_stamps_current_prompt_version(monkeypatch):
    monkeypatch.setattr(
        explain.llm_client, "complete",
        lambda system, user, schema: ExplainContent(
            summary="s", objective="o", notable_details=[], next_steps=[], caveats=[]
        ),
    )

    result = explain.explain_incident(INCIDENT, TRIAGE)

    assert result.prompt_version == prompts.EXPLAIN_PROMPT_VERSION


def test_annotate_staleness_flags_none_version_as_stale():
    triage = {"explain": {"summary": "s", "prompt_version": None}}
    assert explain.annotate_staleness(triage)["explain"]["is_stale"] is True


def test_annotate_staleness_flags_older_version_as_stale():
    triage = {"explain": {"summary": "s", "prompt_version": prompts.EXPLAIN_PROMPT_VERSION - 1}}
    assert explain.annotate_staleness(triage)["explain"]["is_stale"] is True


def test_annotate_staleness_flags_current_version_as_not_stale():
    triage = {"explain": {"summary": "s", "prompt_version": prompts.EXPLAIN_PROMPT_VERSION}}
    assert explain.annotate_staleness(triage)["explain"]["is_stale"] is False


def test_annotate_staleness_is_a_noop_without_an_explain():
    triage = {"incident_id": "inc-test", "explain": None}
    assert explain.annotate_staleness(triage) == triage


def test_annotate_staleness_does_not_mutate_the_original_dict():
    original_explain = {"summary": "s", "prompt_version": None}
    triage = {"explain": original_explain}
    explain.annotate_staleness(triage)
    assert "is_stale" not in original_explain
