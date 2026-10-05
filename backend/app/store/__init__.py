"""Store selection: FixtureStore by default, ESStore when STORE_BACKEND=elasticsearch."""
import logging
import threading

from fastapi import Request

from ..config import Settings, get_settings
from .case_store import CaseStore
from .fixture_set import is_default_set, resolve_cases_path, resolve_store_paths
from .fixture_store import FixtureStore

logger = logging.getLogger("csa_ops.store")


def build_store(settings: Settings):
    if settings.store_backend == "fixtures":
        return FixtureStore(**resolve_store_paths(settings))
    if settings.store_backend == "elasticsearch":
        if not is_default_set(settings.fixture_set):
            raise ValueError("FIXTURE_SET only applies to STORE_BACKEND=fixtures")
        from .es_store import ESStore
        try:
            return ESStore(es_host=settings.es_host)
        except Exception:
            logger.error("Elasticsearch unreachable at startup; refusing to start.")
            raise
    raise ValueError(f"Unknown STORE_BACKEND: {settings.store_backend!r}")


def get_store(request: Request):
    return request.app.state.store


_case_stores: dict[str, CaseStore] = {}
_case_stores_lock = threading.Lock()


def build_case_store(settings: Settings) -> CaseStore:
    return CaseStore(resolve_cases_path(settings))


def get_case_store() -> CaseStore:
    """One CaseStore per resolved cases.json path, so concurrent requests share
    one lock. Cases are file-backed in every STORE_BACKEND mode."""
    path = str(resolve_cases_path(get_settings()))
    with _case_stores_lock:
        store = _case_stores.get(path)
        if store is None:
            store = _case_stores[path] = CaseStore(path)
        return store
