"""Generate realistic single-host attack scenarios and run them through the real
detection and correlation pipeline.

Usage:
    python scripts/generate_scenarios.py [--anchor now|ISO8601Z] [--out fixtures/realistic]

Writes normalized_events.json, alerts.json, incidents.json and scenarios.json
into --out and nothing else. All content is synthetic: documentation IP ranges,
example.com style names, harmless encoded strings.

The pipeline is called through engine.pipeline.run (pure, no file output). Only
ids, the incident raised time (wall clock otherwise) and analyst labels are
post-processed, so the output is byte-identical for a fixed anchor.
"""
from __future__ import annotations

import argparse
import base64
import itertools
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from engine.correlation.correlator import Correlator  # noqa: E402
from engine.pipeline import run  # noqa: E402
from scripts.scenarios import definitions as defs  # noqa: E402

DEFAULT_OUT = REPO_ROOT / "fixtures" / "realistic"
OUTPUT_FILES = ("normalized_events.json", "alerts.json", "incidents.json", "scenarios.json")
RAISED_PLACEHOLDER = "__raised__"
INCIDENT_RAISE_DELAY_MS = 500

# Directories the generator must never write into.
_FORBIDDEN_OUT = ("data", "rules", "engine", "backend", "dashboard", "tests", "docs", "scripts", ".git")
_FORBIDDEN_EXACT = (Path("fixtures"), Path("fixtures") / "eval")

FALSE_POSITIVE_SCENARIO = "s7"
CONFIRMED_TRUE_SCENARIOS = ("s1", "s4", "s5")


def harmless_b64(scenario_id: str) -> str:
    text = f"Write-Output '{scenario_id} simulated activity'"
    return base64.b64encode(text.encode("utf-16-le")).decode("ascii")


