"""Telemetry realism and safety: the data must look like Windows Sysmon output
and stay inside the documentation-only allowlists."""
import base64
import ipaddress
import re
from datetime import datetime

from scripts.scenarios.definitions import SCENARIOS

ALLOWED_NETWORKS = [
    ipaddress.ip_network(n)
    for n in (
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
        "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24",
    )
]
ALLOWED_DOMAIN_SUFFIXES = ("example.com", ".test", ".invalid")
FILE_EXTENSIONS = {
    "exe", "dll", "dmp", "docm", "csv", "cfg", "txt", "ps1", "bat", "vbs", "js", "scr", "docx", "log", "dat",
}
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
EVENT_ID_RE = re.compile(r"^evt-s[1-8]-\d{2}$")
USER_RE = re.compile(r"^(CORP\\[a-z]+|NT AUTHORITY\\SYSTEM)$")
IPV4_RE = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])")
HOST_RE = re.compile(r"(?<![\\/\w.-])((?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,})(?![\w.])", re.IGNORECASE)
ENC_RE = re.compile(r" -enc (\S+)")
STRING_FIELDS = ("process_name", "parent_process_name", "command_line", "file_path", "registry_key", "target_process_name")
PATH_FIELDS = ("process_name", "parent_process_name", "file_path", "target_process_name")


def _by_scenario(generated):
    groups = {s["id"]: [] for s in SCENARIOS}
    for event in generated["events"]:
        groups[event["event_id"].split("-")[1]].append(event)
    return groups


def _own_events(generated):
    background = {eid for row in generated["manifest"] for eid in row["background_event_ids"]}
    return {
        sid: [e for e in events if e["event_id"] not in background]
        for sid, events in _by_scenario(generated).items()
    }


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_event_ids_timestamps_and_users(generated):
    events = generated["events"]
    assert [e["timestamp"] for e in events] == sorted(e["timestamp"] for e in events)
    for event in events:
        assert EVENT_ID_RE.match(event["event_id"])
        assert TS_RE.match(event["timestamp"])
        assert USER_RE.match(event["user"]), event["user"]


def test_pids_unique_per_host_and_multiples_of_four(generated):
    process_pids: dict[str, dict[int, str]] = {}
    for event in generated["events"]:
        for key in ("pid", "parent_pid"):
            assert event[key] % 4 == 0, (event["event_id"], key, event[key])
        if event.get("target_pid") is not None:
            assert event["target_pid"] % 4 == 0
        if event["event_type"] == "process_start":
            seen = process_pids.setdefault(event["host"], {})
            assert event["pid"] not in seen, f"pid {event['pid']} reused on {event['host']}"
            seen[event["pid"]] = event["event_id"]
    for event in generated["events"]:
        if event["event_type"] != "process_start":
            assert event["pid"] in process_pids[event["host"]], event["event_id"]
    for event in generated["events"]:
        if event["event_type"] == "process_start":
            assert event["parent_pid"] != event["pid"]


def test_every_parent_pid_resolves_inside_the_scenario(generated):
    for sid, events in _own_events(generated).items():
        ordered = sorted(events, key=lambda e: (e["timestamp"], e["event_id"]))
        started: dict[int, datetime] = {}
        roots = []
        for event in ordered:
            if event["parent_pid"] in started:
                assert started[event["parent_pid"]] <= _ts(event["timestamp"])
            else:
                roots.append(event["event_id"])
            if event["event_type"] == "process_start":
                started[event["pid"]] = _ts(event["timestamp"])
        assert len(roots) == 1, f"{sid} has {len(roots)} unresolved roots: {roots}"
        assert ordered[0]["event_id"] == roots[0]


def test_pacing_within_scenarios_and_across_chain_edges(generated):
    by_id = {e["event_id"]: e for e in generated["events"]}
    for sid, events in _own_events(generated).items():
        ordered = sorted(events, key=lambda e: e["timestamp"])
        gaps = [(_ts(b["timestamp"]) - _ts(a["timestamp"])).total_seconds() for a, b in zip(ordered, ordered[1:])]
        assert all(0 <= g <= 300 for g in gaps), (sid, gaps)
    for incident in generated["incidents"]:
        for edge in incident["chain"]["edges"]:
            a, b = by_id[edge["from"]], by_id[edge["to"]]
            gap = abs((_ts(a["timestamp"]) - _ts(b["timestamp"])).total_seconds())
            assert gap <= 300, (incident["incident_id"], edge, gap)


def test_ips_are_rfc1918_or_documentation(generated):
    for event in generated["events"]:
        candidates = []
        if event.get("dest_ip"):
            candidates.append(event["dest_ip"])
        for field in STRING_FIELDS:
            candidates.extend(IPV4_RE.findall(event.get(field) or ""))
        for text in candidates:
            address = ipaddress.ip_address(text)
            assert any(address in net for net in ALLOWED_NETWORKS), (event["event_id"], text)
    for event in generated["events"]:
        if event.get("dest_ip"):
            assert event["dest_port"] in (135, 443, 445)


def test_domains_only_under_allowed_suffixes(generated):
    for event in generated["events"]:
        for field in STRING_FIELDS:
            for token in HOST_RE.findall(event.get(field) or ""):
                if token.rsplit(".", 1)[-1].lower() in FILE_EXTENSIONS:
                    continue
                assert token.lower().endswith(ALLOWED_DOMAIN_SUFFIXES), (event["event_id"], token)


def test_encoded_commands_decode_to_the_harmless_string(generated):
    found = set()
    for event in generated["events"]:
        command = event.get("command_line") or ""
        for payload in ENC_RE.findall(command):
            scenario_id = event["event_id"].split("-")[1]
            decoded = base64.b64decode(payload).decode("utf-16-le")
            assert decoded == f"Write-Output '{scenario_id} simulated activity'"
            found.add(scenario_id)
    assert found == {"s1", "s4", "s5", "s6", "s7"}


def test_no_truncated_text_and_paths_have_drive_letters(generated):
    for event in generated["events"]:
        for field in STRING_FIELDS:
            assert "..." not in (event.get(field) or ""), (event["event_id"], field)
        for field in PATH_FIELDS:
            value = event.get(field)
            if value:
                assert re.match(r"^[A-Za-z]:\\", value), (event["event_id"], field, value)
        if event["event_type"] == "process_start":
            assert event["command_line"]
        if event["event_type"] == "registry_event":
            assert event["registry_key"].startswith("HKU\\")


def test_three_background_events_per_host(generated):
    for row in generated["manifest"]:
        assert len(row["background_event_ids"]) == 3
    by_id = {e["event_id"]: e for e in generated["events"]}
    for row in generated["manifest"]:
        images = {by_id[eid]["process_name"].rsplit("\\", 1)[-1] for eid in row["background_event_ids"]}
        assert images == {"chrome.exe", "svchost.exe"}


def test_no_real_infrastructure_markers(generated):
    blob = " ".join(str(v) for e in generated["events"] for v in e.values()).lower()
    for marker in ("mimikatz", "cobalt", "http://", "https://", "meterpreter"):
        assert marker not in blob
