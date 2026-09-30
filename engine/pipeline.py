"""End-to-end detection + correlation pipeline.

normalized events -> detection (alerts) -> correlation (incidents).

Two entry points share the same core (`run`):
  * run_file:  read normalized events from a JSON file, write alerts.json and
    incidents.json. This is what runs on any machine, with no Docker, and what
    the tests exercise.
  * run_elasticsearch: read the logs-normalized index and write the alerts and
    incidents indices. Same code path as Person B's store: fixtures-first, ES
    as a config swap. Implemented but, like es_store.py, unverified against a
    live cluster.
"""
from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from engine.correlation.correlator import Correlator, CorrelationRun
from engine.detection.baseline import Baseline
from engine.detection.engine import DetectionEngine

logger = logging.getLogger("csa_ops.pipeline")

ALERTS_INDEX = "alerts"
INCIDENTS_INDEX = "incidents"
LOGS_INDEX = "logs-normalized"


@dataclass
class PipelineResult:
    alerts: list[dict] = field(default_factory=list)
    incidents: list[dict] = field(default_factory=list)
    run: CorrelationRun = field(default_factory=CorrelationRun)


def _ensure_event_ids(events: list[dict]) -> list[dict]:
    """Give every event a stable event_id if it lacks one, so alerts and chain
    nodes can reference it. ES documents arrive with an _id; file input may
    not."""
    for i, event in enumerate(events):
        if not event.get("event_id"):
            event["event_id"] = f"evt-{i:05d}"
    return events


def run(
    events: list[dict],
    *,
    engine: DetectionEngine | None = None,
    correlator: Correlator | None = None,
) -> PipelineResult:
    """Pure core: events in, alerts + incidents out. Order matters -- the
    baseline learns as the stream is processed."""
    events = _ensure_event_ids(list(events))
    engine = engine or DetectionEngine(baseline=Baseline())
    correlator = correlator or Correlator()

    alerts: list[dict] = []
    first_time_event_ids: set = set()
    for event in events:
        result = engine.evaluate(event)
        alerts.extend(result.alerts)
        if result.first_time_process or result.first_time_pair:
            first_time_event_ids.add(event.get("event_id"))

    corr = correlator.correlate(events, alerts, first_time_event_ids=first_time_event_ids)
    return PipelineResult(alerts=alerts, incidents=corr.incidents, run=corr)


def run_file(input_path: Path, alerts_out: Path, incidents_out: Path) -> PipelineResult:
    events = json.loads(Path(input_path).read_text())
    if not isinstance(events, list):
        raise ValueError(f"{input_path}: expected a JSON array of normalized events")

    result = run(events)

    Path(alerts_out).parent.mkdir(parents=True, exist_ok=True)
    Path(alerts_out).write_text(json.dumps(result.alerts, indent=2))
    Path(incidents_out).parent.mkdir(parents=True, exist_ok=True)
    Path(incidents_out).write_text(json.dumps(result.incidents, indent=2))

    logger.info(
        "pipeline: %d event(s) -> %d alert(s) -> %d incident(s); wrote %s and %s",
        len(events), len(result.alerts), len(result.incidents), alerts_out, incidents_out,
    )
    return result


def run_elasticsearch(es_host: str, *, size: int = 10_000) -> PipelineResult:
    """Read logs-normalized, write alerts and incidents. Untested against a
    live cluster -- see docs/person_a.md Known limitations."""
    from elasticsearch import Elasticsearch  # lazy: only needed in ES mode
    from elasticsearch.helpers import bulk

    es = Elasticsearch(es_host, request_timeout=10)
    hits = es.search(index=LOGS_INDEX, query={"match_all": {}}, size=size, sort=[{"timestamp": "asc"}])
    events = [hit["_source"] | {"event_id": hit["_id"]} for hit in hits["hits"]["hits"]]

    result = run(events)

    if result.alerts:
        bulk(es, [{"_index": ALERTS_INDEX, "_id": a["alert_id"], "_source": a} for a in result.alerts])
    if result.incidents:
        bulk(es, [{"_index": INCIDENTS_INDEX, "_id": i["incident_id"], "_source": i} for i in result.incidents])

    logger.info(
        "pipeline (ES): %d event(s) -> %d alert(s) -> %d incident(s)",
        len(events), len(result.alerts), len(result.incidents),
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="CSA-OPS detection + correlation pipeline")
    parser.add_argument("input", nargs="?", help="JSON file of normalized events (file mode)")
    parser.add_argument("--alerts-out", default="fixtures/alerts.generated.json")
    parser.add_argument("--incidents-out", default="fixtures/incidents.generated.json")
    parser.add_argument("--elasticsearch", metavar="ES_HOST", help="read/write ES instead of files")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)

    if args.elasticsearch:
        result = run_elasticsearch(args.elasticsearch)
    elif args.input:
        result = run_file(Path(args.input), Path(args.alerts_out), Path(args.incidents_out))
    else:
        parser.error("provide an input file, or --elasticsearch ES_HOST")

    print(
        f"{len(result.alerts)} alert(s), {len(result.incidents)} incident(s), "
        f"noise reduction {result.run.noise_reduction_ratio:.2f}:1"
    )


if __name__ == "__main__":
    main()
