# Realistic attack scenarios

`scripts/generate_scenarios.py` builds eight single-host attack scenarios as
Sysmon-style normalized events and runs them through the real detection and
correlation pipeline (`engine.pipeline.run`, with the rules in `rules/`). The
result is written to `fixtures/realistic/`:

| File | Content |
| --- | --- |
| `normalized_events.json` | every raw event, sorted by timestamp (scenario events plus 3 background events per host) |
| `alerts.json` | alerts produced by the real rules |
| `incidents.json` | incidents produced by the real correlator |
| `scenarios.json` | manifest: scenario id, incident id, host, user, event count, alert count, expected rules, narrative, start offset |

All content is synthetic. External addresses use the RFC 5737 documentation
ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), internal addresses use
10.20.0.0/24, every encoded PowerShell argument is the UTF-16LE base64 of a
harmless `Write-Output '<scenario> simulated activity'` string, and there are no
real malware names, hashes or infrastructure. Command lines stay within the
patterns already present in `fixtures/` and the Sigma rules.

Nothing existing is modified: no rule, engine, backend, dashboard, data file or
existing fixture. The generator refuses to write into `data/`, `rules/`,
`engine/`, `backend/`, `dashboard/`, `tests/`, `docs/`, `scripts/`, `fixtures/`
(the directory itself) or `fixtures/eval/`.

## Regenerating

```powershell
python scripts/generate_scenarios.py --anchor now
python scripts/generate_scenarios.py --anchor 2026-10-04T12:00:00.000Z --out fixtures/realistic
```

The same `--anchor` always produces byte-identical files. Scenario start times
are offsets before the anchor. Tests call `generate(anchor, out_dir)` from
`scripts/generate_scenarios.py`.

Only three things are post-processed after the pipeline runs: ids (incidents
`inc-1001` to `inc-1008`, alerts `alert-1001a`, `alert-1001b`, and so on),
`incident_raised_time` (set to 500 ms after the last alert of the incident,
because the pipeline otherwise stamps the wall clock), and analyst labels.

Analyst labels: the `s7` alert has `false_positive: true`; the first alert of
`s1`, `s4` and `s5` has `false_positive: false`; every other alert has no label.

Rule techniques come straight from the rule tags, so the credential-access and
SMB rules report `T1003.001` and `T1021.002`, unlike the hand-written
`fixtures/alerts.json`, which uses `T1003` and `T1021`.

## Scenarios

### s1 ps_download_simple

- Host `WS06`, user `CORP\grace`, starts 35 minutes before the anchor.
- A user session launches a hidden, encoded PowerShell command and nothing else follows.
- Expected rules: `T1059.001_encoded_powershell` (execution).
- Events: 2. Incident severity high, no matched scenario.

### s2 run_key_persistence

- Host `WS07`, user `CORP\hank`, starts 2 hours 10 minutes before the anchor.
- A command prompt adds a `CurrentVersion\Run` value with `reg.exe`.
- Expected rules: `T1547.001_run_key_persistence` (persistence).
- Events: 4. Incident severity high, no matched scenario.

### s3 discovery_burst

- Host `WS08`, user `CORP\ivan`, starts 5 hours before the anchor.
- A command prompt runs `whoami /all`, `ipconfig /all` and a `reg.exe query` of the Run key.
- Expected rules: `T1012_registry_query` (discovery).
- Events: 5. Incident severity low, no matched scenario.

### s4 dropper_with_egress

- Host `WS09`, user `CORP\judy`, starts 9 hours before the anchor.
- A macro document starts encoded PowerShell that writes an executable to Temp, runs it, connects to `203.0.113.50:443` and the dropped file sets a Run key.
- Expected rules: `T1059.001_encoded_powershell` (execution), `T1105_file_drop` (command and control), `T1048_lolbin_exfil` (exfiltration), `T1547.001_run_key_persistence` (persistence).
- Events: 8. Incident severity high, matched scenario `exfiltration_chain`.

### s5 credential_dump

- Host `WS10`, user `CORP\karl`, starts 14 hours before the anchor.
- Encoded PowerShell runs a `comsvcs.dll` MiniDump against LSASS, the dump lands in Temp (no rule fires on `.dmp`), PowerShell connects to `198.51.100.23:443`, and a `cmd /c del` removes the dump.
- Expected rules: `T1059.001_encoded_powershell` (execution), `T1003_lsass_access` (credential access), `T1048_lolbin_exfil` (exfiltration).
- Events: 9. Incident severity high, matched scenario `credential_dump_chain`.

### s6 full_intrusion_long

