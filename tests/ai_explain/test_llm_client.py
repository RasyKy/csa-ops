"""llm_client.complete() -- provider dispatch, base_url override, and the
schema-validation boundary. Uses monkeypatched httpx.post; no real network
calls or API keys."""
import httpx
import pytest

from engine.ai_explain import llm_client
from engine.ai_explain.schemas import TriageVerdict


def _fake_response(json_body: dict) -> httpx.Response:
    return httpx.Response(200, json=json_body, request=httpx.Request("POST", "http://fake"))


def test_openai_compatible_provider_uses_base_url_override(monkeypatch):
    # This is the DeepSeek case: LLM_PROVIDER=openai (the wire format) with
    # LLM_BASE_URL pointed at a different OpenAI-compatible provider.
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return _fake_response({
            "choices": [{"message": {
                "content": '{"verdict": "true_positive", "confidence": "high", "reason": "clear"}'
            }}],
        })

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "deepseek-chat")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.deepseek.com")

    result = llm_client.complete("system prompt", "user prompt", TriageVerdict)

    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["json"]["model"] == "deepseek-chat"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert result.verdict == "true_positive"


def test_anthropic_provider_sends_a_generous_max_tokens(monkeypatch):
    # Regression: max_tokens was hardcoded to 1024, shared between triage's
    # tiny schema and explain's much larger one (summary, objective,
    # notable_details[], next_steps[], caveats[]) -- risking silent
    # truncation into invalid JSON for a verbose explain response. No test
    # exercised the Anthropic path at all before this.
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured["url"] = url
        captured["json"] = json
        return _fake_response({
            "content": [{"type": "text", "text": '{"verdict": "true_positive", "confidence": "high", "reason": "clear"}'}],
        })

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("LLM_MODEL", "claude-sonnet")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    result = llm_client.complete("system prompt", "user prompt", TriageVerdict)

    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    assert captured["json"]["max_tokens"] >= 4096
    assert result.verdict == "true_positive"


def test_openai_provider_defaults_to_real_openai_base_url(monkeypatch):
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured["url"] = url
        return _fake_response({
            "choices": [{"message": {
                "content": '{"verdict": "needs_review", "confidence": "low", "reason": "unclear"}'
            }}],
        })

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    llm_client.complete("s", "u", TriageVerdict)

    assert captured["url"] == "https://api.openai.com/v1/chat/completions"


def test_unknown_provider_raises_llm_error(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "not-a-real-provider")
    monkeypatch.setenv("LLM_MODEL", "x")
    monkeypatch.setenv("LLM_API_KEY", "x")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    with pytest.raises(llm_client.LLMError):
        llm_client.complete("s", "u", TriageVerdict)


def test_invalid_json_response_raises_llm_error(monkeypatch):
    def fake_post(url, *, headers, json, timeout):
        return _fake_response({"choices": [{"message": {"content": "not valid json"}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "x")
    monkeypatch.setenv("LLM_API_KEY", "x")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    with pytest.raises(llm_client.LLMError):
        llm_client.complete("s", "u", TriageVerdict)


def test_output_failing_schema_validation_raises_llm_error(monkeypatch):
    def fake_post(url, *, headers, json, timeout):
        # Valid JSON, but "verdict" isn't one of the allowed enum values.
        return _fake_response({
            "choices": [{"message": {
                "content": '{"verdict": "definitely_malicious", "confidence": "high", "reason": "x"}'
            }}],
        })

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "x")
    monkeypatch.setenv("LLM_API_KEY", "x")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    with pytest.raises(llm_client.LLMError):
        llm_client.complete("s", "u", TriageVerdict)


def test_timeout_retries_once_then_raises(monkeypatch):
    calls = {"n": 0}

    def fake_post(url, *, headers, json, timeout):
        calls["n"] += 1
        raise httpx.TimeoutException("boom", request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "x")
    monkeypatch.setenv("LLM_API_KEY", "x")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "1")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    with pytest.raises(llm_client.LLMError):
        llm_client.complete("s", "u", TriageVerdict)

    assert calls["n"] == 2  # original attempt + one retry, then raise
