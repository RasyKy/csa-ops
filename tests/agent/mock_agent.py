"""In-process fake agent for backend integration tests.

Drives the real agent.agent.poll_once() against a FastAPI TestClient
instead of a real HTTP connection to a real agent process -- TestClient is
httpx-based, so poll_once()'s client.get/.post calls work against it
unmodified. This exercises production agent code, not a reimplementation
of it.
"""
from dataclasses import dataclass

from agent.agent import poll_once


@dataclass
class MockAgentConfig:
    agent_api_key: str
    backend_url: str = ""
    host: str = "WS01"
    agent_live: bool = False
    engine_host_ip: str = "127.0.0.1"


def run_agent_cycle(client, *, agent_api_key: str, host: str = "WS01", agent_live: bool = False) -> list[dict]:
    config = MockAgentConfig(agent_api_key=agent_api_key, host=host, agent_live=agent_live)
    return poll_once(client, config)
