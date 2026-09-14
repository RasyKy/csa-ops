import pytest

pytest.importorskip("elasticsearch", reason="elasticsearch client not installed in this environment")

from backend.app.store.es_store import ESStore  # noqa: E402


def test_es_store_refuses_to_start_on_connection_failure():
    with pytest.raises(RuntimeError):
        ESStore(es_host="http://127.0.0.1:1")
