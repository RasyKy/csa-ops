"""Query-building tests for ESStore using a fake client instead of a real
cluster (or even the elasticsearch package -- see ESStore.__init__'s
`client` parameter). These verify the query/index/sort shapes ESStore sends
and how it parses responses. They cannot verify Elasticsearch itself
matches those queries the way ESStore assumes -- FakeESClient.search()
ignores `query` entirely and just returns whatever search_hits was seeded
with. That gap is real: verifying against a real cluster in Phase 6 found
every bare-field term query here silently matching nothing, because
Elasticsearch's default dynamic mapping makes string fields "text"
(analyzed) with a separate ".keyword" sub-field for exact matches -- see
the ".keyword" suffixes below and in es_store.py.
"""
from backend.app.store.es_store import ESStore


class FakeNotFoundError(Exception):
    """Stands in for elasticsearch.NotFoundError. ESStore checks exceptions
    by class name/message (see _is_index_not_found), not isinstance, so a
    differently-named class with the right __name__ and message is enough
    to exercise that path without the real elasticsearch package."""


FakeNotFoundError.__name__ = "NotFoundError"


class FakeESClient:
    """Minimal in-memory stand-in for elasticsearch.Elasticsearch, covering
    only the calls ESStore actually makes. Records every call for assertions."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self._docs: dict[tuple[str, str], dict] = {}
        self.search_hits: list[dict] = []
        self.fail_update = False
        self.missing_indices: set[str] = set()
        self.count_value = 0
        self.agg_response: dict = {}

    def seed(self, index: str, doc_id: str, document: dict) -> None:
        self._docs[(index, doc_id)] = dict(document)

    def search(self, *, index, query, size, sort=None, aggs=None):
        self.calls.append(("search", {"index": index, "query": query, "size": size, "sort": sort, "aggs": aggs}))
        if index in self.missing_indices:
            raise FakeNotFoundError(f"index_not_found_exception, no such index [{index}]")
        if aggs is not None:
            return {"hits": {"hits": []}, "aggregations": self.agg_response}
        return {"hits": {"hits": [{"_source": doc} for doc in self.search_hits]}}

    def count(self, *, index, query):
        self.calls.append(("count", {"index": index, "query": query}))
        if index in self.missing_indices:
            raise FakeNotFoundError(f"index_not_found_exception, no such index [{index}]")
        return {"count": self.count_value}

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
    # .keyword: real Elasticsearch dynamic mapping makes string fields
    # "text" (analyzed) plus a ".keyword" exact-match sub-field. A term
    # query against the bare field name silently matches nothing once a
    # value tokenizes to more than one term -- caught only by testing
    # against a real cluster, not this fake client. See es_store.py.
    must = call["query"]["bool"]["must"]
    assert {"term": {"severity.keyword": "high"}} in must
    assert {"term": {"host.keyword": "WS01"}} in must
    assert {"range": {"timestamp": {"gt": "2026-01-01T00:00:00.000Z"}}} in must


def test_list_alerts_returns_empty_list_when_index_does_not_exist_yet():
    # Regression: on a genuinely fresh cluster, before A has ever written an
    # alert, the "alerts" index doesn't exist. Elasticsearch doesn't
    # auto-create an index for a read, so this must read as "no alerts",
    # not a 500 -- found by testing against a real cluster (Phase 6).
    fake = FakeESClient()
    fake.missing_indices.add("alerts")
    assert _store(fake).list_alerts() == []


def test_list_incidents_returns_empty_list_when_index_does_not_exist_yet():
    fake = FakeESClient()
    fake.missing_indices.add("incidents")
    assert _store(fake).list_incidents() == []


def test_list_response_actions_returns_empty_list_when_index_does_not_exist_yet():
    # Same gap on B's own index: before the very first response action is
    # ever issued, response_actions doesn't exist yet either.
    fake = FakeESClient()
    fake.missing_indices.add("response_actions")
    assert _store(fake).list_response_actions("inc-1") == []
    assert _store(fake).list_all_response_actions() == []
    assert _store(fake).list_pending_commands("WS01") == []


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


def test_list_response_actions_filters_by_incident_id_keyword():
    fake = FakeESClient()
    _store(fake).list_response_actions("inc-1")

    _, call = fake.calls[-1]
    assert call["index"] == "response_actions"
    assert call["query"] == {"term": {"incident_id.keyword": "inc-1"}}


def test_list_pending_commands_filters_by_host_and_status():
    fake = FakeESClient()
    _store(fake).list_pending_commands("WS01")

    _, call = fake.calls[-1]
    assert call["index"] == "response_actions"
    must = call["query"]["bool"]["must"]
    assert {"term": {"host.keyword": "WS01"}} in must
    assert {"term": {"status.keyword": "issued"}} in must


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


# --- Metrics page methods ---

def test_count_alerts_uses_count_api_with_filter_query():
    fake = FakeESClient()
    fake.count_value = 5
    result = _store(fake).count_alerts(since="2026-01-01T00:00:00.000Z", severity="high")

    assert result == 5
    op, call = fake.calls[-1]
    assert op == "count"
    assert call["index"] == "alerts"
    must = call["query"]["bool"]["must"]
    assert {"term": {"severity.keyword": "high"}} in must
    assert {"range": {"timestamp": {"gt": "2026-01-01T00:00:00.000Z"}}} in must


def test_count_alerts_returns_zero_when_index_missing():
    fake = FakeESClient()
    fake.missing_indices.add("alerts")
    assert _store(fake).count_alerts() == 0


def test_count_incidents_filters_on_incident_raised_time():
    fake = FakeESClient()
    fake.count_value = 2
    _store(fake).count_incidents(since="2026-01-01T00:00:00.000Z")

    _, call = fake.calls[-1]
    assert call["index"] == "incidents"
    assert call["query"]["bool"]["must"] == [
        {"range": {"incident_raised_time": {"gt": "2026-01-01T00:00:00.000Z"}}}
    ]


def test_alerts_timeseries_builds_date_histogram_with_severity_sub_agg():
    fake = FakeESClient()
    fake.agg_response = {
        "by_time": {"buckets": [
            {"key_as_string": "2026-01-01T00:00:00.000Z", "by_severity": {"buckets": [{"key": "high", "doc_count": 2}]}},
        ]}
    }
    result = _store(fake).alerts_timeseries(since=None, interval="day")

    assert result == [{"bucket": "2026-01-01T00:00:00.000Z", "severity_counts": {"high": 2}}]
    _, call = fake.calls[-1]
    assert call["size"] == 0
    assert call["aggs"]["by_time"]["date_histogram"] == {"field": "timestamp", "calendar_interval": "day"}


def test_alerts_timeseries_uses_hourly_calendar_interval():
    fake = FakeESClient()
    fake.agg_response = {"by_time": {"buckets": []}}
    _store(fake).alerts_timeseries(since=None, interval="hour")

    _, call = fake.calls[-1]
    assert call["aggs"]["by_time"]["date_histogram"]["calendar_interval"] == "hour"


def test_alerts_timeseries_returns_empty_list_when_index_missing():
    fake = FakeESClient()
    fake.missing_indices.add("alerts")
    assert _store(fake).alerts_timeseries(since=None, interval="day") == []


def test_alerts_top_terms_uses_keyword_field_and_size():
    fake = FakeESClient()
    fake.agg_response = {"top": {"buckets": [{"key": "WS01", "doc_count": 3}]}}
    result = _store(fake).alerts_top_terms("host", since=None, size=5)

    assert result == [{"key": "WS01", "count": 3}]
    _, call = fake.calls[-1]
    assert call["aggs"]["top"]["terms"] == {"field": "host.keyword", "size": 5}


def test_alerts_top_terms_returns_empty_list_when_index_missing():
    fake = FakeESClient()
    fake.missing_indices.add("alerts")
    assert _store(fake).alerts_top_terms("host") == []


def test_alerts_by_technique_tactic_uses_multi_terms():
    fake = FakeESClient()
    fake.agg_response = {"by_pair": {"buckets": [{"key": ["T1003", "credential_access"], "doc_count": 4}]}}
    result = _store(fake).alerts_by_technique_tactic(since=None)

    assert result == [{"technique": "T1003", "tactic": "credential_access", "count": 4}]
    _, call = fake.calls[-1]
    assert call["aggs"]["by_pair"]["multi_terms"]["terms"] == [
        {"field": "technique.keyword"}, {"field": "tactic.keyword"},
    ]


def test_list_all_triage_filters_by_since_on_triage_time():
    fake = FakeESClient()
    _store(fake).list_all_triage(since="2026-01-01T00:00:00.000Z")

    _, call = fake.calls[-1]
    assert call["index"] == "incident_triage"
    assert call["query"] == {"bool": {"must": [{"range": {"triage_time": {"gt": "2026-01-01T00:00:00.000Z"}}}]}}


def test_index_health_returns_none_for_unknown_index():
    assert _store(FakeESClient()).index_health("some-unknown-index") is None


def test_index_health_returns_zero_count_without_querying_latest_when_empty():
    fake = FakeESClient()
    fake.count_value = 0
    result = _store(fake).index_health("alerts")

    assert result == {"count": 0, "latest_timestamp": None}
    assert not any(op == "search" for op, _ in fake.calls)  # no wasted agg query when count is 0


def test_index_health_returns_count_and_latest_timestamp():
    fake = FakeESClient()
    fake.count_value = 7
    fake.agg_response = {"latest": {"value_as_string": "2026-09-13T10:15:02.123Z"}}
    result = _store(fake).index_health("alerts")

    assert result == {"count": 7, "latest_timestamp": "2026-09-13T10:15:02.123Z"}


def test_index_health_for_logs_normalized_uses_its_own_timestamp_field():
    # B reads this read-only for pipeline health -- never writes to it.
    fake = FakeESClient()
    fake.count_value = 100
    fake.agg_response = {"latest": {"value_as_string": "2026-09-13T10:00:00.000Z"}}
    _store(fake).index_health("logs-normalized")

    _, call = fake.calls[-1]
    assert call["index"] == "logs-normalized"
    assert call["aggs"]["latest"]["max"]["field"] == "timestamp"
