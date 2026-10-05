"""Scenario definitions (data only). The generator turns these into events.

Each scenario is one host and one user. A step is either a process_start (it
creates a process handle) or a resource event (network_connection, file_event,
registry_event, process_access) performed by an existing handle.

Step keys:
  proc     handle created by a process_start
  of       handle performing a resource event
  parent   handle of the parent process (omit for the root process)
  delay    seconds after the previous step
  cmd      command line; placeholders {b64} {name} {sid} {lsass_pid}

All content is synthetic. IPs are RFC1918 (internal) or RFC5737 documentation
ranges (external). Every -enc argument is the UTF-16LE base64 of a harmless
Write-Output string; the generator builds it.
"""

EXPLORER = r"C:\Windows\explorer.exe"
USERINIT = r"C:\Windows\System32\userinit.exe"
SERVICES = r"C:\Windows\System32\services.exe"
CMD = r"C:\Windows\System32\cmd.exe"
PS = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
REG = r"C:\Windows\System32\reg.exe"
WHOAMI = r"C:\Windows\System32\whoami.exe"
IPCONFIG = r"C:\Windows\System32\ipconfig.exe"
NET = r"C:\Windows\System32\net.exe"
RUNDLL32 = r"C:\Windows\System32\rundll32.exe"
LSASS = r"C:\Windows\System32\lsass.exe"
WMIC = r"C:\Windows\System32\wbem\wmic.exe"
PSEXEC = r"C:\Tools\PSTools\psexec.exe"
WINWORD = r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE"
CCMEXEC = r"C:\Windows\CCM\CcmExec.exe"

RUN_KEY = r"HKU\{sid}\Software\Microsoft\Windows\CurrentVersion\Run\CorpUpdater"
REG_ADD = (
    r"reg.exe add HKCU\Software\Microsoft\Windows\CurrentVersion\Run "
    r"/v CorpUpdater /t REG_SZ /d C:\Users\{name}\AppData\Roaming\Corp\updater.exe /f"
)
REG_QUERY = r"reg.exe query HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
PS_ENC = "powershell.exe -nop -w hidden -enc {b64}"
MINIDUMP = (
    r"rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump {lsass_pid} "
    r"C:\Users\{name}\AppData\Local\Temp\lsass.dmp full"
)
DROP_PATH = r"C:\Users\{name}\AppData\Local\Temp\svc_update.exe"

