# Interfaces: Person B <-> Person A / Ingestion

This document is the data contract Person B is building against. It is
section 4 of `CLAUDE.md` verbatim, plus the audit findings that changed some
of its assumptions, plus open questions for the other owners. Unlike
`CLAUDE.md` (gitignored, local-only), this file is committed so Person A and
whoever owns ingestion can actually see it.

## Audit findings that changed assumptions here (2026-09-13)

An audit of `RasyKy/csa-ops` found real, working ingestion code
(`engine/normalizer/consumer.py`, `schema.py`, `winlogbeat.yml`,
`sysmonconfig.xml`) on the **`dev`** branch, not `main`. `main` is 3 commits
behind and does not have it. Confirm with the team which branch is the actual
base before building anything.

1. **Real index name is `logs-normalized`**, not `events`. Section 4.1 below
   and any query code should target this name until/unless it's renamed.
2. **Real normalized schema** (`engine/normalizer/schema.py`, dataclass
   `NormalizedEvent`): `timestamp, host, user, event_type, process_name, pid,
   parent_process_name, parent_pid, dest_ip, dest_port, file_path,
   registry_key, target_process_name, target_pid`. `event_type` is one of
   `process_start, network_connection, file_event, registry_event,
   process_access`. No `command_line` field exists on the stored document.
3. **Bug to flag to whoever owns ingestion, not to fix ourselves:**
   `consumer.py`'s `normalize()` does extract `CommandLine` into a local
   dict, but `to_normalized_event()` never maps it onto `NormalizedEvent` —
   it's silently dropped before the ES write. Command-line text is the
   single most common signal Sigma rules and AI triage rely on. This blocks
   accurately populating `chain.nodes[].command_line` below until it's fixed
   upstream. Treat that field as optional/nullable in every consumer
   (dashboard, AI prompt) until it is.

Also found, not blocking B but worth relaying to whoever owns infra:
`docker-compose.yml`'s `KAFKA_ADVERTISED_LISTENERS` is pinned to
`localhost:9092`, which will not work once Winlogbeat runs on a separate
Machine 1 — the broker re-advertises `localhost` after the initial
connection and produce calls fail. And there is no Elasticsearch index
template for `logs-normalized`, so field types (e.g. `dest_ip`) are whatever
dynamic mapping guesses on first write. Neither blocks Person B's work
against fixtures, but both will bite in Phase 6 integration if unfixed.

## 4. Data contracts

Field names below are assumptions until Person A confirms. Fixtures under
`fixtures/` must match exactly so swapping to live data is a config change,
not a code change.

### 4.1 Indices

| Index | Owner | Purpose |
| --- | --- | --- |
| `logs-normalized` | ingestion | normalized Sysmon events (exists on `dev` branch; no index template yet) |
| `alerts` | A | one doc per rule hit |
| `incidents` | A | one doc per correlated incident |
| `incident_triage` | B | AI verdicts, keyed by `incident_id` |
| `response_actions` | B | every issued command and its result |
| `intake_state` | B | watermark and processed-set for idempotency |

### 4.2 Alert document (A writes, B reads)

```json
{
  "alert_id": "uuid",
  "timestamp": "2026-09-13T10:15:02.123Z",
  "rule_id": "T1003_lsass_access",
  "rule_title": "LSASS Memory Access",
  "technique": "T1003",
  "tactic": "credential_access",
  "severity": "high",
  "host": "WS01",
  "user": "CORP\\alice",
  "event_id": "uuid",
  "pid": 4412,
  "ppid": 1280,
  "image": "C:\\Windows\\System32\\rundll32.exe",
  "command_line": "..."
}
```

### 4.3 Incident document (A writes, B reads)

