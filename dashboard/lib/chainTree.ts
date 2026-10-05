export interface TreeInputNode {
  event_id: string;
  pid: number;
  ppid?: number | null;
  image: string;
  command_line?: string | null;
  timestamp?: string | null;
  technique?: string | null;
  rule_id?: string | null;
  rule_title?: string | null;
  event_type?: string | null;
  host?: string | null;
  detail?: string | null;
}

export interface TreeRow {
  node: TreeInputNode;
  step: number;
  depth: number;
  kind: "process" | "activity";
  hit: boolean;
  guides: boolean[];
  isLast: boolean;
  parentEventId: string | null;
}

const ACTIVITY_TYPES = new Set(["network_connection", "file_event", "registry_event", "process_access"]);

export function isActivityType(eventType: string | null | undefined): boolean {
  return eventType != null && ACTIVITY_TYPES.has(eventType);
}

// Builds a process tree from node fields only (pid, ppid, host, timestamp,
// event_type). Edges are ignored on purpose: the correlator adds a redundant
// parent edge into resource events, so edges do not describe a tree.
export function buildChainTree(nodes: TreeInputNode[]): TreeRow[] {
  const n = nodes.length;
  if (n === 0) return [];

  const ts = (i: number): string | null => nodes[i].timestamp || null;

  const byTime = (a: number, b: number): number => {
    const ta = ts(a);
    const tb = ts(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  };

  const step: number[] = new Array(n);
  Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => byTime(a, b) || a - b)
    .forEach((idx, rank) => {
      step[idx] = rank + 1;
    });

  const activity = (i: number) => isActivityType(nodes[i].event_type);
  const key = (host: string | null | undefined, pid: number) => `${host ?? ""}\u0000${pid}`;

  const processesByKey = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (activity(i)) continue;
    const k = key(nodes[i].host, nodes[i].pid);
    const list = processesByKey.get(k);
    if (list) list.push(i);
    else processesByKey.set(k, [i]);
  }
  processesByKey.forEach((list) => list.sort((a, b) => step[a] - step[b]));

  // true when candidate c happened at or before the node t
  const atOrBefore = (c: number, t: number): boolean => {
    const tc = ts(c);
    const tt = ts(t);
    if (tc !== null && tt !== null) return tc <= tt;
    if (tc === null && tt === null) return step[c] < step[t];
    return tc !== null;
  };

  const owner = (host: string | null | undefined, pid: number, at: number): number | null => {
    const candidates = (processesByKey.get(key(host, pid)) ?? []).filter((c) => c !== at);
    if (candidates.length === 0) return null;
    const earlier = candidates.filter((c) => atOrBefore(c, at));
    if (earlier.length > 0) return earlier[earlier.length - 1];
    return candidates[0];
  };

  const parentOf: (number | null)[] = new Array(n).fill(null);
  const kindOf: ("process" | "activity")[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const viaPpid = (): number | null => {
      const ppid = nodes[i].ppid;
      return ppid === null || ppid === undefined ? null : owner(nodes[i].host, ppid, i);
    };

    let parent: number | null;
    if (activity(i)) {
      const o = owner(nodes[i].host, nodes[i].pid, i);
      if (o !== null) {
        kindOf[i] = "activity";
        parent = o;
      } else {
        kindOf[i] = "process";
        parent = viaPpid();
      }
    } else {
      kindOf[i] = "process";
      parent = viaPpid();
    }

    if (parent !== null && step[parent] >= step[i]) parent = null;
    parentOf[i] = parent;
  }

  const children: number[][] = Array.from({ length: n }, () => []);
  const roots: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = parentOf[i];
    if (p === null) roots.push(i);
    else children[p].push(i);
  }
  const byStep = (a: number, b: number) => step[a] - step[b];
  roots.sort(byStep);
  children.forEach((list) => list.sort(byStep));

  const rows: TreeRow[] = [];

  const visit = (i: number, depth: number, lastFlags: boolean[], isLast: boolean) => {
    const guides = depth >= 2 ? lastFlags.slice(1, depth).map((last) => !last) : [];
    const node = nodes[i];
    rows.push({
      node,
      step: step[i],
      depth,
      kind: kindOf[i],
      hit: Boolean(node.rule_id || node.technique),
      guides,
      isLast,
      parentEventId: parentOf[i] === null ? null : nodes[parentOf[i] as number].event_id,
    });
    const next = [...lastFlags, isLast];
    const kids = children[i];
    kids.forEach((child, idx) => visit(child, depth + 1, next, idx === kids.length - 1));
  };

  roots.forEach((r, idx) => visit(r, 0, [], idx === roots.length - 1));
  return rows;
}
