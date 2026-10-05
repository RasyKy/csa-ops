// Plain-language wording for response actions. Pure and import-free so it can
// be unit tested without a page. Single-target output is identical to
// lib/responseWording.ts; this module adds the "many targets" summary.

export interface ResponseTextInput {
  action: string;
  host: string;
  mode: string;
  status: string;
  target: Record<string, unknown>;
}

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

// More than this many PIDs or addresses switches to a count plus a detail line.
export const MAX_LISTED_TARGETS = 2;

function basename(path: string): string {
  return path.split("\\").pop()?.split("/").pop() ?? path;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface TargetShape {
  pids?: number[];
  remote_ips?: string[];
  file_paths?: string[];
}

// The values behind a many-target summary, or null when the action does not
// have more than MAX_LISTED_TARGETS of them.
function manyTargets(a: ResponseTextInput): { noun: string; label: string; values: string[] } | null {
  const copy = ACTION_COPY[a.action];
  if (!copy) return null;
  const target = (a.target ?? {}) as TargetShape;
  if (copy.targetKind === "process" && (target.pids?.length ?? 0) > MAX_LISTED_TARGETS) {
    return { noun: "processes", label: "PIDs", values: target.pids!.map(String) };
  }
  if (copy.targetKind === "address" && (target.remote_ips?.length ?? 0) > MAX_LISTED_TARGETS) {
    return { noun: "addresses", label: "Addresses", values: target.remote_ips!.map(String) };
  }
  return null;
}

function describeTarget(a: ResponseTextInput): string {
  const copy = ACTION_COPY[a.action];
  if (!copy || copy.targetKind === "none") return "";
  if (copy.targetKind === "host") return `host ${a.host}`;

  const many = manyTargets(a);
  if (many) return `${many.values.length} ${many.noun}`;

  const target = (a.target ?? {}) as TargetShape;
  if (copy.targetKind === "process" && target.pids?.length) return `process ${target.pids.join(", ")}`;
  if (copy.targetKind === "address" && target.remote_ips?.length) return `address ${target.remote_ips.join(", ")}`;
  if (copy.targetKind === "file" && target.file_paths?.length) {
    return `file ${target.file_paths.map(basename).join(", ")}`;
  }
  return "";
}

export function describeResponseAction(a: ResponseTextInput): string {
  const copy = ACTION_COPY[a.action] ?? { base: a.action, present: a.action, past: a.action, targetKind: "none" as TargetKind };
  const target = describeTarget(a);
  const phrase = (verb: string) => (target ? `${verb} ${target}` : verb);

  if (a.status === "blocked_by_kill_switch") {
    if (!target) return "Blocked by kill switch";
    return manyTargets(a)
      ? `Blocked by kill switch -- ${target} were not touched`
      : `Blocked by kill switch -- ${target} was not touched`;
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

// Second, muted line listing the targets behind a count summary, or null when
// the main sentence already names them.
export function describeResponseDetail(a: ResponseTextInput): string | null {
  const many = manyTargets(a);
  return many ? `${many.label} ${many.values.join(", ")}` : null;
}
