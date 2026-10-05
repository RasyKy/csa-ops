import * as fs from "fs";
import * as path from "path";
import { expect, test } from "@playwright/test";

import { buildChainTree, type TreeInputNode, type TreeRow } from "../lib/chainTree";

const base = (p: string) => p.split("\\").pop() ?? p;

function proc(id: string, pid: number, ppid: number | null, t: string | null | undefined, extra: Partial<TreeInputNode> = {}): TreeInputNode {
  return {
    event_id: id,
    pid,
    ppid,
    image: `C:\\Windows\\System32\\${id}.exe`,
    timestamp: t,
    event_type: "process_start",
    host: "WS01",
    ...extra,
  };
}

function act(id: string, pid: number, ppid: number | null, t: string | null | undefined, type: string, extra: Partial<TreeInputNode> = {}): TreeInputNode {
  return proc(id, pid, ppid, t, { event_type: type, ...extra });
}

const T = (n: number) => `2026-10-04T10:00:${String(n).padStart(2, "0")}.000Z`;
const ids = (rows: TreeRow[]) => rows.map((r) => r.node.event_id);
const byId = (rows: TreeRow[], id: string) => rows.find((r) => r.node.event_id === id)!;

test.describe("buildChainTree: synthetic", () => {
  test("simple chain", () => {
    const rows = buildChainTree([proc("a", 1, 0, T(1)), proc("b", 2, 1, T(2)), proc("c", 3, 2, T(3))]);
    expect(rows.map((r) => [r.node.event_id, r.depth, r.kind, r.step])).toEqual([
      ["a", 0, "process", 1],
      ["b", 1, "process", 2],
      ["c", 2, "process", 3],
    ]);
    expect(rows.map((r) => r.parentEventId)).toEqual([null, "a", "b"]);
  });

  test("fork keeps children in step order", () => {
    const rows = buildChainTree([proc("c", 3, 1, T(3)), proc("a", 1, 0, T(1)), proc("b", 2, 1, T(2))]);
    expect(ids(rows)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
    expect(rows.map((r) => r.isLast)).toEqual([true, false, true]);
  });

  test("activity rows group under the owning process and interleave by step", () => {
    const rows = buildChainTree([
      proc("p1", 10, 1, T(1)),
      proc("p2", 20, 10, T(2)),
      act("f1", 10, 1, T(3), "file_event"),
      act("n1", 20, 10, T(4), "network_connection"),
    ]);
    expect(ids(rows)).toEqual(["p1", "p2", "n1", "f1"]);
    expect(byId(rows, "n1")).toMatchObject({ depth: 2, kind: "activity", parentEventId: "p2" });
    expect(byId(rows, "f1")).toMatchObject({ depth: 1, kind: "activity", parentEventId: "p1" });
  });

  test("orphan activity is promoted to a process row and uses its ppid", () => {
    const rows = buildChainTree([proc("p1", 10, 1, T(1)), act("x", 99, 10, T(2), "network_connection")]);
    expect(byId(rows, "x")).toMatchObject({ kind: "process", depth: 1, parentEventId: "p1" });
    const lone = buildChainTree([act("y", 99, 55, T(1), "file_event")]);
    expect(lone[0]).toMatchObject({ kind: "process", depth: 0, parentEventId: null });
  });

  test("legacy nodes without event_type are process rows", () => {
    const legacy = [
      { event_id: "a", pid: 1, ppid: 0, image: "C:\\a.exe", timestamp: T(1) },
      { event_id: "b", pid: 2, ppid: 1, image: "C:\\b.exe", timestamp: T(2), event_type: null },
      { event_id: "c", pid: 3, ppid: 2, image: "C:\\c.exe", timestamp: T(3), event_type: "something_new" },
    ] as TreeInputNode[];
    const rows = buildChainTree(legacy);
    expect(rows.map((r) => r.kind)).toEqual(["process", "process", "process"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });

  test("pid reuse: an activity picks the latest earlier owner", () => {
    const rows = buildChainTree([
      proc("old", 5, 1, T(1)),
      act("early", 5, 1, T(5), "file_event"),
      proc("new", 5, 1, T(10)),
      act("late", 5, 1, T(12), "network_connection"),
    ]);
    expect(byId(rows, "early").parentEventId).toBe("old");
    expect(byId(rows, "late").parentEventId).toBe("new");
  });

  test("pid equal to ppid does not loop", () => {
    const rows = buildChainTree([proc("self", 7, 7, T(1))]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ depth: 0, parentEventId: null });
  });

  test("a parent that happens later in time becomes a root", () => {
    const rows = buildChainTree([proc("child", 2, 1, T(1)), proc("parent", 1, 0, T(5))]);
    expect(rows.map((r) => [r.node.event_id, r.depth])).toEqual([["child", 0], ["parent", 0]]);
  });

  test("hosts do not mix", () => {
    const rows = buildChainTree([proc("a", 1, 0, T(1)), proc("b", 2, 1, T(2), { host: "WS02" })]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0]);
  });

  test("missing timestamps sort last, ties keep input order", () => {
    const rows = buildChainTree([
      proc("n1", 3, 0, null),
      proc("a", 1, 0, T(2)),
      proc("n2", 4, 0, undefined),
      proc("b", 2, 0, T(2)),
    ]);
    const steps = new Map(rows.map((r) => [r.node.event_id, r.step]));
    expect(steps.get("a")).toBe(1);
    expect(steps.get("b")).toBe(2);
    expect(steps.get("n1")).toBe(3);
    expect(steps.get("n2")).toBe(4);
  });

  test("zero and one node", () => {
    expect(buildChainTree([])).toEqual([]);
    const one = buildChainTree([proc("only", 1, 0, T(1))]);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ depth: 0, step: 1, isLast: true, guides: [], hit: false });
  });

  test("exact guides and isLast for a three level tree with a last sibling", () => {
    // A -> (B -> (D -> F, E), C)
    const rows = buildChainTree([
      proc("A", 1, 0, T(1)),
      proc("B", 2, 1, T(2)),
      proc("D", 4, 2, T(3)),
      proc("F", 6, 4, T(4)),
      proc("E", 5, 2, T(5)),
      proc("C", 3, 1, T(6)),
    ]);
    expect(rows.map((r) => ({ id: r.node.event_id, depth: r.depth, isLast: r.isLast, guides: r.guides }))).toEqual([
      { id: "A", depth: 0, isLast: true, guides: [] },
      { id: "B", depth: 1, isLast: false, guides: [] },
      { id: "D", depth: 2, isLast: false, guides: [true] },
      { id: "F", depth: 3, isLast: true, guides: [true, true] },
      { id: "E", depth: 2, isLast: true, guides: [true] },
      { id: "C", depth: 1, isLast: true, guides: [] },
    ]);
  });

  test("hit rows follow rule_id or technique", () => {
    const rows = buildChainTree([
      proc("a", 1, 0, T(1)),
      proc("b", 2, 1, T(2), { rule_id: "R1" }),
      proc("c", 3, 1, T(3), { technique: "T1059.001" }),
    ]);
    expect(rows.map((r) => r.hit)).toEqual([false, true, true]);
  });

  test("every input appears once, steps are 1..n in timestamp order", () => {
    const input: TreeInputNode[] = [];
    for (let i = 0; i < 40; i++) {
      const t = T((i * 17) % 59);
      input.push(i % 3 === 0 ? act(`e${i}`, 1 + (i % 9), 1 + ((i + 3) % 9), t, "file_event") : proc(`e${i}`, 1 + (i % 9), 1 + ((i + 5) % 9), t));
    }
    const rows = buildChainTree(input);
    expect(rows).toHaveLength(40);
    expect(new Set(ids(rows)).size).toBe(40);
    expect(rows.map((r) => r.step).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    const byStep = [...rows].sort((a, b) => a.step - b.step);
    for (let i = 1; i < byStep.length; i++) {
      expect(byStep[i - 1].node.timestamp! <= byStep[i].node.timestamp!).toBe(true);
    }
    for (const r of rows) {
      if (r.parentEventId) expect(byId(rows, r.parentEventId).step).toBeLessThan(r.step);
    }
  });
});

