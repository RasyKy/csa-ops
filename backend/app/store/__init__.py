"""Store selection: FixtureStore by default, ESStore when STORE_BACKEND=elasticsearch."""
import logging

from fastapi import Request

from ..config import Settings
from .es_store import ESStore
from .fixture_set import is_default_set, resolve_store_paths
from .fixture_store import FixtureStore

logger = logging.getLogger("csa_ops.store")


def build_store(settings: Settings):
    if settings.store_backend == "fixtures":
        return FixtureStore(**resolve_store_paths(settings))
    if settings.store_backend == "elasticsearch":
        if not is_default_set(settings.fixture_set):
            raise ValueError("FIXTURE_SET only applies to STORE_BACKEND=fixtures")
        try:
            return ESStore(es_host=settings.es_host)
        except Exception:
            logger.error("Elasticsearch unreachable at startup; refusing to start.")
            raise
    raise ValueError(f"Unknown STORE_BACKEND: {settings.store_backend!r}")


def get_store(request: Request):
    return request.app.state.store
