"""Live demo bridge: Winlogbeat 9.x (ECS, written straight to Elasticsearch) -> the CSA-OPS pipeline.

Why this exists: engine/normalizer/consumer.py expects Winlogbeat 8.x documents
shipped through Kafka (winlog.event_data.Image and so on). The Winlogbeat that is
installed here is 9.x and writes ECS documents (process.executable, ...) directly
to the winlogbeat-* indices. This script reads those, maps them onto the same
NormalizedEvent schema, writes them to logs-normalized, then runs the existing
detection and correlation engine on each burst of new events and writes the
alerts and incidents indices that the backend (STORE_BACKEND=elasticsearch) serves.

It writes only logs-normalized, alerts and incidents. It never touches winlogbeat-*.

  python -m scripts.live_bridge                   # live: handle events from now on
  python -m scripts.live_bridge --replay-from 2026-10-07T02:03:00Z --replay-to 2026-10-07T02:04:00Z --dry-run
"""
from __future__ import annotations

import argparse
import logging
import time
from dataclasses import asdict
from datetime import datetime, timezone

from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk

from engine.correlation.correlator import Correlator
from engine.detection.baseline import Baseline
from engine.detection.engine import DetectionEngine
from engine.normalizer.schema import NormalizedEvent
from engine.pipeline import ALERTS_INDEX, INCIDENTS_INDEX, LOGS_INDEX

log = logging.getLogger("csa_ops.bridge")

SOURCE_INDEX = "winlogbeat-*"
SYSMON = {"term": {"winlog.channel": "Microsoft-Windows-Sysmon/Operational"}}
CODES = ["1", "3", "10", "11", "12", "13"]
EVENT_TYPE = {
    "1": "process_start",
    "3": "network_connection",
    "10": "process_access",
    "11": "file_event",
    "12": "registry_event",
    "13": "registry_event",
}
QUIET_SECONDS = 3.0  # a burst is handled once no new event has arrived for this long


def _get(d: dict, *path):
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def to_normalized(src: dict) -> dict | None:
    code = str(_get(src, "event", "code") or _get(src, "winlog", "event_id") or "")
    if code not in EVENT_TYPE:
        return None
    ed = _get(src, "winlog", "event_data") or {}
    name, domain = _get(src, "user", "name"), _get(src, "user", "domain")
    user = f"{domain}\\{name}" if name and domain else name
    ev = NormalizedEvent(
        timestamp=src.get("@timestamp"),
        host=_get(src, "host", "name") or _get(src, "host", "hostname"),
        user=user,
        event_type=EVENT_TYPE[code],
        process_name=_get(src, "process", "executable") or ed.get("Image") or ed.get("SourceImage"),
        pid=_int(_get(src, "process", "pid") or ed.get("ProcessId") or ed.get("SourceProcessId")),
    )
    if code == "1":
        ev.parent_process_name = _get(src, "process", "parent", "executable")
        ev.parent_pid = _int(_get(src, "process", "parent", "pid"))
        ev.command_line = _get(src, "process", "command_line")
    elif code == "3":
        ev.dest_ip = _get(src, "destination", "ip")
        ev.dest_port = _int(_get(src, "destination", "port"))
    elif code == "11":
        ev.file_path = _get(src, "file", "path")
    elif code in ("12", "13"):
        ev.registry_key = _get(src, "registry", "path")
    elif code == "10":
        ev.target_process_name = ed.get("TargetImage")
        ev.target_pid = _int(ed.get("TargetProcessId"))
    return asdict(ev)


def fetch(es: Elasticsearch, *, field: str, gt: str, lte: str | None = None, size: int = 5000) -> list[dict]:
    rng = {"gt": gt} | ({"lte": lte} if lte else {})
    res = es.search(
        index=SOURCE_INDEX,
        size=size,
        query={"bool": {"filter": [SYSMON, {"terms": {"event.code": CODES}}, {"range": {field: rng}}]}},
        sort=[{field: "asc"}],
    )
    return res["hits"]["hits"]