```json
{
  "incident_id": "uuid",
  "incident_raised_time": "2026-09-13T10:15:03.001Z",
  "host": "WS01",
  "user": "CORP\\alice",
  "severity": "high",
  "risk_score": 27,
  "matched_scenario": "credential_dump_chain",
  "techniques": ["T1059.001", "T1003"],
  "tactics": ["execution", "credential_access"],
  "alert_ids": ["uuid", "uuid"],
  "chain": {
    "nodes": [
      {"event_id": "uuid", "pid": 1280, "ppid": 900, "image": "...", "command_line": "...", "timestamp": "...", "technique": "T1059.001", "rule_id": "..."},
      {"event_id": "uuid", "pid": 4412, "ppid": 1280, "image": "...", "command_line": "...", "timestamp": "...", "technique": null, "rule_id": null}
    ],
    "edges": [
      {"from": "event_id", "to": "event_id", "relation": "parent"}
    ]
  },
  "targets": {
    "pids": [4412],
    "remote_ips": ["203.0.113.7"],
    "file_paths": ["C:\\Users\\alice\\AppData\\Local\\Temp\\x.exe"]
  }
}
```

`severity` enum: `low | medium | high | critical`. `matched_scenario` may be
`null`; the policy must handle that. `chain.nodes[].command_line` is
aspirational: the current `logs-normalized` documents do not carry it (see
the audit findings above). Treat it as optional/nullable in every consumer
(dashboard, AI prompt) until ingestion fixes it, rather than assuming it's
always present. `targets` is what the response engine acts on; if A cannot
produce it, B derives it from `chain.nodes` (pids from nodes, ips from
network events, paths from file events). `relation` enum: `parent | network
| file | registry`.

### 4.4 Incident handoff (A to B)

Preferred: A publishes each new incident to Kafka topic `incidents.raised`
(same JSON as 4.3). Fallback, and what B builds first because it needs
nothing from A: poll the `incidents` index every `INTAKE_POLL_SECONDS`
(default 2) for `incident_raised_time > watermark`, ordered ascending. Both
paths feed the same internal handler.

### 4.5 B-owned documents

`incident_triage`:

```json
{
  "incident_id": "uuid",
  "triage_time": "...",
  "triage_started_time": "...",
  "verdict": "true_positive | likely_true_positive | needs_review | likely_false_positive | false_positive",
  "confidence": "low | medium | high",
  "reason": "one line, max 200 chars",
  "model": "provider/model-id",
  "status": "ok | failed",
  "explain": null
}
```

