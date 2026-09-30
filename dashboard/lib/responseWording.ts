import type { ResponseAction } from "./types";

type TargetKind = "process" | "address" | "file" | "host" | "none";

const ACTION_COPY: Record<string, { base: string; present: string; past: string; targetKind: TargetKind }> = {
  log: { base: "log this incident", present: "logging this incident", past: "logged this incident", targetKind: "none" },
  alert: { base: "raise an alert", present: "raising an alert", past: "raised an alert", targetKind: "none" },
  kill_process: { base: "stop", present: "stopping", past: "stopped", targetKind: "process" },
  block_address: { base: "block", present: "blocking", past: "blocked", targetKind: "address" },
  quarantine_file: { base: "quarantine", present: "quarantining", past: "quarantined", targetKind: "file" },
  isolate_host: { base: "isolate", present: "isolating", past: "isolated", targetKind: "host" },
  unblock_address: { base: "unblock", present: "unblocking", past: "unblocked", targetKind: "address" },
  restore_file: { base: "restore", present: "restoring", past: "restored", targetKind: "file" },
  unisolate_host: { base: "reconnect", present: "reconnecting", past: "reconnected", targetKind: "host" },
};

function basename(path: string): string {
  return path.split("\\").pop()?.split("/").pop() ?? path;
}

// target shape confirmed from engine/response/decision.py's _derive_target:
// {pids: number[], remote_ips: string[], file_paths: string[], pid_images: {...}}
// -- the manual-commanding path (POST /response/actions) can in principle
// send a differently-shaped target, but in practice only ever populates
// the same keys, so this covers both.
function describeTarget(a: ResponseAction): string {
  const copy = ACTION_COPY[a.action];
  if (!copy || copy.targetKind === "none") return "";
  if (copy.targetKind === "host") return `host ${a.host}`;

  const target = a.target as { pids?: number[]; remote_ips?: string[]; file_paths?: string[] };
  if (copy.targetKind === "process" && target.pids?.length) return `process ${target.pids.join(", ")}`;
  if (copy.targetKind === "address" && target.remote_ips?.length) return `address ${target.remote_ips.join(", ")}`;
  if (copy.targetKind === "file" && target.file_paths?.length) {
    return `file ${target.file_paths.map(basename).join(", ")}`;
  }
  return "";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Plain-language description of a single response action, covering every
// mode x status combination. Matches the exact phrasing used by
// AutomatedResponseStatus ("practice mode") so the same states read the
// same way everywhere in the dashboard.
export function describeResponseAction(a: ResponseAction): string {
  const copy = ACTION_COPY[a.action] ?? { base: a.action, present: a.action, past: a.action, targetKind: "none" as TargetKind };
  const target = describeTarget(a);
  const phrase = (verb: string) => (target ? `${verb} ${target}` : verb);

  if (a.status === "blocked_by_kill_switch") {
    return target ? `Blocked by kill switch -- ${target} was not touched` : "Blocked by kill switch";
  }
  if (a.mode === "dry_run") {
    return `Would have ${phrase(copy.past)} (practice mode)`;
  }
  if (a.status === "failed") {
    return capitalize(`failed to ${phrase(copy.base)}`);
  }
  if (a.status === "executed") {
    return capitalize(phrase(copy.past));
  }
  // issued / received: live, dispatched but not yet complete.
  return capitalize(`${phrase(copy.present)}…`);
}
