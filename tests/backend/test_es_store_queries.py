"""Query-building tests for ESStore using a fake client instead of a real
cluster (or even the elasticsearch package -- see ESStore.__init__'s
`client` parameter). These verify the query/index/sort shapes ESStore sends
and how it parses responses. They cannot verify Elasticsearch itself
behaves as assumed -- that needs the real cluster this environment doesn't
have, and remains untested until Phase 6 integration.
"""
from backend.app.store.es_store import ESStore


class FakeESClient:
    """Minimal in-memory stand-in for elasticsearch.Elasticsearch, covering
    only the calls ESStore actually makes. Records every call for assertions."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self._docs: dict[tuple[str, str], dict] = {}
        self.search_hits: list[dict] = []
        self.fail_update = False

    def seed(self, index: str, doc_id: str, document: dict) -> None:
        self._docs[(index, doc_id)] = dict(document)

    def search(self, *, index, query, size, sort=None):
        self.calls.append(("search", {"index": index, "query": query, "size": size, "sort": sort}))
        return {"hits": {"hits": [{"_source": doc} for doc in self.search_hits]}}

    def get(self, *, index, id):
        self.calls.append(("get", {"index": index, "id": id}))
        key = (index, id)
        if key not in self._docs:
            raise KeyError(id)
        return {"_source": self._docs[key]}

    def mget(self, *, index, ids):
        self.calls.append(("mget", {"index": index, "ids": ids}))
        docs = []
        for doc_id in ids:
            key = (index, doc_id)
            docs.append({"found": True, "_source": self._docs[key]} if key in self._docs else {"found": False})
        return {"docs": docs}

    def index(self, *, index, id, document):
        self.calls.append(("index", {"index": index, "id": id, "document": document}))
        self._docs[(index, id)] = dict(document)

    def update(self, *, index, id, doc):
        self.calls.append(("update", {"index": index, "id": id, "doc": doc}))
        if self.fail_update:
            raise RuntimeError("simulated ES update failure")
        key = (index, id)
        self._docs.setdefault(key, {}).update(doc)


def _store(fake: FakeESClient) -> ESStore:
    return ESStore(es_host="unused", client=fake)


def test_list_alerts_builds_severity_host_and_since_filter():
    fake = FakeESClient()
    store = _store(fake)
    store.list_alerts(severity="high", host="WS01", limit=10, since="2026-01-01T00:00:00.000Z")

    _, call = fake.calls[-1]
    assert call["index"] == "alerts"
    assert call["size"] == 10
    assert call["sort"] == [{"timestamp": "desc"}]
    must = call["query"]["bool"]["must"]
    assert {"term": {"severity": "high"}} in must
    assert {"term": {"host": "WS01"}} in must
    assert {"range": {"timestamp": {"gt": "2026-01-01T00:00:00.000Z"}}} in must


def test_list_alerts_with_no_filters_uses_match_all():
    fake = FakeESClient()
    _store(fake).list_alerts()
    assert fake.calls[-1][1]["query"] == {"match_all": {}}


def test_list_incidents_passes_order_through_to_sort():
    fake = FakeESClient()
    _store(fake).list_incidents(order="asc")
    assert fake.calls[-1][1]["sort"] == [{"incident_raised_time": "asc"}]


def test_get_incident_returns_source():
    fake = FakeESClient()
    fake.seed("incidents", "inc-1", {"incident_id": "inc-1"})
    assert _store(fake).get_incident("inc-1") == {"incident_id": "inc-1"}


def test_get_incident_returns_none_when_missing():
    assert _store(FakeESClient()).get_incident("missing") is None


def test_get_alerts_by_ids_filters_unfound():
    fake = FakeESClient()
    fake.seed("alerts", "a1", {"alert_id": "a1"})
    result = _store(fake).get_alerts_by_ids(["a1", "a2"])
    assert result == [{"alert_id": "a1"}]


def test_get_alerts_by_ids_empty_list_skips_the_call():
    fake = FakeESClient()
    assert _store(fake).get_alerts_by_ids([]) == []
    assert fake.calls == []


def test_save_response_action_indexes_by_action_id():
    fake = FakeESClient()
    _store(fake).save_response_action({"action_id": "act-1", "status": "issued"})
    assert fake.calls[-1] == (
        "index", {"index": "response_actions", "id": "act-1", "document": {"action_id": "act-1", "status": "issued"}},
    )


def test_update_response_action_updates_then_reads_back():
    fake = FakeESClient()
    fake.seed("response_actions", "act-1", {"action_id": "act-1", "status": "issued"})
    result = _store(fake).update_response_action("act-1", {"status": "received"})

    assert ("update", {"index": "response_actions", "id": "act-1", "doc": {"status": "received"}}) in fake.calls
    assert result == {"action_id": "act-1", "status": "received"}


def test_update_response_action_returns_none_on_failure():
    fake = FakeESClient()
    fake.fail_update = True
    assert _store(fake).update_response_action("act-1", {"status": "received"}) is None


def test_list_pending_commands_filters_by_host_and_status():
    fake = FakeESClient()
    _store(fake).list_pending_commands("WS01")

    _, call = fake.calls[-1]
    assert call["index"] == "response_actions"
    must = call["query"]["bool"]["must"]
    assert {"term": {"host": "WS01"}} in must
    assert {"term": {"status": "issued"}} in must


def test_list_all_response_actions_sorts_by_issued_time_desc():
    fake = FakeESClient()
    _store(fake).list_all_response_actions()
    _, call = fake.calls[-1]
    assert call["query"] == {"match_all": {}}
    assert call["sort"] == [{"command_issued_time": "desc"}]


def test_intake_state_defaults_when_missing():
    assert _store(FakeESClient()).get_intake_state() == {"watermark": None, "processed_ids": []}


def test_intake_state_save_then_get_roundtrip():
    fake = FakeESClient()
    store = _store(fake)
    state = {"watermark": "2026-01-01T00:00:00.000Z", "processed_ids": ["inc-1"]}
    store.save_intake_state(state)
    assert store.get_intake_state() == state