def process(es, engine, correlator, hits: list[dict], *, write: bool) -> tuple[int, int, int]:
    events = []
    for h in hits:
        doc = to_normalized(h["_source"])
        if doc:
            events.append(doc | {"event_id": h["_id"]})
    events.sort(key=lambda e: e["timestamp"] or "")
    alerts, first_time = [], set()
    for e in events:
        r = engine.evaluate(e)
        alerts.extend(r.alerts)
        if r.first_time_process or r.first_time_pair:
            first_time.add(e["event_id"])
    incidents = correlator.correlate(events, alerts, first_time_event_ids=first_time).incidents if events else []
    if write and events:
        bulk(es, [{"_index": LOGS_INDEX, "_id": e["event_id"], "_source": {k: v for k, v in e.items() if k != "event_id"}} for e in events])
        if alerts:
            bulk(es, [{"_index": ALERTS_INDEX, "_id": a["alert_id"], "_source": a} for a in alerts])
        if incidents:
            bulk(es, [{"_index": INCIDENTS_INDEX, "_id": i["incident_id"], "_source": i} for i in incidents])
        es.indices.refresh(index=[LOGS_INDEX, ALERTS_INDEX, INCIDENTS_INDEX], ignore_unavailable=True)
    for i in incidents:
        log.info("INCIDENT %s severity=%s scenario=%s techniques=%s host=%s", i["incident_id"][:8], i["severity"], i.get("matched_scenario"), i.get("techniques"), i.get("host"))
    return len(events), len(alerts), len(incidents)


def prime(es, engine, until: str | None) -> int:
    """Let the baseline learn what is normal on this machine, without writing anything."""
    n, after = 0, "1970-01-01T00:00:00Z"
    while True:
        hits = fetch(es, field="@timestamp", gt=after, lte=until, size=5000)
        if not hits:
            return n
        for h in hits:
            doc = to_normalized(h["_source"])
            if doc:
                engine.evaluate(doc | {"event_id": h["_id"]})
                n += 1
        after = hits[-1]["_source"]["@timestamp"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--es", default="http://localhost:9200")
    ap.add_argument("--replay-from", help="replay events after this @timestamp (ISO) instead of running live")
    ap.add_argument("--replay-to", help="replay events up to this @timestamp (ISO)")
    ap.add_argument("--dry-run", action="store_true", help="print what would be written, write nothing")
    ap.add_argument("--no-prime", action="store_true", help="skip learning the baseline from history")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    es = Elasticsearch(args.es, request_timeout=20)
    engine, correlator = DetectionEngine(baseline=Baseline()), Correlator()

    if args.replay_from:
        if not args.no_prime:
            log.info("baseline learned from %d earlier event(s)", prime(es, engine, args.replay_from))
        hits = fetch(es, field="@timestamp", gt=args.replay_from, lte=args.replay_to)
        e, a, i = process(es, engine, correlator, hits, write=not args.dry_run)
        log.info("replay: %d event(s) -> %d alert(s) -> %d incident(s)%s", e, a, i, " (dry run)" if args.dry_run else "")
        return

    start = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if not args.no_prime:
        log.info("baseline learned from %d earlier event(s)", prime(es, engine, start))
    log.info("live: watching %s for new Sysmon events (burst handled after %.0fs of quiet). Ctrl+C to stop.", SOURCE_INDEX, QUIET_SECONDS)
    mark, seen, buf, last_new = start, set(), [], 0.0
    while True:
        try:
            for h in fetch(es, field="event.ingested", gt=mark):
                mark = max(mark, h["_source"]["event"]["ingested"])
                if h["_id"] not in seen:
                    seen.add(h["_id"])
                    buf.append(h)
                    last_new = time.time()
            if buf and time.time() - last_new >= QUIET_SECONDS:
                e, a, i = process(es, engine, correlator, buf, write=True)
                log.info("burst: %d event(s) -> %d alert(s) -> %d incident(s)", e, a, i)
                buf = []
        except Exception as exc:  # keep the demo running through a transient error
            log.warning("poll failed: %s", exc)
        time.sleep(1.0)


if __name__ == "__main__":
    main()
