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

    def list_alerts(self, *, severity=None, host=None, limit=50, since=None) -> list[dict]:
        query = _filter_query(severity=severity, host=host, since=since, since_field="timestamp")
        res = self._es.search(index=ALERTS_INDEX, query=query, size=limit, sort=[{"timestamp": "desc"}])
        return [hit["_source"] for hit in res["hits"]["hits"]]

    def list_incidents(self, *, severity=None, host=None, limit=50, since=None, order="desc") -> list[dict]:
        query = _filter_query(severity=severity, host=host, since=since, since_field="incident_raised_time")
        res = self._es.search(
            index=INCIDENTS_INDEX, query=query, size=limit, sort=[{"incident_raised_time": order}]
        )
        return [hit["_source"] for hit in res["hits"]["hits"]]

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
        query = {"term": {"incident_id": incident_id}}
        res = self._es.search(
            index=RESPONSE_ACTIONS_INDEX, query=query, size=1000, sort=[{"command_issued_time": "asc"}]
        )
        return [hit["_source"] for hit in res["hits"]["hits"]]

    def get_latest_response_action(self, incident_id: str) -> Optional[dict]:
        actions = self.list_response_actions(incident_id)
        return actions[-1] if actions else None

    def list_all_response_actions(self) -> list[dict]:
        res = self._es.search(
            index=RESPONSE_ACTIONS_INDEX, query={"match_all": {}}, size=1000,
            sort=[{"command_issued_time": "desc"}],
        )
        return [hit["_source"] for hit in res["hits"]["hits"]]

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
        query = {"bool": {"must": [{"term": {"host": host}}, {"term": {"status": "issued"}}]}}
        res = self._es.search(index=RESPONSE_ACTIONS_INDEX, query=query, size=1000)
        return [hit["_source"] for hit in res["hits"]["hits"]]

    def get_intake_state(self) -> dict:
        try:
            return self._es.get(index=INTAKE_STATE_INDEX, id=INTAKE_STATE_DOC_ID)["_source"]
        except Exception:
            return {"watermark": None, "processed_ids": []}

    def save_intake_state(self, state: dict) -> None:
        self._es.index(index=INTAKE_STATE_INDEX, id=INTAKE_STATE_DOC_ID, document=state)


def _filter_query(*, severity=None, host=None, since=None, since_field="timestamp") -> dict:
    must = []
    if severity:
        must.append({"term": {"severity": severity}})
    if host:
        must.append({"term": {"host": host}})
    if since:
        must.append({"range": {since_field: {"gt": since}}})
    return {"bool": {"must": must}} if must else {"match_all": {}}
