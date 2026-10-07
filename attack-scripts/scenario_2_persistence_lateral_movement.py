"""
Scenario 2 — Persistence and Lateral Movement
MITRE ATT&CK: T1547 (registry run-key), T1053 (scheduled task), T1021 (lateral movement)

Benign simulation. Produces realistic telemetry without performing
actual persistence or lateral movement. Run only on an isolated lab VM.

Stages:
  1. A suspicious process runs
  2. Persistence via registry run-key AND scheduled task
  3. Connection to a "second machine" (loopback stand-in — see note below)

NOTE: Stage 3 currently connects to localhost as a stand-in for a real
second machine, since no second lab VM is set up yet. This should be
upgraded to a genuine cross-host connection once the two-machine lab
(OPPM 3.1) is available — flag to Rasy.

Requires Administrator privileges (registry/scheduled task creation
under HKLM and Task Scheduler typically need elevation).
"""

import subprocess
import time
import os
import sys
import socket
import winreg
from datetime import datetime

LOG_PATH = r"C:\AttackSim\scenario2_timestamps.log"
RUN_KEY_NAME = "AttackSimPersistence"
RUN_KEY_VALUE = r"C:\Windows\System32\cmd.exe /c exit"  # benign no-op command
SCHEDULED_TASK_NAME = "AttackSimScheduledTask"
LATERAL_MOVEMENT_PORT = 8090
LATERAL_MOVEMENT_TARGET = "192.168.31.129"  # Kali VM, real second machine


def log(message: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} | {message}"
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)


def is_admin() -> bool:
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def stage1_suspicious_process():
    """Launches a process that stands in for 'a suspicious process running'
    -- the subsequent stages (persistence, lateral movement) are chained
    from here."""
    log("STAGE1_SUSPICIOUS_PROCESS_START")
    subprocess.run(["powershell.exe", "-NoProfile", "-Command", "Write-Host 'scenario2 process running'"])
    log("STAGE1_SUSPICIOUS_PROCESS_COMPLETE")


def stage2_persistence():
    """Creates a registry run-key AND a scheduled task -- both mechanisms,
    to exercise both detection rules (T1547 and T1053)."""
    log("STAGE2_PERSISTENCE_START")

    # --- Registry run-key (HKCU, no admin needed, but HKLM is more realistic
    # and matches what a real attacker targeting persistence across users
    # would use -- requires admin) ---
    try:
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            0, winreg.KEY_SET_VALUE
        )
        winreg.SetValueEx(key, RUN_KEY_NAME, 0, winreg.REG_SZ, RUN_KEY_VALUE)
        winreg.CloseKey(key)
        log("STAGE2_REGISTRY_RUNKEY_CREATED")
    except Exception as e:
        log(f"STAGE2_REGISTRY_ERROR: {e}")

    # --- Scheduled task ---
    try:
        result = subprocess.run(
            [
                "schtasks", "/Create", "/TN", SCHEDULED_TASK_NAME,
                "/TR", r"C:\Windows\System32\cmd.exe /c exit",
                "/SC", "ONCE", "/ST", "23:59", "/F"
            ],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            log("STAGE2_SCHEDULED_TASK_CREATED")
        else:
            log(f"STAGE2_SCHEDULED_TASK_ERROR: {result.stderr.strip()}")
    except Exception as e:
        log(f"STAGE2_SCHEDULED_TASK_ERROR: {e}")

    log("STAGE2_PERSISTENCE_COMPLETE")


def stage3_lateral_movement():
    """Opens a network connection to a real second machine (Kali VM)."""
    log("STAGE3_LATERAL_MOVEMENT_START")
    try:
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.settimeout(5)
        client.connect((LATERAL_MOVEMENT_TARGET, LATERAL_MOVEMENT_PORT))
        log(f"STAGE3_CONNECTION_ESTABLISHED: {LATERAL_MOVEMENT_TARGET}:{LATERAL_MOVEMENT_PORT}")
        client.close()
        log("STAGE3_LATERAL_MOVEMENT_COMPLETE")
    except Exception as e:
        log(f"STAGE3_ERROR: {e}")

def main():
    if not is_admin():
        print("ERROR: Run this script as Administrator (required for persistence stages).")
        sys.exit(1)

    log("SCENARIO2_RUN_START")
    stage1_suspicious_process()
    stage2_persistence()
    stage3_lateral_movement()
    log("SCENARIO2_RUN_COMPLETE")

    # Clean up so the run is repeatable without manual intervention
    cleanup()


if __name__ == "__main__":
    main()