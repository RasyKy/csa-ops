"""
Scenario 2 — Persistence and Lateral Movement
MITRE ATT&CK: T1547 (registry run-key), T1053 (scheduled task), T1021 (lateral movement)

Benign simulation. Produces realistic telemetry without performing
actual persistence or lateral movement. Run only on an isolated lab VM.

Stages:
  1. A suspicious process runs
  2. Persistence via registry run-key AND scheduled task
  3. Connection to a real second machine (Kali VM)

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
    print("\n--- Step 1: A suspicious program starts running on the computer ---")
    log("STAGE1_SUSPICIOUS_PROCESS_START")
    subprocess.run(["powershell.exe", "-NoProfile", "-Command", "Write-Host 'scenario2 process running'"])
    log("STAGE1_SUSPICIOUS_PROCESS_COMPLETE")


def stage2_persistence():
    """Creates a registry run-key AND a scheduled task -- both mechanisms,
    to exercise both detection rules (T1547 and T1053)."""
    print("\n--- Step 2: The program tries to make sure it can run again automatically, even after a restart ---")
    log("STAGE2_PERSISTENCE_START")

    try:
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            0, winreg.KEY_SET_VALUE
        )
        winreg.SetValueEx(key, RUN_KEY_NAME, 0, winreg.REG_SZ, RUN_KEY_VALUE)
        winreg.CloseKey(key)
        print("    -> It added itself to the list of programs that start automatically.")
        log("STAGE2_REGISTRY_RUNKEY_CREATED")
    except Exception as e:
        log(f"STAGE2_REGISTRY_ERROR: {e}")

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
            print("    -> It also scheduled itself to run again later, like setting a hidden alarm.")
            log("STAGE2_SCHEDULED_TASK_CREATED")
        else:
            log(f"STAGE2_SCHEDULED_TASK_ERROR: {result.stderr.strip()}")
    except Exception as e:
        log(f"STAGE2_SCHEDULED_TASK_ERROR: {e}")

    log("STAGE2_PERSISTENCE_COMPLETE")


def stage3_lateral_movement():
    """Opens a network connection to a real second machine (Kali VM)."""
    print("\n--- Step 3: The program reaches out to a second computer on the network ---")
    log("STAGE3_LATERAL_MOVEMENT_START")
    try:
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.settimeout(5)
        client.connect((LATERAL_MOVEMENT_TARGET, LATERAL_MOVEMENT_PORT))
        print(f"    -> Connected successfully to the other machine ({LATERAL_MOVEMENT_TARGET}) — this is how an attacker might try to spread to more computers.")
        log(f"STAGE3_CONNECTION_ESTABLISHED: {LATERAL_MOVEMENT_TARGET}:{LATERAL_MOVEMENT_PORT}")
        client.close()
        log("STAGE3_LATERAL_MOVEMENT_COMPLETE")
    except Exception as e:
        log(f"STAGE3_ERROR: {e}")


def cleanup():
    """Removes the persistence artifacts so repeated runs stay reproducible
    (NFR-7) and don't pile up stale entries."""
    log("CLEANUP_START")
    try:
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            0, winreg.KEY_SET_VALUE
        )
        winreg.DeleteValue(key, RUN_KEY_NAME)
        winreg.CloseKey(key)
        log("CLEANUP_REGISTRY_REMOVED")
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f"CLEANUP_REGISTRY_ERROR: {e}")

    try:
        subprocess.run(["schtasks", "/Delete", "/TN", SCHEDULED_TASK_NAME, "/F"], capture_output=True)
        log("CLEANUP_SCHEDULED_TASK_REMOVED")
    except Exception as e:
        log(f"CLEANUP_SCHEDULED_TASK_ERROR: {e}")

    log("CLEANUP_COMPLETE")


def main():
    if not is_admin():
        print("ERROR: Run this script as Administrator (required for persistence stages).")
        sys.exit(1)

    print("=" * 60)
    print("Starting Scenario 2: Persistence and Lateral Movement")
    print("This simulates what happens after a hacker gains a foothold:")
    print("they try to stay on the system, then try to spread further.")
    print("=" * 60)

    log("SCENARIO2_RUN_START")
    stage1_suspicious_process()
    stage2_persistence()
    stage3_lateral_movement()
    log("SCENARIO2_RUN_COMPLETE")

    print("\n--- Cleaning up: removing the test traces we just created ---")
    cleanup()
    print("\nDone. Scenario 2 complete.")


if __name__ == "__main__":
    main()