const FIXTURE = path.join(__dirname, "..", "..", "fixtures", "realistic", "incidents.json");

const EXPECTED_1006 = [
  "0 process explorer.exe",
  "1 process WINWORD.EXE",
  "2 process powershell.exe",
  "3 process whoami.exe",
  "3 process net.exe",
  "3 process reg.exe",
  "3 activity powershell.exe file_event",
  "3 process cmd.exe",
  "4 process reg.exe",
  "5 activity reg.exe registry_event",
  "4 process rundll32.exe",
  "5 activity rundll32.exe process_access",
  "4 process powershell.exe",
  "5 activity powershell.exe network_connection",
];

const EXPECTED_1004 = [
  "0 process explorer.exe",
  "1 process WINWORD.EXE",
  "2 process cmd.exe",
  "3 process powershell.exe",
  "4 activity powershell.exe file_event",
  "4 process svc_update.exe",
  "5 activity svc_update.exe registry_event",
  "4 activity powershell.exe network_connection",
];

function describeRows(rows: TreeRow[]): string[] {
  return rows.map(
    (r) => `${r.depth} ${r.kind} ${base(r.node.image)}${r.kind === "activity" ? ` ${r.node.event_type}` : ""}`,
  );
}

test.describe("buildChainTree: realistic fixtures", () => {
  test.skip(!fs.existsSync(FIXTURE), "fixtures/realistic/incidents.json is missing (run scripts/generate_scenarios.py)");

  const incidents: { incident_id: string; chain: { nodes: TreeInputNode[] } }[] = fs.existsSync(FIXTURE)
    ? JSON.parse(fs.readFileSync(FIXTURE, "utf-8"))
    : [];

  test("all eight incidents satisfy the tree invariants", () => {
    expect(incidents).toHaveLength(8);
    for (const incident of incidents) {
      const nodes = incident.chain.nodes;
      const rows = buildChainTree(nodes);
      const label = incident.incident_id;
      expect(rows, label).toHaveLength(nodes.length);
      expect(new Set(ids(rows)).size, label).toBe(nodes.length);
      expect(rows.filter((r) => r.parentEventId === null), label).toHaveLength(1);

      for (const row of rows) {
        const parent = row.parentEventId ? byId(rows, row.parentEventId) : null;
        if (row.kind === "process" && parent) {
          expect(parent.node.pid, `${label} ${row.node.event_id}`).toBe(row.node.ppid);
          expect(parent.node.host).toBe(row.node.host);
        }
        if (row.kind === "activity") {
          expect(parent, `${label} ${row.node.event_id} has an owner`).not.toBeNull();
          expect(parent!.kind).toBe("process");
          expect(parent!.node.host).toBe(row.node.host);
          expect(parent!.node.pid).toBe(row.node.pid);
        }
      }

      const hitIds = rows.filter((r) => r.hit).map((r) => r.node.event_id).sort();
      const ruleIds = nodes.filter((n) => n.rule_id).map((n) => n.event_id).sort();
      expect(hitIds, label).toEqual(ruleIds);
    }
  });

  test("inc-1006 has the exact expected structure", () => {
    const rows = buildChainTree(incidents.find((i) => i.incident_id === "inc-1006")!.chain.nodes);
    expect(describeRows(rows)).toEqual(EXPECTED_1006);
    expect(rows.filter((r) => r.hit)).toHaveLength(6);
  });

  test("inc-1004 has the exact expected structure and step order", () => {
    const rows = buildChainTree(incidents.find((i) => i.incident_id === "inc-1004")!.chain.nodes);
    expect(describeRows(rows)).toEqual(EXPECTED_1004);
    expect(rows.map((r) => r.step)).toEqual([1, 2, 3, 4, 5, 6, 8, 7]);
  });
});
