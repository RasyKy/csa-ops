"""
Scenario 1 — Credential Theft
MITRE ATT&CK: T1204.002, T1059.001, T1003.001, T1057/T1082

Benign simulation. Produces realistic telemetry without performing
actual credential extraction. Run only on an isolated lab VM.

Requires Administrator privileges (Stage 3 needs elevated access to lsass.exe).
Requires stage1_trigger.docm (Stages 1+2 macro) to be present at DOCM_PATH.
"""

import subprocess
import time
import os
import ctypes
import sys
from datetime import datetime

LOG_PATH = r"C:\AttackSim\scenario1_timestamps.log"
DOCM_PATH = r"C:\AttackSim\stage1trigger.docm"


def log(message: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} | {message}"
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)


def is_admin() -> bool:
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def stage1_and_2():
    """Opens the macro-enabled doc, which auto-fires Stage 1 (Office spawns
    shell) and Stage 2 (PowerShell download+execute) via Document_Open.
    This is the verified, working implementation -- do not replace with
    COM automation without re-testing."""
    log("SCENARIO1_STAGE1_2_TRIGGER")
    ensure_word_closed()
    os.startfile(DOCM_PATH)
    time.sleep(10)  # allow Word to open, macro to fire, download to complete


def stage3_lsass_access():
    """Opens a handle to lsass.exe via ctypes, then immediately closes it.
    No memory reading -- only the handle-open event (Sysmon Event ID 10)."""
    log("STAGE3_LSASS_ACCESS_START")
    try:
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq lsass.exe", "/FO", "CSV", "/NH"],
            capture_output=True, text=True
        )
        line = result.stdout.strip().strip('"')
        pid = int(line.split('","')[1])

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)

        if handle:
            kernel32.CloseHandle(handle)
            log("STAGE3_LSASS_ACCESS_SUCCESS")
        else:
            log("STAGE3_ERROR: OpenProcess returned null handle")
    except Exception as e:
        log(f"STAGE3_ERROR: {e}")


def stage4_discovery():
    """Local recon: enumerate system and account info."""
    log("STAGE4_DISCOVERY_START")
    commands = [
        ["whoami"],
        ["whoami", "/groups"],
        ["net", "user"],
        ["net", "localgroup", "administrators"],
        ["systeminfo"],
    ]
    for cmd in commands:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            log(f"STAGE4_CMD_RUN: {' '.join(cmd)} (exit={result.returncode})")
        except Exception as e:
            log(f"STAGE4_CMD_ERROR: {' '.join(cmd)} -> {e}")
    log("STAGE4_DISCOVERY_COMPLETE")

def ensure_word_closed():
    subprocess.run(["taskkill", "/F", "/IM", "WINWORD.EXE"], capture_output=True)
    time.sleep(1)

def main():
    if not is_admin():
        print("ERROR: Run this script as Administrator (required for Stage 3).")
        sys.exit(1)

    log("SCENARIO1_RUN_START")
    stage1_and_2()
    stage3_lsass_access()
    stage4_discovery()
    log("SCENARIO1_RUN_COMPLETE")


if __name__ == "__main__":
    main()