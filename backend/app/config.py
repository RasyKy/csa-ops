"""Environment-driven settings for the backend process.

Every env var used anywhere in CLAUDE.md is read here, typed and defaulted
safe. See docs/interfaces.md for the data contracts these values support.
"""
import json
import os
from functools import lru_cache

from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()


class Settings(BaseModel):
    dashboard_api_key: str = "changeme-dashboard-key"
    agent_api_key: str = "changeme-agent-key"

    store_backend: str = "fixtures"
    fixtures_dir: str = "fixtures"
    intake_state_path: str = "./data/intake_state.json"
    response_actions_path: str = "./data/response_actions.json"
    es_host: str = "http://localhost:9200"

    kill_switch_path: str = "./data/killswitch"
    response_live: bool = False
    response_live_hosts: list[str] = []
    agent_long_poll_seconds: float = 10

    intake_enabled: bool = True
    intake_poll_seconds: int = 2

    llm_provider: str = "anthropic"
    llm_model: str = ""
    llm_api_key: str = ""
    llm_timeout_seconds: int = 20


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _list_env(name: str, default: list[str]) -> list[str]:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    if not value:
        return []
    if value.startswith("["):
        return json.loads(value)
    return [item.strip() for item in value.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings(
        dashboard_api_key=os.getenv("DASHBOARD_API_KEY", "changeme-dashboard-key"),
        agent_api_key=os.getenv("AGENT_API_KEY", "changeme-agent-key"),
        store_backend=os.getenv("STORE_BACKEND", "fixtures"),
        fixtures_dir=os.getenv("FIXTURES_DIR", "fixtures"),
        intake_state_path=os.getenv("INTAKE_STATE_PATH", "./data/intake_state.json"),
        response_actions_path=os.getenv("RESPONSE_ACTIONS_PATH", "./data/response_actions.json"),
        es_host=os.getenv("ES_HOST", "http://localhost:9200"),
        kill_switch_path=os.getenv("KILL_SWITCH_PATH", "./data/killswitch"),
        response_live=_bool_env("RESPONSE_LIVE", False),
        response_live_hosts=_list_env("RESPONSE_LIVE_HOSTS", []),
        agent_long_poll_seconds=float(os.getenv("AGENT_LONG_POLL_SECONDS", "10")),
        intake_enabled=_bool_env("INTAKE_ENABLED", True),
        intake_poll_seconds=int(os.getenv("INTAKE_POLL_SECONDS", "2")),
        llm_provider=os.getenv("LLM_PROVIDER", "anthropic"),
        llm_model=os.getenv("LLM_MODEL", ""),
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_timeout_seconds=int(os.getenv("LLM_TIMEOUT_SECONDS", "20")),
    )
