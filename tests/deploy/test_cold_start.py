import ctypes
from ctypes import wintypes
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import pytest

from backend.app.config import REPO_ROOT

class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


def get_process_rss_mb(pid: int) -> float:
    if sys.platform == "win32":
        psapi = ctypes.windll.psapi
        GetProcessMemoryInfo = psapi.GetProcessMemoryInfo
        GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS), wintypes.DWORD]
        GetProcessMemoryInfo.restype = wintypes.BOOL

        PROCESS_QUERY_INFORMATION = 0x0400
        PROCESS_VM_READ = 0x0010
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
        if not handle:
            return 0.0
        try:
            pmc = PROCESS_MEMORY_COUNTERS()
            pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
            GetProcessMemoryInfo(handle, ctypes.byref(pmc), pmc.cb)
            return pmc.WorkingSetSize / (1024 * 1024)
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    else:
        try:
            import resource
            return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
        except Exception:
            return 0.0


def test_cold_start_measurement():
    port = get_free_port()
    assert port not in (3000, 8000), "Must never use ports 3000 or 8000"

    tmp_work = Path(tempfile.mkdtemp(prefix="cold_start_work_"))
    key = "c" * 32
    env = dict(
        os.environ,
        PYTHONPATH=str(REPO_ROOT),
        APP_ENV="production",
        STORE_BACKEND="fixtures",
        FIXTURE_SET="realistic",
        DEMO_BOOTSTRAP="1",
        INTAKE_ENABLED="false",
        DEMO_WORK_DIR=str(tmp_work),
        DASHBOARD_API_KEY=key,
    )

    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
    ]

    t0 = time.perf_counter()
    proc = subprocess.Popen(
        cmd,
        cwd=str(REPO_ROOT),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    healthz_url = f"http://127.0.0.1:{port}/healthz"
    started = False
    cold_start_seconds = 0.0

    try:
        # Poll until /healthz responds with {"status": "ok"}
        with httpx.Client() as client:
            deadline = time.time() + 20.0
            while time.time() < deadline:
                try:
                    resp = client.get(healthz_url, timeout=0.5)
                    if resp.status_code == 200 and resp.json() == {"status": "ok"}:
                        cold_start_seconds = time.perf_counter() - t0
                        started = True
                        break
                except Exception:
                    pass
                time.sleep(0.05)

            assert started, "Process did not answer /healthz within 20s"

            # Call /metrics/summary?range=24h and /incidents
            headers = {"X-API-Key": key}
            r_metrics = client.get(f"http://127.0.0.1:{port}/metrics/summary?range=24h", headers=headers, timeout=5.0)
            assert r_metrics.status_code == 200

            r_incidents = client.get(f"http://127.0.0.1:{port}/incidents", headers=headers, timeout=5.0)
            assert r_incidents.status_code == 200
            assert len(r_incidents.json()) == 8

        # Measure resident memory
        rss_mb = get_process_rss_mb(proc.pid)
        print(f"\nCold start time: {cold_start_seconds:.3f}s, resident memory: {rss_mb:.2f} MB")
        assert cold_start_seconds < 15.0
        assert rss_mb < 250.0  # Well within 512 MB limit

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp_work, ignore_errors=True)
