"""Provider-agnostic complete(system, user, schema) -> BaseModel.

Provider selected by LLM_PROVIDER (anthropic | openai | ollama), model by
LLM_MODEL, key by LLM_API_KEY. LLM_BASE_URL overrides the provider's default
endpoint -- e.g. DeepSeek exposes an OpenAI-compatible chat/completions API
at https://api.deepseek.com, so LLM_PROVIDER=openai + LLM_BASE_URL=that
works unmodified against DeepSeek's models.

Plain httpx, no provider SDK dependency. Timeout is LLM_TIMEOUT_SECONDS,
one retry on timeout, then raise. Output is untrusted text (CLAUDE.md rule
9) until it passes pydantic validation against `schema`: invalid JSON or a
schema mismatch raises immediately, no retry.
"""
import logging
import os
from typing import TypeVar

import httpx
from pydantic import BaseModel

logger = logging.getLogger("csa_ops.ai_explain.llm_client")

T = TypeVar("T", bound=BaseModel)

_DEFAULT_BASE_URLS = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com/v1",
    "ollama": "http://localhost:11434",
}


class LLMError(Exception):
    """Raised on timeout (after one retry), transport failure, invalid JSON,
    or schema validation failure. Callers (triage.py, explain.py) must
    handle this -- it is never allowed to propagate into the watcher."""


def complete(system: str, user: str, schema: type[T]) -> T:
    provider = os.getenv("LLM_PROVIDER", "anthropic")
    model = os.getenv("LLM_MODEL", "")
    api_key = os.getenv("LLM_API_KEY", "")
    base_url = os.getenv("LLM_BASE_URL", "") or _DEFAULT_BASE_URLS.get(provider, "")
    timeout_seconds = float(os.getenv("LLM_TIMEOUT_SECONDS", "20"))

    try:
        raw_text = _call_with_retry(provider, system, user, model, api_key, base_url, timeout_seconds)
    except httpx.HTTPError as exc:
        raise LLMError(f"{provider} request failed: {exc}") from exc

    try:
        return schema.model_validate_json(raw_text)
    except Exception as exc:
        raise LLMError(f"{provider} returned output that failed schema validation: {exc}") from exc


def _call_with_retry(provider, system, user, model, api_key, base_url, timeout_seconds) -> str:
    last_exc: httpx.TimeoutException
    for attempt in range(2):  # original attempt + one retry, timeout only
        try:
            return _dispatch(provider, system, user, model, api_key, base_url, timeout_seconds)
        except httpx.TimeoutException as exc:
            last_exc = exc
            logger.warning("%s request timed out (attempt %d/2)", provider, attempt + 1)
    raise last_exc


def _dispatch(provider, system, user, model, api_key, base_url, timeout_seconds) -> str:
    if provider == "anthropic":
        return _call_anthropic(system, user, model, api_key, base_url, timeout_seconds)
    if provider == "openai":
        return _call_openai_compatible(system, user, model, api_key, base_url, timeout_seconds)
    if provider == "ollama":
        return _call_ollama(system, user, model, base_url, timeout_seconds)
    raise LLMError(f"unknown LLM_PROVIDER: {provider!r}")


def _call_anthropic(system, user, model, api_key, base_url, timeout_seconds) -> str:
    res = httpx.post(
        f"{base_url}/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={
            "model": model,
            "max_tokens": 1024,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=timeout_seconds,
    )
    res.raise_for_status()
    blocks = res.json()["content"]
    return "".join(b["text"] for b in blocks if b.get("type") == "text")


def _call_openai_compatible(system, user, model, api_key, base_url, timeout_seconds) -> str:
    res = httpx.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "content-type": "application/json"},
        json={
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_object"},
        },
        timeout=timeout_seconds,
    )
    res.raise_for_status()
    return res.json()["choices"][0]["message"]["content"]


def _call_ollama(system, user, model, base_url, timeout_seconds) -> str:
    res = httpx.post(
        f"{base_url}/api/chat",
        json={
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "format": "json",
            "stream": False,
        },
        timeout=timeout_seconds,
    )
    res.raise_for_status()
    return res.json()["message"]["content"]
