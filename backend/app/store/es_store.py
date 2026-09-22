"""Elasticsearch implementation of the Store protocol. Selected by STORE_BACKEND=elasticsearch.

The elasticsearch client is imported lazily so that fixtures-mode users (the
default) don't need it installed. On connection failure at startup this
raises instead of falling back silently -- see CLAUDE.md Phase 1.
"""
import logging
from typing import Optional

logger = logging.getLogger("csa_ops.store.es")

ALERTS_INDEX = "alerts"
INCIDENTS_INDEX = "incidents"
TRIAGE_INDEX = "incident_triage"
RESPONSE_ACTIONS_INDEX = "response_actions"
INTAKE_STATE_INDEX = "intake_state"
INTAKE_STATE_DOC_ID = "watcher"
LOGS_NORMALIZED_INDEX = "logs-normalized"  # ingestion's index; B only ever reads it, for pipeline health

# Metrics page: per-index timestamp field, for index_health()'s "latest
# document" aggregation. logs-normalized's field name is per
# engine/normalizer/schema.py's NormalizedEvent (CLAUDE.md 1a) -- B reads
# this read-only, the same established pattern as reading A's alerts/incidents.
_TIMESTAMP_FIELDS = {
    ALERTS_INDEX: "timestamp",
    INCIDENTS_INDEX: "incident_raised_time",
    TRIAGE_INDEX: "triage_time",
    RESPONSE_ACTIONS_INDEX: "command_issued_time",
    LOGS_NORMALIZED_INDEX: "timestamp",
}