SCENARIOS = [
    {
        "id": "s1",
        "name": "ps_download_simple",
        "host": "WS06",
        "user": r"CORP\grace",
        "start_offset": "35m",
        "start_offset_seconds": 35 * 60,
        "sid": "S-1-5-21-1004336348-1177238915-682003330-1106",
        "narrative": "A user session launches a hidden, encoded PowerShell command and nothing else follows.",
        "expected_rules": ["T1059.001_encoded_powershell"],
        "event_count_range": (2, 3),
        "steps": [
            {"proc": "explorer", "image": EXPLORER, "root_parent_image": USERINIT, "delay": 0, "cmd": r"C:\Windows\explorer.exe"},
            {"proc": "ps", "image": PS, "parent": "explorer", "delay": 18.4, "cmd": PS_ENC},
        ],
    },
    {
        "id": "s2",
        "name": "run_key_persistence",
        "host": "WS07",
        "user": r"CORP\hank",
        "start_offset": "2h10m",
        "start_offset_seconds": 2 * 3600 + 10 * 60,
        "sid": "S-1-5-21-1004336348-1177238915-682003330-1107",
        "narrative": "A command prompt adds a CurrentVersion\\Run value with reg.exe to persist across logons.",
        "expected_rules": ["T1547.001_run_key_persistence"],
        "event_count_range": (4, 6),
        "steps": [
            {"proc": "explorer", "image": EXPLORER, "root_parent_image": USERINIT, "delay": 0, "cmd": r"C:\Windows\explorer.exe"},
            {"proc": "cmd", "image": CMD, "parent": "explorer", "delay": 19.6, "cmd": "cmd.exe"},
            {"proc": "regadd", "image": REG, "parent": "cmd", "delay": 12.4, "cmd": REG_ADD},
            {"of": "regadd", "type": "registry_event", "delay": 0.8, "registry_key": RUN_KEY},
        ],
    },
    {
        "id": "s3",
        "name": "discovery_burst",
        "host": "WS08",
        "user": r"CORP\ivan",
        "start_offset": "5h",
        "start_offset_seconds": 5 * 3600,
        "sid": "S-1-5-21-1004336348-1177238915-682003330-1108",
        "narrative": "A command prompt runs whoami, ipconfig and a reg.exe query of the Run key: noisy but low severity.",
        "expected_rules": ["T1012_registry_query"],
        "event_count_range": (4, 6),
        "steps": [
            {"proc": "explorer", "image": EXPLORER, "root_parent_image": USERINIT, "delay": 0, "cmd": r"C:\Windows\explorer.exe"},
            {"proc": "cmd", "image": CMD, "parent": "explorer", "delay": 24.1, "cmd": "cmd.exe"},
            {"proc": "whoami", "image": WHOAMI, "parent": "cmd", "delay": 11.7, "cmd": "whoami.exe /all"},
            {"proc": "ipconfig", "image": IPCONFIG, "parent": "cmd", "delay": 8.3, "cmd": "ipconfig.exe /all"},
            {"proc": "regq", "image": REG, "parent": "cmd", "delay": 15.9, "cmd": REG_QUERY},
        ],
    },
    {
        "id": "s4",
        "name": "dropper_with_egress",
        "host": "WS09",
        "user": r"CORP\judy",
        "start_offset": "9h",
        "start_offset_seconds": 9 * 3600,
        "sid": "S-1-5-21-1004336348-1177238915-682003330-1109",
        "narrative": "A macro document starts encoded PowerShell that drops an executable, runs it, calls out to an external address and sets a Run key.",
        "expected_rules": [
            "T1048_lolbin_exfil",
            "T1059.001_encoded_powershell",
            "T1105_file_drop",
            "T1547.001_run_key_persistence",
        ],
        "event_count_range": (8, 10),
        "steps": [
            {"proc": "explorer", "image": EXPLORER, "root_parent_image": USERINIT, "delay": 0, "cmd": r"C:\Windows\explorer.exe"},
            {"proc": "winword", "image": WINWORD, "parent": "explorer", "delay": 6.2,
             "cmd": r'"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE" /n "C:\Users\{name}\Downloads\Invoice_2291.docm"'},
            {"proc": "cmd", "image": CMD, "parent": "winword", "delay": 14.8, "cmd": "cmd.exe"},
            {"proc": "ps", "image": PS, "parent": "cmd", "delay": 7.9, "cmd": PS_ENC},
            {"of": "ps", "type": "file_event", "delay": 24.6, "file_path": DROP_PATH},
            {"proc": "dropped", "image": DROP_PATH, "parent": "ps", "delay": 3.1, "cmd": DROP_PATH},
            {"of": "ps", "type": "network_connection", "delay": 18.3, "dest_ip": "203.0.113.50", "dest_port": 443},
            {"of": "dropped", "type": "registry_event", "delay": 9.7, "registry_key": RUN_KEY},
        ],
    },
    {
        "id": "s5",
        "name": "credential_dump",
        "host": "WS10",
        "user": r"CORP\karl",
        "start_offset": "14h",
        "start_offset_seconds": 14 * 3600,
        "sid": "S-1-5-21-1004336348-1177238915-682003330-1110",
        "narrative": "Encoded PowerShell runs a comsvcs MiniDump against LSASS, writes the dump to Temp, calls out externally and deletes the dump.",
        "expected_rules": [
            "T1003_lsass_access",
            "T1048_lolbin_exfil",
            "T1059.001_encoded_powershell",
        ],
        "event_count_range": (9, 11),
        "steps": [
            {"proc": "explorer", "image": EXPLORER, "root_parent_image": USERINIT, "delay": 0, "cmd": r"C:\Windows\explorer.exe"},
            {"proc": "cmd", "image": CMD, "parent": "explorer", "delay": 17.5, "cmd": "cmd.exe"},
            {"proc": "ps", "image": PS, "parent": "cmd", "delay": 8.2, "cmd": PS_ENC},
            {"proc": "whoami", "image": WHOAMI, "parent": "ps", "delay": 26.4, "cmd": "whoami.exe /priv"},
            {"proc": "rundll", "image": RUNDLL32, "parent": "ps", "delay": 41.7, "cmd": MINIDUMP},
            {"of": "rundll", "type": "process_access", "delay": 2.3, "target_image": LSASS},
            {"of": "rundll", "type": "file_event", "delay": 1.1, "file_path": r"C:\Users\{name}\AppData\Local\Temp\lsass.dmp"},
            {"of": "ps", "type": "network_connection", "delay": 34.5, "dest_ip": "198.51.100.23", "dest_port": 443},
            {"proc": "cleanup", "image": CMD, "parent": "ps", "delay": 62.0,
             "cmd": r"cmd.exe /c del C:\Users\{name}\AppData\Local\Temp\lsass.dmp"},
        ],
    },
    {
        "id": "s6",
        "name": "full_intrusion_long",
        "host": "WS11",
        "user": r"CORP\lena",
        "start_offset": "26h",
        "start_offset_seconds": 26 * 3600,
        "sid": "S-1-5-21-1004336348-1177238915-682003330-1111",
        "narrative": "A multi-stage intrusion: macro document, encoded PowerShell, discovery, a dropped tool, a Run key, an LSASS dump and external egress.",
        "expected_rules": [
            "T1003_lsass_access",
            "T1012_registry_query",
            "T1048_lolbin_exfil",
            "T1059.001_encoded_powershell",
            "T1105_file_drop",
            "T1547.001_run_key_persistence",
        ],
        "event_count_range": (12, 14),
        "steps": [
            {"proc": "explorer", "image": EXPLORER, "root_parent_image": USERINIT, "delay": 0, "cmd": r"C:\Windows\explorer.exe"},
            {"proc": "winword", "image": WINWORD, "parent": "explorer", "delay": 4.0,
             "cmd": r'"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE" /n "C:\Users\{name}\Downloads\Q3_Report.docm"'},
            {"proc": "ps", "image": PS, "parent": "winword", "delay": 8.0, "cmd": PS_ENC},
            {"proc": "whoami", "image": WHOAMI, "parent": "ps", "delay": 22.0, "cmd": "whoami.exe /all"},
            {"proc": "net", "image": NET, "parent": "ps", "delay": 16.0, "cmd": "net.exe user"},
            {"proc": "regq", "image": REG, "parent": "ps", "delay": 38.0, "cmd": REG_QUERY},
            {"of": "ps", "type": "file_event", "delay": 85.0, "file_path": DROP_PATH},
            {"proc": "cmd2", "image": CMD, "parent": "ps", "delay": 100.0, "cmd": "cmd.exe"},
            {"proc": "regadd", "image": REG, "parent": "cmd2", "delay": 45.0, "cmd": REG_ADD},
            {"of": "regadd", "type": "registry_event", "delay": 1.3, "registry_key": RUN_KEY},
            {"proc": "rundll", "image": RUNDLL32, "parent": "cmd2", "delay": 130.0, "cmd": MINIDUMP},
            {"of": "rundll", "type": "process_access", "delay": 2.2, "target_image": LSASS},
            {"proc": "ps2", "image": PS, "parent": "cmd2", "delay": 60.0,
             "cmd": "powershell.exe -NoProfile -Command \"Write-Output 's6 simulated activity'\""},
            {"of": "ps2", "type": "network_connection", "delay": 3.1, "dest_ip": "203.0.113.50", "dest_port": 443},
        ],
    },
    {
        "id": "s7",
        "name": "admin_tool_false_positive",
        "host": "WS12",
        "user": r"CORP\mike",
        "start_offset": "3d",
        "start_offset_seconds": 3 * 86400,
        "sid": "S-1-5-21-1004336348-1177238915-682003330-1112",
        "narrative": "The corporate management agent runs an encoded PowerShell inventory job; the rule fires but the activity is legitimate.",
        "expected_rules": ["T1059.001_encoded_powershell"],
        "event_count_range": (4, 5),
        "steps": [
            {"proc": "ccm", "image": CCMEXEC, "root_parent_image": SERVICES, "delay": 0, "cmd": r"C:\Windows\CCM\CcmExec.exe"},
            {"proc": "ps", "image": PS, "parent": "ccm", "delay": 11.4,
             "cmd": "powershell.exe -ExecutionPolicy Bypass -NoProfile -enc {b64}"},
            {"of": "ps", "type": "file_event", "delay": 2.8, "file_path": r"C:\ProgramData\Corp\inventory.csv"},
            {"of": "ps", "type": "network_connection", "delay": 1.9, "dest_ip": "10.20.0.5", "dest_port": 443},
        ],
    },
    {
        "id": "s8",
        "name": "outbound_lateral_attempt",
        "host": "WS13",
        "user": r"CORP\nina",
        "start_offset": "5d",
        "start_offset_seconds": 5 * 86400,
        "sid": "S-1-5-21-1004336348-1177238915-682003330-1113",
        "narrative": "A command prompt tries WMI process creation and PsExec against two internal hosts.",
        "expected_rules": ["T1021_lateral_movement_smb", "T1047_wmi_lateral_movement"],
        "event_count_range": (6, 8),
        "steps": [
            {"proc": "explorer", "image": EXPLORER, "root_parent_image": USERINIT, "delay": 0, "cmd": r"C:\Windows\explorer.exe"},
            {"proc": "cmd", "image": CMD, "parent": "explorer", "delay": 16.3, "cmd": "cmd.exe"},
            {"proc": "wmic", "image": WMIC, "parent": "cmd", "delay": 12.8,
             "cmd": "wmic.exe /node:10.20.0.15 process call create calc.exe"},
            {"of": "wmic", "type": "network_connection", "delay": 1.6, "dest_ip": "10.20.0.15", "dest_port": 135},
            {"proc": "psexec", "image": PSEXEC, "parent": "cmd", "delay": 38.4,
             "cmd": r"psexec.exe \\10.20.0.16 -accepteula hostname"},
            {"of": "psexec", "type": "network_connection", "delay": 1.2, "dest_ip": "10.20.0.16", "dest_port": 445},
        ],
    },
]

# Three unrelated benign events per host, each with its own pid tree.
BACKGROUND_CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BACKGROUND_SVCHOST = r"C:\Windows\System32\svchost.exe"
BACKGROUND_SVCHOST_CMD = "C:\\Windows\\System32\\svchost.exe -k netsvcs -p -s Schedule"
BACKGROUND_SYSTEM_USER = r"NT AUTHORITY\SYSTEM"
BACKGROUND_NET_DEST = ("198.51.100.80", 443)