- Host `WS11`, user `CORP\lena`, starts 26 hours before the anchor.
- A multi-stage intrusion: macro document, encoded PowerShell, `whoami` and `net user`, a registry Run query, a dropped tool, a second command prompt that sets a Run key and dumps LSASS, then a second PowerShell that connects to `203.0.113.50:443`.
- Expected rules: `T1059.001_encoded_powershell` (execution), `T1012_registry_query` (discovery), `T1105_file_drop` (command and control), `T1547.001_run_key_persistence` (persistence), `T1003_lsass_access` (credential access), `T1048_lolbin_exfil` (exfiltration).
- Events: 14, alerts: 6 across 6 tactics. Incident severity high, matched scenario `credential_dump_chain`.

### s7 admin_tool_false_positive

- Host `WS12`, user `CORP\mike`, starts 3 days before the anchor.
- The management agent `CcmExec.exe` runs `powershell.exe -ExecutionPolicy Bypass -NoProfile -enc ...` for an inventory job, writes `C:\ProgramData\Corp\inventory.csv` and connects to `10.20.0.5:443`. The encoded-PowerShell rule fires; nothing else does.
- Expected rules: `T1059.001_encoded_powershell` (execution), labelled `false_positive: true`.
- Events: 4. Incident severity high, no matched scenario.

### s8 outbound_lateral_attempt

- Host `WS13`, user `CORP\nina`, starts 5 days before the anchor.
- A command prompt runs `wmic /node:10.20.0.15 process call create` (connection to port 135) and `psexec \\10.20.0.16` (connection to port 445). Both connections are internal, so `T1048` stays quiet.
- Expected rules: `T1047_wmi_lateral_movement` (execution), `T1021_lateral_movement_smb` (lateral movement).
- Events: 6. Incident severity high, matched scenario `lateral_movement_chain`.

## Background events

Every host also gets three benign events with their own pid trees: a
`chrome.exe` start, a `chrome.exe` network connection to `198.51.100.80:443`
and an `svchost.exe` (Schedule service) start. They never share a pid or parent
pid with a scenario, so they cannot join a chain or raise an alert. Their ids
are listed under `background_event_ids` in `scenarios.json`.

## Using the realistic set

The backend serves the default fixtures unless you opt in. Run everything from the repo root.

```powershell
python scripts/generate_scenarios.py --anchor now      # fixtures/realistic/ (already committed, regenerate to refresh dates)
$env:FIXTURE_SET = "realistic"
python -m uvicorn backend.app.main:app --port 8000
```

With `FIXTURE_SET=realistic` the backend reads alerts and incidents from
`fixtures/realistic/` and keeps triage, response actions and intake state under
`data/realistic/` (created on first start with empty `incident_triage.json`,
`response_actions.json` and `intake_state.json`). The default files in `data/`
are never touched. Unset it, or set it to `default`, to go back to the original
five incidents.

| Variable | Meaning |
| --- | --- |
| `FIXTURE_SET` | unset, empty or `default` keeps the current behaviour. Any other name must match `^[a-z0-9_-]+$` and `fixtures/NAME/` must contain `alerts.json` and `incidents.json`, otherwise the backend refuses to start with a message saying why. Only valid with `STORE_BACKEND=fixtures`. |
| `FIXTURE_ROOT` | base directory holding the fixture sets (default: the repo's `fixtures/`). Used by tests. |
| `DATA_ROOT` | base directory for runtime data (default: the repo's `data/`). Used by tests. |

The kill switch file (`KILL_SWITCH_PATH`) is a global safety control and stays
where it is regardless of the set.

### Aligning runtime timestamps

Fixture incidents are dated relative to the generator anchor, but when intake
runs, triage and response timestamps come from the wall clock, so they can land
hours or days after the incident. `scripts/rebase_runtime_data.py` shifts them
back next to the incident:

```powershell
python scripts/rebase_runtime_data.py --set realistic            # dry run, prints a before/after table
python scripts/rebase_runtime_data.py --set realistic --write    # apply
```

Per incident, triage start becomes the incident raised time plus 3 seconds and
the first response action becomes raised time plus 4 seconds. The shift is applied
to `triage_started_time` and `triage_time`, and to `command_issued_time`,
`agent_received_time` and `response_executed_time`, so every latency is
preserved. Nothing else changes (`explain.generated_time` is left alone), the
script is idempotent, refuses `--set default` and only writes under
`data/NAME/`. Run it after the watcher has processed the set, with the backend stopped.

## Tests

```powershell
python -m pytest tests/scenarios tests/backend/test_fixture_set.py -v
```
