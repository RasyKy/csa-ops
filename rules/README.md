# Sigma Rules

Detection rules for CSA-OPS, one Sigma-format `.yml` file per rule (FR6).
Adding a rule is dropping a file here — no engine code changes (NFR-1). The
loader is `engine/detection/rules.py`; the matcher is
`engine/detection/sigma.py`.

## Rules (FR5: 8 techniques across 7 tactics)

| Rule file | Technique | Tactic | Level | Fires on |
| --- | --- | --- | --- | --- |
| `T1059.001_encoded_powershell.yml` | T1059.001 | execution | high | PowerShell with `-enc`/`-encodedcommand`/`-e` |
| `T1003_lsass_access.yml` | T1003.001 | credential_access | high | A process opening a handle to `lsass.exe` (trusted system accessors filtered) |
| `T1547.001_run_key_persistence.yml` | T1547.001 | persistence | high | Registry `...\CurrentVersion\Run` key written (installers filtered) |
| `T1021_lateral_movement_smb.yml` | T1021.002 | lateral_movement | high | `PSEXESVC.exe` service, or a PsExec client against a remote UNC |
| `T1047_wmi_lateral_movement.yml` | T1047 | execution | high | `wmic ... process call create` / `/node:`, or WmiPrvSE spawning a shell |
| `T1105_file_drop.yml` | T1105 | command_and_control | medium | An executable/script written to Temp/AppData/Downloads/Public/ProgramData |
| `T1012_registry_query.yml` | T1012 | discovery | low | `reg.exe query` of an autorun/sensitive key |
| `T1048_lolbin_exfil.yml` | T1048 | exfiltration | high | A LOLBin (PowerShell/certutil/bitsadmin/curl/wget) connecting to a non-private IP |

Run `python scripts/coverage_report.py` for the live coverage summary (FR22).

## Rule format

Standard Sigma. The fields used are `id`, `title`, `description`, `tags`
(must include one `attack.<tactic>` and one `attack.tNNNN[.NNN]` — the loader
reads technique and tactic from them), `logsource.category`, `detection`
(named selections + a `condition`), and `level` (mapped to alert severity).

Supported `detection` features: field modifiers `contains` / `startswith` /
`endswith` / `re` / `all`; list values (OR, or AND with `|all`); `condition`
with `and` / `or` / `not` / parentheses and `1 of ` / `any of ` / `all of `
(with `them` or a `prefix*` pattern). Field names are Sysmon/Sigma names
(`Image`, `CommandLine`, `TargetImage`, `ParentImage`, `TargetObject`,
`TargetFilename`, `DestinationIp`, `DestinationPort`, `SourceImage`) and are
mapped to normalized event fields by `engine/detection/taxonomy.py`.

Selections whose name starts with `filter` are treated as tuning filters: the
FR21 report can toggle them off to measure false positives before vs after
tuning.

## Tests (FR7)

Every rule has a recorded true-positive and false-positive test in
`tests/detection/test_rules_tp_fp.py`. That file fails if any loaded rule is
missing a TP/FP case, so a new rule cannot ship untested.
