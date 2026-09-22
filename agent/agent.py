"""Poll loop: fetch commands from the backend, execute via actions/windows.py, report results. Runs on Machine 1."""
import logging
import sys
import time
from datetime import datetime, timezone

import httpx

from .actions import windows
from .config import AgentConfig, load_config

logger = logging.getLogger("csa_ops.agent")


def _is_elevated() -> bool:
    if sys.platform != "win32":
        return True  # elevation isn't applicable off Windows (e.g. running tests)
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _post_result(client, backend_url: str, headers: dict, *, action_id: str, status: str,
                  response_executed_time, result: str) -> None:
    client.post(
        f"{backend_url}/agent/results",
        headers=headers,
        json={
            "action_id": action_id,
            "status": status,
            "response_executed_time": response_executed_time,
            "result": result,
        },
    ).raise_for_status()


def _handle_command(client, config: AgentConfig, headers: dict, command: dict, *, kill_switch_active: bool) -> dict:
    action_id = command["action_id"]
    action_name = command["action"]
    target = command.get("target") or {}

    if kill_switch_active:
        logger.warning("refusing command %s (%s): kill switch active", action_id, action_name)
        _post_result(
            client, config.backend_url, headers, action_id=action_id, status="blocked_by_kill_switch",
            response_executed_time=None, result="agent refused: kill switch active",
        )
        return command

    live = config.agent_live and command.get("mode") == "live"
    handler = windows.ACTIONS[action_name]

    if action_name in ("isolate_host", "unisolate_host"):
        # Engine IP is agent-local config (CLAUDE.md rule 6), not something
        # the backend/dashboard needs to supply per-action.
        target = {**target, "engine_host_ip": config.engine_host_ip}

    try:
        outcome = handler(target, live)
    except NotImplementedError as exc:
        logger.error("action %s not implemented for live execution: %s", action_name, exc)
        _post_result(
            client, config.backend_url, headers, action_id=action_id, status="failed",
            response_executed_time=None, result=str(exc),
        )
        return command

    _post_result(
        client, config.backend_url, headers, action_id=action_id, status="executed",
        response_executed_time=_now(), result=outcome["result"],
    )
    return command


def poll_once(client, config: AgentConfig) -> list[dict]:
    headers = {"X-API-Key": config.agent_api_key}
    res = client.get(f"{config.backend_url}/agent/commands", params={"host": config.host}, headers=headers)
    res.raise_for_status()
    data = res.json()

    if data["kill_switch"]:
        logger.warning("kill switch active; refusing all commands")

    return [
        _handle_command(client, config, headers, command, kill_switch_active=data["kill_switch"])
        for command in data["commands"]
    ]


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    config = load_config()
    logger.info("agent starting: host=%s backend=%s live=%s", config.host, config.backend_url, config.agent_live)

    if config.agent_live and not _is_elevated():
        logger.error("AGENT_LIVE=true requires an elevated (Administrator) process; refusing to start")
        raise SystemExit(1)

    with httpx.Client(timeout=15) as client:
        while True:
            try:
                poll_once(client, config)
            except Exception:
                logger.exception("poll cycle failed")
            time.sleep(config.poll_interval_seconds)


if __name__ == "__main__":
    main()