`triage_started_time` is set when `triage_incident()` begins, before the LLM
call; `triage_time` remains the completion timestamp. The gap between them
is triage latency (NFR-8-adjacent, B's own step) -- deliberately not
`incident_raised_time` to `triage_time`, since the incident can be
arbitrarily old (a replayed fixture, a backlog item) without that saying
anything about how fast triage itself ran.

`explain` is populated on demand (FR-15) with `{summary, objective,
notable_details[], next_steps[], caveats[], generated_time}`.

`response_actions`:

```json
{
  "action_id": "uuid",
  "incident_id": "uuid",
  "host": "WS01",
  "action": "log | alert | kill_process | block_address | quarantine_file | isolate_host | unblock_address | restore_file | unisolate_host",
  "target": {"pid": 4412, "image": "..."},
  "decided_by": {"severity": "high", "matched_scenario": "credential_dump_chain", "policy_rule": "..."},
  "mode": "dry_run | live",
  "status": "issued | received | executed | failed | blocked_by_kill_switch",
  "command_issued_time": "...",
  "agent_received_time": "...",
  "response_executed_time": "...",
  "result": "agent stdout/summary or error"
}
```

`response_executed_time` closes MTTR (NFR-8). Set it only when the agent
reports success. In dry-run it is still set (to the simulated execution
moment) and `mode` distinguishes.

## Metrics

The metrics page (`GET /metrics/*`, `dashboard/app/metrics`) reads a subset
of the fields above, plus one field that doesn't exist in any contract yet.
Read-only throughout: nothing here writes to `alerts`/`incidents`, calls
the response engine, or changes kill-switch/dry-run state.

**Person A, already in the contract (4.2/4.3):** `severity`, `rule_id`,
`host`, `user`, `technique`, `tactic` (alerts); `incident_raised_time`
(incidents).

**Person A, new field:** `false_positive: bool | null` on the alert
document (4.2). Optional -- an alert without this field is excluded from
that rule's false-positive-rate denominator entirely, not assumed `false`.
Fixtures now include both labeled and unlabeled alerts to exercise this.

**Person A/C, open question, not assumed:** `attack_action_time` -- needed
to close MTTD (CLAUDE.md's shared-metrics table: Person C logs it, it
opens MTTD, `incident_raised_time` closes it). There is currently no
contract field or index for this at all -- see the open question below.
The metrics page's MTTD widgets are built and tested but always report
`status: "pending_upstream"` until this exists and is populated on real
data.

**Person B, already B's own (4.5):** `response_executed_time`, `mode`,
`status`, `command_issued_time` (response_actions); `verdict`,
`confidence`, `triage_time`, `triage_started_time` (incident_triage).

**`?range=` scoping for B-owned documents:** response_actions and
incident_triage are scoped to the selected range by their **parent
incident's** `incident_raised_time`, joined through `incident_id` -- not by
`command_issued_time`/`triage_time` directly. Those two are set to "now"
whenever the watcher processes an incident, so filtering on them directly
made the response/triage widgets ignore the selected range in effect
(recently-processed old incidents always passed a "last 7 days" filter).
Scoping through the incident keeps `?range=` meaning the same thing on
every widget: "incidents raised in this window."

**Response success rate excludes dry-run.** A dry-run action is simulated
and never "succeeds" or "fails" for real (CLAUDE.md rule 2) -- counting it
in the same rate as live actions made an all-dry-run system read as a 0%
failure rate. `GET /metrics/response` reports a `live` success rate
(`by_action` too) separately from a `dry_run` status breakdown.

**Ingestion, read-only peek only:** `logs-normalized`'s document count and
latest `timestamp`, for the pipeline-health widget (last-event-time per
source). B still never writes here -- same read-only pattern as reading
A's `alerts`/`incidents`.

**ATT&CK coverage** comes from two places, joined at request time: which
techniques actually **fired** (from alert data, live) and which are
**covered** by a rule (parsed read-only from `rules/*.yml`'s Sigma `tags`,
e.g. `attack.t1003.001`). `rules/` has no `.yml` files yet on this branch,
so coverage currently reports `pending_upstream` -- not "0 techniques
covered" -- until Person A adds real rules. There is no third "not
covered" state: that would need MITRE's full ~600-technique catalog, which
isn't bundled in this project.

## Open questions for Person A

- [ ] Scenario naming: are `credential_dump_chain`, `exfiltration_chain`,
      `malware_drop_chain`, `lateral_movement_chain` the actual
      `matched_scenario` values your correlation engine will emit, or
      placeholders? B's `policy.yaml` (`by_scenario`) keys off these exact
      strings.
- [ ] Will `targets` (4.3) actually be populated by the correlation engine,
      or should B always derive it from `chain.nodes` itself?
- [ ] Incident handoff (4.4): will you publish to a Kafka topic
      (`incidents.raised`), or should B only ever poll the `incidents`
      index? If Kafka, confirm the topic name and that the payload is
      identical to the polled document.
- [ ] `attack_action_time` (needed to close MTTD, see the Metrics section
      above): where does this actually get logged? Person C's attack
      script, joined onto the incident by your correlation engine? A
      separate index? There is no contract field or index for it right
      now -- MTTD support in the metrics page is built but reports
      `pending_upstream` until this is confirmed.
- [ ] `false_positive` label on the alert document (4.2, new field for the
      Metrics section above): will detection tuning ever set this, and if
      so where -- written by A directly, or a separate analyst-feedback
      loop? B's false-positive-rate calc treats it as optional per-alert
      and excludes unlabeled alerts from the rate, so this can be answered
      whenever it's convenient, not a blocker.

## Open questions for whoever owns ingestion

- [ ] `consumer.py` extracts `CommandLine` in `normalize()` but drops it in
      `to_normalized_event()` — it never reaches `logs-normalized`. Can this
      be fixed upstream? Detection rules and AI triage both need it.
- [ ] `docker-compose.yml`'s `KAFKA_ADVERTISED_LISTENERS` is pinned to
      `localhost:9092`. Once Winlogbeat runs on a separate Machine 1, produce
      calls will fail after the initial connection. Needs to advertise the
      engine host's real address.
- [ ] There is no Elasticsearch index template for `logs-normalized`. Fields
      like `dest_ip` are whatever dynamic mapping guesses on first write.
      Should one be added before Phase 6 integration?
