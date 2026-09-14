"""kill_process, block_address, quarantine_file, isolate_host and their reverses.

Each function takes (target: dict, live: bool) -> dict describing what
happened (or, in dry-run, what would have happened); every live branch
records before/after state into the returned "result" string.

Live bodies run real OS-level actions (kill a process, change Windows
Firewall policy, move files and change ACLs) and must only ever run on a
disposable, snapshotted Windows VM, elevated -- see CLAUDE.md Phase 4.
psutil is imported lazily so dry-run mode (everything through Phase 3)
never needs it installed.

target dict conventions (all keys optional, action reads what it needs):
  pids, remote_ips, file_paths  -- as in docs/interfaces.md Targets (4.3)
  pid_images                    -- {pid: image}, attached by decision.py so
                                    kill_process can PID-reuse-guard without
                                    incident.targets itself carrying images
  sha256                        -- quarantine identity, for restore_file
  engine_host_ip                -- injected by agent.py from its own config
                                    for isolate_host / unisolate_host
"""
import hashlib
import json
import logging
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger("csa_ops.agent.actions")

QUARANTINE_DIR = Path(r"C:\CSAOPS\quarantine")
STATE_DIR = Path(r"C:\CSAOPS\state")
ISOLATE_STATE_FILE = STATE_DIR / "isolate_policy.json"

_ISOLATE_RULE_NAMES = ("CSAOPS_ISOLATE_ENGINE_OUT", "CSAOPS_ISOLATE_ENGINE_IN", "CSAOPS_ISOLATE_DNS", "CSAOPS_ISOLATE_DHCP")


def _dry_run(action: str, target: dict) -> dict:
    logger.info("DRY RUN would execute %s target=%s", action, target)
    return {"result": f"DRY RUN would execute {action} target={target}"}


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, check=False)


def _first(target: dict, key: str):
    values = target.get(key) or []
    return values[0] if values else None


def log(target: dict, live: bool) -> dict:
    if not live:
        return _dry_run("log", target)
    logger.info("response log: %s", target)
    return {"result": f"logged target={target}"}


def alert(target: dict, live: bool) -> dict:
    if not live:
        return _dry_run("alert", target)
    logger.warning("ALERT flagged: %s", target)
    return {"result": f"alert flagged target={target}"}


def kill_process(target: dict, live: bool) -> dict:
    if not live:
        return _dry_run("kill_process", target)

    import psutil  # lazy: only the live path needs it installed

    pid = _first(target, "pids")
    if pid is None:
        return {"result": "refused: no pids in target"}

    pid_images = target.get("pid_images") or {}
    expected_image = pid_images.get(pid) or pid_images.get(str(pid))

    try:
        proc = psutil.Process(pid)
        before = f"pid={pid} name={proc.name()} exe={proc.exe()} create_time={proc.create_time()}"
    except psutil.NoSuchProcess:
        return {"result": f"refused: pid={pid} not running (before check)"}

    # PID-reuse guard: refuse if the running process at this pid is not the
    # one that actually triggered the incident.
    if expected_image and Path(proc.exe()).name.lower() != Path(expected_image).name.lower():
        return {"result": f"refused: pid reuse guard -- {before} does not match expected image {expected_image}"}

    proc.kill()
    try:
        proc.wait(timeout=5)
        after = f"pid={pid} terminated"
    except psutil.TimeoutExpired:
        after = f"pid={pid} kill() sent, still exiting after 5s"

    return {"result": f"before: {before}; after: {after}"}


def _block_rule_name(ip: str) -> str:
    return f"CSAOPS_BLOCK_{ip}"


def block_address(target: dict, live: bool) -> dict:
    if not live:
        return _dry_run("block_address", target)

    ip = _first(target, "remote_ips")
    if not ip:
        return {"result": "refused: no remote_ips in target"}

    rule_name = _block_rule_name(ip)
    before = _run("netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name}").stdout.strip()

    out_res = _run("netsh", "advfirewall", "firewall", "add", "rule",
                    f"name={rule_name}", "dir=out", "action=block", f"remoteip={ip}")
    in_res = _run("netsh", "advfirewall", "firewall", "add", "rule",
                   f"name={rule_name}", "dir=in", "action=block", f"remoteip={ip}")

    after = _run("netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name}").stdout.strip()

    return {
        "result": f"before: {before}; out: {out_res.stdout.strip()}; in: {in_res.stdout.strip()}; after: {after}",
    }


def unblock_address(target: dict, live: bool) -> dict:
    if not live:
        return _dry_run("unblock_address", target)

    ip = _first(target, "remote_ips")
    if not ip:
        return {"result": "refused: no remote_ips in target"}

    rule_name = _block_rule_name(ip)
    before = _run("netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name}").stdout.strip()
    delete_res = _run("netsh", "advfirewall", "firewall", "delete", "rule", f"name={rule_name}")
    after = _run("netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name}").stdout.strip()

    return {"result": f"before: {before}; delete: {delete_res.stdout.strip()}; after: {after}"}


