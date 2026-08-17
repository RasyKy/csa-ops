import json
import time
from dataclasses import asdict
from kafka import KafkaConsumer
from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk

from schema import NormalizedEvent

KAFKA_BROKER = "localhost:9092"
KAFKA_TOPIC = "raw-events"
ES_HOST = "http://localhost:9200"
ES_INDEX = "logs-normalized"

BATCH_SIZE = 200          # flush once the buffer reaches this many events
FLUSH_INTERVAL_SECONDS = 1  # or flush after this long, whichever comes first

# Sysmon event code -> {common field: raw field in winlog.event_data}
# Extend this as you add rules that need other event types.
EVENT_FIELD_MAPS = {
    "1": {  # Process Create
        "process_name": "Image",
        "process_pid": "ProcessId",
        "parent_process_name": "ParentImage",
        "parent_process_pid": "ParentProcessId",
        "command_line": "CommandLine",
        "user": "User",
    },
    "10": {  # Process Access
        "process_name": "SourceImage",       # process doing the accessing
        "process_pid": "SourceProcessId",
        "target_process_name": "TargetImage",  # process being accessed, e.g. lsass.exe
        "target_process_pid": "TargetProcessId",
        "user": "SourceUser",
    },
    "11": {  # File Create
        "process_name": "Image",
        "process_pid": "ProcessId",
        "target_file": "TargetFilename",
        "user": "User",
    },
    "3": {  # Network Connect
        "process_name": "Image",
        "process_pid": "ProcessId",
        "dest_ip": "DestinationIp",
        "dest_port": "DestinationPort",
        "user": "User",
    },
    "12": {  # Registry Object Created/Deleted
        "process_name": "Image",
        "process_pid": "ProcessId",
        "registry_key": "TargetObject",
        "user": "User",
    },
    "13": {  # Registry Value Set
        "process_name": "Image",
        "process_pid": "ProcessId",
        "registry_key": "TargetObject",
        "user": "User",
    },
}

# Sysmon event code -> NormalizedEvent.event_type.
EVENT_TYPE_BY_CODE = {
    "1": "process_start",
    "3": "network_connection",
    "10": "process_access",
    "11": "file_event",
    "12": "registry_event",
    "13": "registry_event",
}


def normalize(raw):
    winlog = raw.get("winlog", {})
    event_data = winlog.get("event_data", {})
    event_code = str(winlog.get("event_id", raw.get("event", {}).get("code", "")))

    normalized = {
        "time": raw.get("@timestamp"),
        "host": raw.get("host", {}).get("name"),
        "event_code": event_code,
        "event_type": winlog.get("task"),
    }

    for common_field, raw_field in EVENT_FIELD_MAPS.get(event_code, {}).items():
        normalized[common_field] = event_data.get(raw_field)

    return normalized


def to_normalized_event(normalized):
    return NormalizedEvent(
        timestamp=normalized.get("time"),
        host=normalized.get("host"),
        user=normalized.get("user"),
        event_type=EVENT_TYPE_BY_CODE.get(normalized.get("event_code"), normalized.get("event_code")),
        process_name=normalized.get("process_name"),
        pid=normalized.get("process_pid"),
        parent_process_name=normalized.get("parent_process_name"),
        parent_pid=normalized.get("parent_process_pid"),
        dest_ip=normalized.get("dest_ip"),
        dest_port=normalized.get("dest_port"),
        file_path=normalized.get("target_file"),
        registry_key=normalized.get("registry_key"),
        target_process_name=normalized.get("target_process_name"),
        target_pid=normalized.get("target_process_pid"),
    )


def flush(es, batch):
    if not batch:
        return
    actions = [{"_index": ES_INDEX, "_source": asdict(doc)} for doc in batch]
    bulk(es, actions)
    print(f"flushed {len(batch)} events in one bulk request")
    batch.clear()


def main():
    consumer = KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=[KAFKA_BROKER],
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        group_id="normalizer",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        consumer_timeout_ms=1000,  # lets the loop below check the flush timer even when idle
    )
    es = Elasticsearch(ES_HOST)

    batch = []
    last_flush = time.time()

    print(f"Listening on '{KAFKA_TOPIC}', writing to '{ES_INDEX}' in batches of up to {BATCH_SIZE}...")

    try:
        while True:
            for message in consumer:
                batch.append(to_normalized_event(normalize(message.value)))
                if len(batch) >= BATCH_SIZE:
                    flush(es, batch)
                    last_flush = time.time()

            # consumer_timeout_ms causes the loop above to end when idle for a second,
            # this is where we flush whatever's left even if the batch never filled up
            if time.time() - last_flush >= FLUSH_INTERVAL_SECONDS:
                flush(es, batch)
                last_flush = time.time()
    except KeyboardInterrupt:
        flush(es, batch)  # don't lose a partial batch on Ctrl+C
        print("stopped")


if __name__ == "__main__":
    main()