"""AGENT_API_KEY, BACKEND_URL, ENGINE_HOST_IP, AGENT_LIVE, poll interval.

No python-dotenv here on purpose -- agent/requirements.txt stays minimal
(httpx, psutil) per CLAUDE.md section 6. Export env vars directly, or run
the agent under a process manager that does.
"""
import os
import socket
from dataclasses import dataclass, field


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class AgentConfig:
    agent_api_key: str = field(default_factory=lambda: os.getenv("AGENT_API_KEY", "changeme-agent-key"))
    backend_url: str = field(default_factory=lambda: os.getenv("BACKEND_URL", "http://localhost:8000"))
    engine_host_ip: str = field(default_factory=lambda: os.getenv("ENGINE_HOST_IP", "127.0.0.1"))
    agent_live: bool = field(default_factory=lambda: _bool_env("AGENT_LIVE", False))
    host: str = field(default_factory=lambda: os.getenv("AGENT_HOST") or socket.gethostname())
    poll_interval_seconds: float = field(
        default_factory=lambda: float(os.getenv("AGENT_POLL_INTERVAL_SECONDS", "1"))
    )


def load_config() -> AgentConfig:
    return AgentConfig()
