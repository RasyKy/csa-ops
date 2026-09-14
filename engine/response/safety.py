"""Kill switch and response-mode resolution.

Evaluation order is fixed (CLAUDE.md rule 3.1): kill switch, then mode
resolution, then decision policy. Never reorder.
"""
from pathlib import Path


class KillSwitch:
    """File-backed kill switch. Presence of the file means the switch is set."""

    def __init__(self, path: str | Path):
        self._path = Path(path)

    def is_set(self) -> bool:
        return self._path.exists()

    def set(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.touch()

    def clear(self) -> None:
        self._path.unlink(missing_ok=True)


def global_mode(response_live: bool) -> str:
    """Coarse mode for contexts with no specific host, e.g. GET /health."""
    return "live" if response_live else "dry_run"


def resolve_mode(response_live: bool, response_live_hosts: list[str], host: str) -> str:
    """Per-host mode for the decision engine (CLAUDE.md rule 2 and 4).

    Live requires both response_live=True and host in response_live_hosts.
    Missing either means dry-run.
    """
    if response_live and host in response_live_hosts:
        return "live"
    return "dry_run"