def _fmt_ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse_anchor(anchor) -> datetime:
    if isinstance(anchor, datetime):
        dt = anchor if anchor.tzinfo else anchor.replace(tzinfo=timezone.utc)
    elif anchor == "now":
        dt = datetime.now(timezone.utc)
    else:
        dt = datetime.fromisoformat(str(anchor).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.replace(microsecond=(dt.microsecond // 1000) * 1000)


def _check_out_dir(out_dir: Path) -> Path:
    resolved = Path(out_dir).resolve()
    try:
        rel = resolved.relative_to(REPO_ROOT)
    except ValueError:
        return resolved  # outside the repo: allowed (tests use tmp dirs)
    if rel.parts and rel.parts[0] in _FORBIDDEN_OUT:
        raise ValueError(f"refusing to write into protected directory: {rel}")
    if rel in _FORBIDDEN_EXACT or str(rel) == ".":
        raise ValueError(f"refusing to write into protected directory: {rel}")
    return resolved


class _PidAllocator:
    """Unique PIDs per host, always multiples of 4, increasing in allocation order."""

    def __init__(self, host: str):
        self._rng = random.Random(f"pids:{host}")
        self._last = 3000 + 4 * self._rng.randint(0, 200)
        self.used: set[int] = set()

    def next(self) -> int:
        self._last += 4 * self._rng.randint(2, 40)
        self.used.add(self._last)
        return self._last


def _build_scenario_events(scn: dict, anchor: datetime) -> tuple[list[dict], list[str]]:
    """Return (events, background_event_ids) for one scenario, unsorted."""
    sid = scn["id"]
    host, user = scn["host"], scn["user"]
    name = user.split("\\")[-1]
    pids = _PidAllocator(host)

    lsass_pid = pids.next()
    fmt = {"b64": harmless_b64(sid), "name": name, "sid": scn["sid"], "lsass_pid": lsass_pid}

    def f(value: str) -> str:
        return value.format(**fmt)

    handles: dict[str, dict] = {}
    start = anchor - timedelta(seconds=scn["start_offset_seconds"])
    clock = start
    events: list[dict] = []

    def base(event_type: str, proc: dict) -> dict:
        return {
            "event_id": "",
            "timestamp": _fmt_ts(clock),
            "host": host,
            "user": user,
            "event_type": event_type,
            "process_name": proc["image"],
            "pid": proc["pid"],
            "parent_process_name": proc["parent_image"],
            "parent_pid": proc["parent_pid"],
        }

    for step in scn["steps"]:
        clock = clock + timedelta(milliseconds=round(step["delay"] * 1000))
        if "proc" in step:
            if step.get("parent"):
                parent = handles[step["parent"]]
                parent_image, parent_pid = parent["image"], parent["pid"]
            else:
                parent_image, parent_pid = step["root_parent_image"], pids.next()
            proc = {
                "image": f(step["image"]),
                "pid": pids.next(),
                "parent_image": parent_image,
                "parent_pid": parent_pid,
            }
            handles[step["proc"]] = proc
            event = base("process_start", proc)
            event["command_line"] = f(step["cmd"])
        else:
            proc = handles[step["of"]]
            event = base(step["type"], proc)
            if step["type"] == "network_connection":
                event["dest_ip"] = step["dest_ip"]
                event["dest_port"] = step["dest_port"]
            elif step["type"] == "file_event":
                event["file_path"] = f(step["file_path"])
            elif step["type"] == "registry_event":
                event["registry_key"] = f(step["registry_key"])
            elif step["type"] == "process_access":
                event["target_process_name"] = step["target_image"]
                event["target_pid"] = lsass_pid
            else:
                raise ValueError(f"unknown step type {step['type']}")
        events.append(event)

    span = (clock - start).total_seconds()
    rng = random.Random(f"background:{sid}")
    chrome_pid, chrome_parent_pid, svchost_pid, svchost_parent_pid = (pids.next() for _ in range(4))
    chrome_start = start - timedelta(seconds=rng.randint(300, 900))
    chrome_conn = chrome_start + timedelta(milliseconds=rng.randint(8000, 40000))
    svchost_start = start + timedelta(milliseconds=rng.randint(1000, max(2000, int(span * 1000))))
    explorer_img = defs.EXPLORER
    chrome = defs.BACKGROUND_CHROME

    def bg(ts: datetime, user_: str, etype: str, image: str, pid: int, parent_image: str, parent_pid: int) -> dict:
        return {
            "event_id": "",
            "timestamp": _fmt_ts(ts),
            "host": host,
            "user": user_,
            "event_type": etype,
            "process_name": image,
            "pid": pid,
            "parent_process_name": parent_image,
            "parent_pid": parent_pid,
        }

    bg_chrome = bg(chrome_start, user, "process_start", chrome, chrome_pid, explorer_img, chrome_parent_pid)
    bg_chrome["command_line"] = "chrome.exe"
    bg_conn = bg(chrome_conn, user, "network_connection", chrome, chrome_pid, explorer_img, chrome_parent_pid)
    bg_conn["dest_ip"], bg_conn["dest_port"] = defs.BACKGROUND_NET_DEST
    bg_svc = bg(
        svchost_start, defs.BACKGROUND_SYSTEM_USER, "process_start", defs.BACKGROUND_SVCHOST,
        svchost_pid, defs.SERVICES, svchost_parent_pid,
    )
    bg_svc["command_line"] = defs.BACKGROUND_SVCHOST_CMD
    background = [bg_chrome, bg_svc, bg_conn]

    ordered = sorted(events, key=lambda e: e["timestamp"])
    numbered = []
    for index, event in enumerate(ordered, start=1):
        event["event_id"] = f"evt-{sid}-{index:02d}"
        numbered.append(event)
    bg_ids = []
    for offset, event in enumerate(background, start=len(ordered) + 1):
        event["event_id"] = f"evt-{sid}-{offset:02d}"
        bg_ids.append(event["event_id"])
        numbered.append(event)
    return numbered, bg_ids


def _post_process(result, scenarios: list[dict], events: list[dict]) -> tuple[list[dict], list[dict]]:
    """Deterministic ids, raised time and analyst labels. Nothing else changes."""
    host_to_scn = {s["host"]: s for s in scenarios}
    order = {s["id"]: i for i, s in enumerate(scenarios)}
    ts_by_event = {e["event_id"]: e["timestamp"] for e in events}

    alerts_by_scn: dict[str, list[dict]] = {}
    for alert in result.alerts:
        alerts_by_scn.setdefault(host_to_scn[alert["host"]]["id"], []).append(alert)

    id_map: dict[str, str] = {}
    for scn_id, group in alerts_by_scn.items():
        group.sort(key=lambda a: (a["timestamp"], a["event_id"], a["rule_id"]))
        for letter, alert in zip("abcdefghijklmnopqrstuvwxyz", group):
            id_map[alert["alert_id"]] = f"alert-{1000 + order[scn_id] + 1}{letter}"

    for scn_id, group in alerts_by_scn.items():
        for position, alert in enumerate(group):
            alert["alert_id"] = id_map[alert["alert_id"]]
            if scn_id == FALSE_POSITIVE_SCENARIO:
                alert["false_positive"] = True
            elif scn_id in CONFIRMED_TRUE_SCENARIOS and position == 0:
                alert["false_positive"] = False

    incidents = []
    for incident in result.incidents:
        scn = host_to_scn[incident["host"]]
        incident["incident_id"] = f"inc-{1000 + order[scn['id']] + 1}"
        incident["alert_ids"] = sorted(id_map[a] for a in incident["alert_ids"])
        last_alert_ts = max(
            ts_by_event[node["event_id"]] for node in incident["chain"]["nodes"] if node["rule_id"]
        )
        raised = datetime.fromisoformat(last_alert_ts.replace("Z", "+00:00")) + timedelta(
            milliseconds=INCIDENT_RAISE_DELAY_MS
        )
        incident["incident_raised_time"] = _fmt_ts(raised)
        incidents.append(incident)
    incidents.sort(key=lambda i: i["incident_id"])

    alerts = sorted(result.alerts, key=lambda a: (a["timestamp"], a["alert_id"]))
    return alerts, incidents


def _dump(path: Path, data) -> None:
    text = json.dumps(data, indent=2) + "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def generate(anchor, out_dir=DEFAULT_OUT) -> dict:
    """Build the scenarios, run the real pipeline, write the four JSON files."""
    anchor_dt = parse_anchor(anchor)
    out_path = _check_out_dir(Path(out_dir))
    scenarios = defs.SCENARIOS

    all_events: list[dict] = []
    background_ids: dict[str, list[str]] = {}
    scenario_events: dict[str, list[dict]] = {}
    for scn in scenarios:
        events, bg_ids = _build_scenario_events(scn, anchor_dt)
        scenario_events[scn["id"]] = events
        background_ids[scn["id"]] = bg_ids
        all_events.extend(events)
    scn_index = {s["id"]: i for i, s in enumerate(scenarios)}
    all_events.sort(key=lambda e: (e["timestamp"], scn_index[e["event_id"].split("-")[1]], e["event_id"]))

    counter = itertools.count(1)
    correlator = Correlator(
        id_factory=lambda: f"tmp-incident-{next(counter)}",
        clock=lambda: RAISED_PLACEHOLDER,
    )
    result = run(all_events, correlator=correlator)

    host_counts: dict[str, int] = {}
    for incident in result.incidents:
        host_counts[incident["host"]] = host_counts.get(incident["host"], 0) + 1
    for scn in scenarios:
        if host_counts.get(scn["host"], 0) != 1:
            raise RuntimeError(
                f"{scn['id']} ({scn['name']}) on {scn['host']} produced "
                f"{host_counts.get(scn['host'], 0)} incidents, expected exactly 1"
            )
    if len(result.incidents) != len(scenarios):
        raise RuntimeError(f"expected {len(scenarios)} incidents, got {len(result.incidents)}")

    alerts, incidents = _post_process(result, scenarios, all_events)

    incident_by_host = {i["host"]: i for i in incidents}
    manifest = []
    for scn in scenarios:
        incident = incident_by_host[scn["host"]]
        own_ids = {e["event_id"] for e in scenario_events[scn["id"]]}
        manifest.append(
            {
                "scenario_id": scn["id"],
                "name": scn["name"],
                "incident_id": incident["incident_id"],
                "host": scn["host"],
                "user": scn["user"],
                "event_count": len(scenario_events[scn["id"]]) - len(background_ids[scn["id"]]),
                "background_event_ids": background_ids[scn["id"]],
                "alert_count": sum(1 for a in alerts if a["event_id"] in own_ids),
                "expected_rules": sorted(scn["expected_rules"]),
                "narrative": scn["narrative"],
                "start_offset": scn["start_offset"],
                "start_time": _fmt_ts(anchor_dt - timedelta(seconds=scn["start_offset_seconds"])),
            }
        )

    out_path.mkdir(parents=True, exist_ok=True)
    _dump(out_path / "normalized_events.json", all_events)
    _dump(out_path / "alerts.json", alerts)
    _dump(out_path / "incidents.json", incidents)
    _dump(out_path / "scenarios.json", manifest)

    return {
        "anchor": _fmt_ts(anchor_dt),
        "events": all_events,
        "alerts": alerts,
        "incidents": incidents,
        "manifest": manifest,
        "out_dir": str(out_path),
    }


def _print_summary(result: dict) -> None:
    incidents = {i["host"]: i for i in result["incidents"]}
    print(f"anchor {result['anchor']} -> {result['out_dir']}")
    print(f"{'scenario':<32}{'host':<7}{'events':>6}{'alerts':>7}  {'incident':<9}{'severity':<9}{'risk':>5}  matched_scenario")
    for row in result["manifest"]:
        inc = incidents[row["host"]]
        print(
            f"{row['scenario_id'] + ' ' + row['name']:<32}{row['host']:<7}{row['event_count']:>6}"
            f"{row['alert_count']:>7}  {inc['incident_id']:<9}{inc['severity']:<9}{inc['risk_score']:>5}  {inc['matched_scenario']}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate realistic attack scenario fixtures")
    parser.add_argument("--anchor", default="now", help="'now' or an ISO 8601 UTC timestamp")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="output directory (default fixtures/realistic)")
    args = parser.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = (Path.cwd() / out).resolve()
    _print_summary(generate(args.anchor, out))


if __name__ == "__main__":
    main()
