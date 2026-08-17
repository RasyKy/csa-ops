from dataclasses import dataclass
from typing import Optional

EVENT_TYPES = {
    "process_start",
    "network_connection",
    "file_event",
    "registry_event",
    "process_access",
}


@dataclass
class NormalizedEvent:
    timestamp: str  # ISO format
    host: str
    user: str
    event_type: str  # one of EVENT_TYPES
    process_name: str
    pid: int
    parent_process_name: Optional[str] = None
    parent_pid: Optional[int] = None

    # event_type == "network_connection"
    dest_ip: Optional[str] = None
    dest_port: Optional[int] = None

    # event_type == "file_event"
    file_path: Optional[str] = None

    # event_type == "registry_event"
    registry_key: Optional[str] = None

    # event_type == "process_access" (process_name/pid stay the accessing
    # process, consistent with every other event type, so correlation can
    # always link on pid/parent_pid)
    target_process_name: Optional[str] = None
    target_pid: Optional[int] = None