def quarantine_file(target: dict, live: bool) -> dict:
    if not live:
        return _dry_run("quarantine_file", target)

    file_path = _first(target, "file_paths")
    if not file_path:
        return {"result": "refused: no file_paths in target"}

    src = Path(file_path)
    if not src.exists():
        return {"result": f"refused: {src} does not exist (before check)"}

    digest = hashlib.sha256(src.read_bytes()).hexdigest()
    before = f"path={src} sha256={digest} size={src.stat().st_size}"

    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    dest = QUARANTINE_DIR / digest
    shutil.move(str(src), str(dest))

    sidecar = dest.with_suffix(dest.suffix + ".json")
    sidecar.write_text(json.dumps({"original_path": str(src), "sha256": digest}))

    icacls_res = _run("icacls", str(dest), "/deny", "Everyone:(X)")
    after = f"path={dest} icacls={icacls_res.stdout.strip() or icacls_res.stderr.strip()}"

    return {"result": f"before: {before}; after: {after}"}


def restore_file(target: dict, live: bool) -> dict:
    if not live:
        return _dry_run("restore_file", target)

    sha256 = target.get("sha256")
    if not sha256:
        return {"result": "refused: no sha256 in target"}

    quarantined = QUARANTINE_DIR / sha256
    sidecar = quarantined.with_suffix(quarantined.suffix + ".json")
    if not quarantined.exists() or not sidecar.exists():
        return {"result": f"refused: {quarantined} not found in quarantine (before check)"}

    meta = json.loads(sidecar.read_text())
    original_path = meta["original_path"]
    before = f"path={quarantined}"

    _run("icacls", str(quarantined), "/remove:d", "Everyone")
    shutil.move(str(quarantined), original_path)
    sidecar.unlink()

    after = f"path={original_path}"
    return {"result": f"before: {before}; after: {after}"}


_PROFILE_KEYS = {"Domain": "domainprofile", "Private": "privateprofile", "Public": "publicprofile"}


def _capture_firewall_policy() -> dict:
    """{"domainprofile": "BlockInbound,AllowOutbound", ...} parsed from netsh."""
    output = _run("netsh", "advfirewall", "show", "allprofiles", "firewallpolicy").stdout
    policy = {}
    current = None
    for line in output.splitlines():
        line = line.strip()
        for label, profile_key in _PROFILE_KEYS.items():
            if line.startswith(f"{label} Profile Settings"):
                current = profile_key
        if current and line.startswith("Firewall Policy"):
            policy[current] = line.split(None, 2)[-1]
            current = None
    return policy


def _restore_firewall_policy(policy: dict) -> None:
    if not policy:
        # No recorded state -- fail safe to the normal default rather than
        # leaving the host blocked.
        _run("netsh", "advfirewall", "set", "allprofiles", "firewallpolicy", "allowinbound,allowoutbound")
        return
    for profile_key, value in policy.items():
        _run("netsh", "advfirewall", "set", profile_key, "firewallpolicy", value)


def isolate_host(target: dict, live: bool) -> dict:
    if not live:
        return _dry_run("isolate_host", target)

    engine_host_ip = target.get("engine_host_ip")
    if not engine_host_ip:
        return {"result": "refused: no engine_host_ip in target"}

    prior_policy = _capture_firewall_policy()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    ISOLATE_STATE_FILE.write_text(json.dumps(prior_policy))

    _run("netsh", "advfirewall", "set", "allprofiles", "firewallpolicy", "blockinbound,blockoutbound")

    _run("netsh", "advfirewall", "firewall", "add", "rule", f"name={_ISOLATE_RULE_NAMES[0]}",
         "dir=out", "action=allow", f"remoteip={engine_host_ip}")
    _run("netsh", "advfirewall", "firewall", "add", "rule", f"name={_ISOLATE_RULE_NAMES[1]}",
         "dir=in", "action=allow", f"remoteip={engine_host_ip}")
    _run("netsh", "advfirewall", "firewall", "add", "rule", f"name={_ISOLATE_RULE_NAMES[2]}",
         "dir=out", "action=allow", "protocol=UDP", "remoteport=53")
    _run("netsh", "advfirewall", "firewall", "add", "rule", f"name={_ISOLATE_RULE_NAMES[3]}",
         "dir=out", "action=allow", "protocol=UDP", "remoteport=67-68")

    after_policy = _capture_firewall_policy()
    return {"result": f"before: {prior_policy}; after: {after_policy}"}


def unisolate_host(target: dict, live: bool) -> dict:
    if not live:
        return _dry_run("unisolate_host", target)

    for rule_name in _ISOLATE_RULE_NAMES:
        _run("netsh", "advfirewall", "firewall", "delete", "rule", f"name={rule_name}")

    if ISOLATE_STATE_FILE.exists():
        prior_policy = json.loads(ISOLATE_STATE_FILE.read_text())
        ISOLATE_STATE_FILE.unlink()
    else:
        prior_policy = {}

    _restore_firewall_policy(prior_policy)

    after_policy = _capture_firewall_policy()
    return {"result": f"restored: {prior_policy or 'default allow/allow (no prior state recorded)'}; "
                       f"after: {after_policy}"}


ACTIONS = {
    "log": log,
    "alert": alert,
    "kill_process": kill_process,
    "block_address": block_address,
    "quarantine_file": quarantine_file,
    "isolate_host": isolate_host,
    "unblock_address": unblock_address,
    "restore_file": restore_file,
    "unisolate_host": unisolate_host,
}
