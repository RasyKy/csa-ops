# Person A: Detection & Correlation

Everything Person A owns: the Sigma detection engine (`engine/detection/`), the
correlation / attack-chain engine (`engine/correlation/`), the 8 detection
rules (`rules/`), and the metric reports (`scripts/`). The engine reads
normalized events, raises alerts, links them into incidents, scores risk, and
writes the `alerts` and `incidents` documents Person B's backend reads
(`docs/interfaces.md` 4.2 / 4.3).

## What it does, by requirement

| FR/NFR | Where | Notes |
| --- | --- | --- |
| FR5 (8 rules, ATT&CK-mapped) | `rules/*.yml` | 8 techniques across 7 tactics |
| FR6 (Sigma, not code) | `rules/*.yml`, `engine/detection/sigma.py` | standard Sigma; matcher is generic |
| FR7 (TP + FP test per rule) | `tests/detection/test_rules_tp_fp.py` | enforced — a rule with no case fails the suite |
| FR8 (behavioural baselines) | `engine/detection/baseline.py` | first-time process / parent-child, per host+user |
| FR9 (attack chain from linked events) | `engine/correlation/linker.py` | links by pid/parent_pid/host within a window |
| FR10 (risk score + threshold → incident) | `engine/correlation/risk.py`, `correlator.py` | severity-weighted score; raises at threshold |
| FR21 (FP count before/after tuning) | `scripts/fp_rate_report.py` | replays benign data; toggles filters |
| FR22 (technique/tactic coverage) | `scripts/coverage_report.py` | derived from `rules/` |
| FR23 (raw-alert : incident ratio) | `scripts/noise_reduction_report.py` | noise reduction from correlation |
| NFR-1 (add rule without code change) | `engine/detection/rules.py` | rules are data; loader is the only reader |
| NFR-8 (`incident_raised_time`) | `engine/correlation/correlator.py` | stamped when an incident is raised (closes MTTD, opens MTTR) |

## Pipeline

```
normalized events  ->  detection (Sigma + baseline)  ->  alerts
alerts + events    ->  correlation (link, score, raise)  ->  incidents
```

`engine/pipeline.py` ties the two together. It runs in two modes, sharing one
core (fixtures-first, like Person B's store — ES is a config swap):

- **File mode** (works anywhere, no Docker):
  ```bash
  python -m engine.pipeline fixtures/normalized_events.sample.json \
      --alerts-out fixtures/alerts.generated.json \
      --incidents-out fixtures/incidents.generated.json
  ```
- **Elasticsearch mode** (reads `logs-normalized`, writes `alerts` +
  `incidents`; implemented but unverified against a live cluster, same status
  as Person B's `es_store.py`):
  ```bash
  python -m engine.pipeline --elasticsearch http://<machine-2-ip>:9200
  ```

## Detection model

- **Rules** are Sigma YAML in `rules/`. Technique and tactic come from the
  `tags` (`attack.tNNNN`, `attack.<tactic>`); severity comes from `level`.
- **Matcher** (`sigma.py`) supports the Sigma subset the rules use: field
  modifiers (`contains`/`startswith`/`endswith`/`re`/`all`), list values, and
  `condition` expressions (`and`/`or`/`not`, parentheses, `1 of`/`all of`/`any
  of` with `them` or a `prefix*`). All string comparisons are
  case-insensitive.
- **Taxonomy** (`taxonomy.py`) maps Sysmon field names (Image, CommandLine,
  TargetImage, ...) to normalized fields, so rules stay copy-paste-close to
  upstream Sigma and the engine needs no per-rule code (NFR-1).
- **Baseline** (`baseline.py`) remembers processes and parent→child pairs per
  (host, user). The first occurrence is first-time activity (FR8); correlation
  adds a small risk bonus for it.

## Correlation model

- **Linker** (`linker.py`): events link when they share a host and pid lineage
  (`pid` equal, or one's `pid` is the other's `parent_pid`) within
  `window_seconds` (default 300). Connected components are clusters. A cluster
  becomes an incident only if it contains at least one alert.
- **Risk** (`risk.py`): score = sum of alert severity weights
  (low 5, medium 15, high 30, critical 50) + 5 per first-time event. An
  incident is raised at score ≥ 5 (a single low alert qualifies, matching the
  existing fixtures). Incident severity is the most severe alert. Scenario is
  classified from the techniques present, using the names Person B's
  `policy.yaml` keys off: `credential_dump_chain`, `lateral_movement_chain`,
  `exfiltration_chain`, `malware_drop_chain`, or `null`.
- **Correlator** (`correlator.py`): builds the incident document (4.3), stamps
  `incident_raised_time`, derives `targets` (pids of alerting processes, remote
  IPs from network events, file paths from file events), and reports the
  raw-alert-to-incident ratio (FR23).

## Data contracts produced

Alerts and incidents follow `docs/interfaces.md` 4.2 and 4.3 exactly. The test
suite validates every generated alert and incident against Person B's own
`Alert` / `Incident` pydantic models
(`tests/detection/test_engine.py`, `tests/correlation/test_correlator.py`,
`tests/correlation/test_pipeline_end_to_end.py`), so the contract is checked in
code, not just by eye.

## Running the tests

```bash
pytest tests/detection tests/correlation   # this module
pytest tests/                              # everything (Person A + Person B)
```

## Reports (FR21 / FR22 / FR23)

```bash
python scripts/coverage_report.py            # FR22: techniques x tactics
python scripts/fp_rate_report.py             # FR21: false positives before/after tuning
python scripts/noise_reduction_report.py     # FR23: raw alerts -> incidents
```

Sample data lives in `fixtures/normalized_events.sample.json` (three attack
chains + benign noise) and `fixtures/baseline_benign.sample.json` (benign
activity for the FP report).

## Known limitations

1. **Elasticsearch mode is unverified end-to-end.** `pipeline.py`'s ES read/
   write path is implemented but has never run against a live cluster (no
   Docker in the dev environment), the same status as Person B's `es_store.py`.
   File mode is fully tested.
2. **`command_line` fix touches ingestion.** Detection needs the command line,
   which `consumer.py` extracted but dropped before writing (flagged in
   `docs/interfaces.md`). This branch adds `command_line` to `NormalizedEvent`
   and maps it in `to_normalized_event()` — a one-line, additive fix. It is
   verified at the schema level; the `consumer.py` mapping itself is not
   exercised here because `kafka-python` 2.0.2 fails to import on Python 3.12
   (a pre-existing ingestion issue, unrelated to detection).
3. **Correlation is single-host and lineage-based.** Events link by pid lineage
   within one host; cross-host correlation (e.g. following lateral movement
   from source to target host) is not attempted. User-only links are
   deliberately not made, to avoid collapsing an entire user session into one
   incident.
4. **Time-window default is 300s.** Clusters only form among events within that
   window. Attacks that dwell longer than the window between stages would split
   into separate incidents. Configurable on `Correlator`.
5. **`matched_scenario` classification is priority-ordered, first match wins.**
   A chain that spans two scenarios (e.g. credential access *and* lateral
   movement) is labelled with the higher-priority one only.