class ESStore:
    def __init__(self, es_host: str, client=None):
        # `client` lets tests inject a fake in place of a real elasticsearch.Elasticsearch,
        # so the query-building logic below is unit-testable without a live cluster or
        # even the elasticsearch package installed. Production callers always omit it.
        if client is not None:
            self._es = client
            return

        try:
            from elasticsearch import Elasticsearch
        except ImportError as exc:
            raise RuntimeError(
                "elasticsearch client not installed; run pip install -r backend/requirements.txt"
            ) from exc

        self._es = Elasticsearch(es_host, request_timeout=5)
        try:
            self._es.info()
        except Exception as exc:
            logger.error("Could not connect to Elasticsearch at %s: %s", es_host, exc)
            raise RuntimeError(f"Elasticsearch unreachable at {es_host}") from exc

    def _search(self, *, index, query, size, sort=None) -> list[dict]:
        # Elasticsearch does not auto-create an index for a read (only for a
        # write), so on a genuinely fresh cluster -- before A has written a
        # single alert/incident, or before B has issued a single response
        # action -- every one of these indices legitimately doesn't exist
        # yet. That must read as "no results", not a 500; found only by
        # testing against a real cluster (Phase 6), not the fake client
        # tests use elsewhere in this file.
        try:
            res = self._es.search(index=index, query=query, size=size, sort=sort)
        except Exception as exc:
            if _is_index_not_found(exc):
                return []
            raise
        return [hit["_source"] for hit in res["hits"]["hits"]]

    def _count(self, *, index, query) -> int:
        try:
            res = self._es.count(index=index, query=query)
        except Exception as exc:
            if _is_index_not_found(exc):
                return 0
            raise
        return res["count"]

    def _agg_search(self, *, index, query, aggs) -> Optional[dict]:
        try:
            res = self._es.search(index=index, query=query, size=0, aggs=aggs)
        except Exception as exc:
            if _is_index_not_found(exc):
                return None
            raise
        return res["aggregations"]

    def list_alerts(self, *, severity=None, host=None, limit=50, since=None) -> list[dict]:
        query = _filter_query(severity=severity, host=host, since=since, since_field="timestamp")
        return self._search(index=ALERTS_INDEX, query=query, size=limit, sort=[{"timestamp": "desc"}])

    def list_incidents(self, *, severity=None, host=None, limit=50, since=None, order="desc") -> list[dict]:
        query = _filter_query(severity=severity, host=host, since=since, since_field="incident_raised_time")
        return self._search(
            index=INCIDENTS_INDEX, query=query, size=limit, sort=[{"incident_raised_time": order}]
        )

    def get_incident(self, incident_id: str) -> Optional[dict]:
        try:
            return self._es.get(index=INCIDENTS_INDEX, id=incident_id)["_source"]
        except Exception:
            return None

    def get_alerts_by_ids(self, alert_ids: list[str]) -> list[dict]:
        if not alert_ids:
            return []
        res = self._es.mget(index=ALERTS_INDEX, ids=alert_ids)
        return [doc["_source"] for doc in res["docs"] if doc.get("found")]

    def get_triage(self, incident_id: str) -> Optional[dict]:
        try:
            return self._es.get(index=TRIAGE_INDEX, id=incident_id)["_source"]
        except Exception:
            return None

    def save_triage(self, triage: dict) -> None:
        self._es.index(index=TRIAGE_INDEX, id=triage["incident_id"], document=triage)

    def list_response_actions(self, incident_id: str) -> list[dict]:
        query = {"term": {"incident_id.keyword": incident_id}}
        return self._search(
            index=RESPONSE_ACTIONS_INDEX, query=query, size=1000, sort=[{"command_issued_time": "asc"}]
        )

    def get_latest_response_action(self, incident_id: str) -> Optional[dict]:
        actions = self.list_response_actions(incident_id)
        return actions[-1] if actions else None

    def list_all_response_actions(self) -> list[dict]:
        return self._search(
            index=RESPONSE_ACTIONS_INDEX, query={"match_all": {}}, size=1000,
            sort=[{"command_issued_time": "desc"}],
        )

    def get_response_action(self, action_id: str) -> Optional[dict]:
        try:
            return self._es.get(index=RESPONSE_ACTIONS_INDEX, id=action_id)["_source"]
        except Exception:
            return None

    def save_response_action(self, action: dict) -> None:
        self._es.index(index=RESPONSE_ACTIONS_INDEX, id=action["action_id"], document=action)

    def update_response_action(self, action_id: str, updates: dict) -> Optional[dict]:
        try:
            self._es.update(index=RESPONSE_ACTIONS_INDEX, id=action_id, doc=updates)
        except Exception:
            return None
        return self.get_response_action(action_id)

    def list_pending_commands(self, host: str) -> list[dict]:
        query = {"bool": {"must": [{"term": {"host.keyword": host}}, {"term": {"status.keyword": "issued"}}]}}
        return self._search(index=RESPONSE_ACTIONS_INDEX, query=query, size=1000)

    def get_intake_state(self) -> dict:
        try:
            return self._es.get(index=INTAKE_STATE_INDEX, id=INTAKE_STATE_DOC_ID)["_source"]
        except Exception:
            return {"watermark": None, "processed_ids": []}

    def save_intake_state(self, state: dict) -> None:
        self._es.index(index=INTAKE_STATE_INDEX, id=INTAKE_STATE_DOC_ID, document=state)

    # --- Metrics page ---

    def count_alerts(self, *, since=None, severity=None) -> int:
        query = _filter_query(severity=severity, since=since, since_field="timestamp")
        return self._count(index=ALERTS_INDEX, query=query)

    def count_incidents(self, *, since=None, severity=None) -> int:
        query = _filter_query(severity=severity, since=since, since_field="incident_raised_time")
        return self._count(index=INCIDENTS_INDEX, query=query)

    def alerts_timeseries(self, *, since, interval: str) -> list[dict]:
        query = _filter_query(since=since, since_field="timestamp")
        calendar_interval = "hour" if interval == "hour" else "day"
        aggs = {
            "by_time": {
                "date_histogram": {"field": "timestamp", "calendar_interval": calendar_interval},
                "aggs": {"by_severity": {"terms": {"field": "severity.keyword", "size": 10}}},
            }
        }
        aggregations = self._agg_search(index=ALERTS_INDEX, query=query, aggs=aggs)
        if aggregations is None:
            return []
        return [
            {
                "bucket": bucket["key_as_string"],
                "severity_counts": {s["key"]: s["doc_count"] for s in bucket["by_severity"]["buckets"]},
            }
            for bucket in aggregations["by_time"]["buckets"]
        ]

    def alerts_top_terms(self, field: str, *, since=None, size: int = 5) -> list[dict]:
        query = _filter_query(since=since, since_field="timestamp")
        aggs = {"top": {"terms": {"field": f"{field}.keyword", "size": size}}}
        aggregations = self._agg_search(index=ALERTS_INDEX, query=query, aggs=aggs)
        if aggregations is None:
            return []
        return [{"key": b["key"], "count": b["doc_count"]} for b in aggregations["top"]["buckets"]]

    def alerts_by_technique_tactic(self, *, since=None) -> list[dict]:
        query = _filter_query(since=since, since_field="timestamp")
        aggs = {
            "by_pair": {
                "multi_terms": {
                    "terms": [{"field": "technique.keyword"}, {"field": "tactic.keyword"}],
                    "size": 200,
                }
            }
        }
        aggregations = self._agg_search(index=ALERTS_INDEX, query=query, aggs=aggs)
        if aggregations is None:
            return []
        result = []
        for bucket in aggregations["by_pair"]["buckets"]:
            technique, tactic = bucket["key"]
            result.append({"technique": technique, "tactic": tactic, "count": bucket["doc_count"]})
        return result

    def list_all_triage(self, *, since=None) -> list[dict]:
        query = _filter_query(since=since, since_field="triage_time")
        return self._search(index=TRIAGE_INDEX, query=query, size=1000, sort=[{"triage_time": "desc"}])

    def index_health(self, index_name: str) -> Optional[dict]:
        ts_field = _TIMESTAMP_FIELDS.get(index_name)
        if ts_field is None:
            return None
        count = self._count(index=index_name, query={"match_all": {}})
        if count == 0:
            return {"count": 0, "latest_timestamp": None}
        aggregations = self._agg_search(
            index=index_name, query={"match_all": {}}, aggs={"latest": {"max": {"field": ts_field}}}
        )
        latest = aggregations["latest"]["value_as_string"] if aggregations else None
        return {"count": count, "latest_timestamp": latest}


def _is_index_not_found(exc: Exception) -> bool:
    # Checked by class name/message rather than `except elasticsearch.NotFoundError`
    # so this file's `elasticsearch` import stays fully lazy (see __init__) --
    # unit tests inject a FakeESClient and must keep working with the real
    # package absent.
    return type(exc).__name__ == "NotFoundError" and "index_not_found_exception" in str(exc)


def _filter_query(*, severity=None, host=None, since=None, since_field="timestamp") -> dict:
    # .keyword: alerts/incidents are A's indices with no explicit index
    # template (CLAUDE.md 1a), so string fields fall back to Elasticsearch's
    # default dynamic mapping -- "text" (analyzed) plus a "<field>.keyword"
    # exact-match sub-field. A term query against the bare field name
    # silently matches nothing once a value tokenizes to more than one term
    # (e.g. "WS01" is fine, but this must stay in sync with A's real mapping
    # if they ever define an explicit template that removes the sub-field).
    must = []
    if severity:
        must.append({"term": {"severity.keyword": severity}})
    if host:
        must.append({"term": {"host.keyword": host}})
    if since:
        must.append({"range": {since_field: {"gt": since}}})
    return {"bool": {"must": must}} if must else {"match_all": {}}
