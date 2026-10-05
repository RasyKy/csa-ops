import { expect, test } from "@playwright/test";

import * as wording from "../lib/responseWording";
import * as text from "../lib/responseText";
import type { ResponseAction } from "../lib/types";

const KINDS = [
  "log",
  "alert",
  "kill_process",
  "block_address",
  "quarantine_file",
  "isolate_host",
  "unblock_address",
  "restore_file",
  "unisolate_host",
  "something_new",
];
const MODES = ["dry_run", "live"] as const;
const STATUSES = ["issued", "received", "executed", "failed", "blocked_by_kill_switch"];

function targetShapes(): Record<string, unknown>[] {
  const shapes: Record<string, unknown>[] = [{}];
  for (const n of [0, 1, 2, 3, 5]) {
    shapes.push({
      pids: Array.from({ length: n }, (_, i) => 3000 + i),
      remote_ips: Array.from({ length: n }, (_, i) => `203.0.113.${10 + i}`),
      file_paths: Array.from({ length: Math.min(n, 3) }, (_, i) => `C:\\Users\\a\\f${i}.exe`),
    });
  }
  return shapes;
}

function make(action: string, mode: string, status: string, target: Record<string, unknown>): ResponseAction {
  return {
    action_id: "a",
    incident_id: "i",
    host: "WS01",
    action,
    target,
    decided_by: {},
    mode: mode as ResponseAction["mode"],
    status,
    command_issued_time: null,
    agent_received_time: null,
    response_executed_time: null,
    result: null,
  };
}

test.describe("responseWording delegates to responseText", () => {
  test("exports are unchanged", () => {
    expect(Object.keys(wording).sort()).toEqual(["describeResponseAction"]);
  });

  test("identical output for 10 kinds x 2 modes x 5 statuses x 6 target shapes", () => {
    let compared = 0;
    for (const kind of KINDS) {
      for (const mode of MODES) {
        for (const status of STATUSES) {
          for (const target of targetShapes()) {
            const a = make(kind, mode, status, target);
            expect(wording.describeResponseAction(a), `${kind} ${mode} ${status}`).toBe(text.describeResponseAction(a));
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(600);
  });

  test("the 100 original combinations still match with their original targets", () => {
    const targets: Record<string, Record<string, unknown>> = {
      log: {},
      alert: {},
      kill_process: { pids: [4412] },
      block_address: { remote_ips: ["203.0.113.7", "198.51.100.1"] },
      quarantine_file: { file_paths: ["C:\\Users\\a\\x.exe", "C:\\Users\\a\\y.exe", "C:\\Users\\a\\z.exe"] },
      isolate_host: {},
      unblock_address: { remote_ips: ["203.0.113.7"] },
      restore_file: { file_paths: ["C:\\Users\\a\\x.exe"] },
      unisolate_host: {},
      something_new: { pids: [1] },
    };
    let n = 0;
    for (const [kind, target] of Object.entries(targets)) {
      for (const mode of MODES) {
        for (const status of STATUSES) {
          const a = make(kind, mode, status, target);
          expect(wording.describeResponseAction(a)).toBe(text.describeResponseAction(a));
          n += 1;
        }
      }
    }
    expect(n).toBe(100);
  });

  test("exact strings", () => {
    const w = wording.describeResponseAction;
    const dry = (kind: string, target: Record<string, unknown>) => w(make(kind, "dry_run", "issued", target));
    expect(dry("kill_process", { pids: [4412] })).toBe("Would have stopped process 4412 (practice mode)");
    expect(dry("kill_process", { pids: [4412, 4500] })).toBe("Would have stopped process 4412, 4500 (practice mode)");
    expect(dry("kill_process", { pids: [3468, 3812, 4076, 4116, 4172] })).toBe(
      "Would have stopped 5 processes (practice mode)",
    );
    expect(dry("block_address", { remote_ips: ["203.0.113.1", "203.0.113.2", "203.0.113.3"] })).toBe(
      "Would have blocked 3 addresses (practice mode)",
    );
    expect(dry("isolate_host", {})).toBe("Would have isolated host WS01 (practice mode)");
    expect(dry("quarantine_file", { file_paths: ["C:\\Users\\a\\x.exe", "C:\\Users\\a\\y.exe"] })).toBe(
      "Would have quarantined file x.exe, y.exe (practice mode)",
    );
    expect(w(make("kill_process", "dry_run", "blocked_by_kill_switch", { pids: [4412] }))).toBe(
      "Blocked by kill switch -- process 4412 was not touched",
    );
    expect(w(make("kill_process", "dry_run", "blocked_by_kill_switch", { pids: [1, 2, 3, 4, 5] }))).toBe(
      "Blocked by kill switch -- 5 processes were not touched",
    );
    expect(w(make("kill_process", "live", "failed", { pids: [4412] }))).toBe("Failed to stop process 4412");
  });
});
