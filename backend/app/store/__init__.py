"""Store selection: FixtureStore by default, ESStore when STORE_BACKEND=elasticsearch."""
import logging

from fastapi import Request

from ..config import Settings
from .es_store import ESStore
from .fixture_store import FixtureStore

logger = logging.getLogger("csa_ops.store")


def build_store(settings: Settings):
    if settings.store_backend == "fixtures":
        return FixtureStore(
            fixtures_dir=settings.fixtures_dir,
            intake_state_path=settings.intake_state_path,
            response_actions_path=settings.response_actions_path,
        )
    if settings.store_backend == "elasticsearch":
        try:
            return ESStore(es_host=settings.es_host)
        except Exception:
            logger.error("Elasticsearch unreachable at startup; refusing to start.")
            raise
    raise ValueError(f"Unknown STORE_BACKEND: {settings.store_backend!r}")


def get_store(request: Request):
    return request.app.state.store
