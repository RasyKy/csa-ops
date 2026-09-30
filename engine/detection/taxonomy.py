"""Maps Sigma/Sysmon field names to CSA-OPS normalized event fields.

Sigma rules are written against the field names an analyst reads in Sysmon
(Image, CommandLine, ParentImage, TargetImage, DestinationIp, ...). Our
normalized events (engine/normalizer/schema.py, NormalizedEvent) use shorter
common names (process_name, command_line, parent_process_name, ...). This
table is the single translation point between the two, so a Sigma rule copied
from SigmaHQ needs no rewriting and the engine needs no per-rule code
(NFR-1).

A Sigma logsource `category` maps to one of NormalizedEvent.event_type via
CATEGORY_TO_EVENT_TYPE; a rule with no category matches events of any type.
"""

# Sigma field name -> NormalizedEvent attribute name.
FIELD_MAP = {
    "Image": "process_name",
    "ProcessName": "process_name",
    "SourceImage": "process_name",  # process_access: the accessing process
    "CommandLine": "command_line",
    "ParentImage": "parent_process_name",
    "ParentProcessName": "parent_process_name",
    "TargetImage": "target_process_name",
    "TargetProcessName": "target_process_name",
    "DestinationIp": "dest_ip",
    "DestinationPort": "dest_port",
    "TargetFilename": "file_path",
    "TargetObject": "registry_key",
    "User": "user",
    "Computer": "host",
    "Hostname": "host",
    "ProcessId": "pid",
    "ParentProcessId": "parent_pid",
    "TargetProcessId": "target_pid",
}

# Sigma logsource.category -> NormalizedEvent.event_type.
CATEGORY_TO_EVENT_TYPE = {
    "process_creation": "process_start",
    "process_access": "process_access",
    "network_connection": "network_connection",
    "file_event": "file_event",
    "file_create": "file_event",
    "registry_event": "registry_event",
    "registry_set": "registry_event",
    "registry_add": "registry_event",
}


def resolve_field(sigma_field: str) -> str:
    """Return the NormalizedEvent attribute a Sigma field name refers to.

    Unknown field names pass through unchanged, so a rule can also match on a
    normalized field directly (e.g. `event_type`)."""
    return FIELD_MAP.get(sigma_field, sigma_field)
