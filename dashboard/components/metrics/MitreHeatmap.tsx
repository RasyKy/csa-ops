"use client";

import { useState } from "react";

import type { MetricsMitre, MitreCell } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

const MITRE_TOOLTIP = "ATT&CK techniques covered by detection rules, and how often each has actually fired.";

// MITRE ATT&CK Enterprise tactics, in kill-chain order. Not bundled as the
// full ~600-technique catalog (see docs/interfaces.md) -- just the fixed,
// small list of tactic names/order, which is stable reference data, not
// something that needs a live source.
const TACTIC_ORDER = [
  "reconnaissance", "resource_development", "initial_access", "execution", "persistence",
  "privilege_escalation", "defense_evasion", "credential_access", "discovery", "lateral_movement",
  "collection", "command_and_control", "exfiltration", "impact",
];

const TACTIC_LABELS: Record<string, string> = {
  reconnaissance: "Reconnaissance",
  resource_development: "Resource Development",
  initial_access: "Initial Access",
  execution: "Execution",
  persistence: "Persistence",
  privilege_escalation: "Privilege Escalation",
  defense_evasion: "Defense Evasion",
  credential_access: "Credential Access",
  discovery: "Discovery",
  lateral_movement: "Lateral Movement",
  collection: "Collection",
  command_and_control: "Command and Control",
  exfiltration: "Exfiltration",
  impact: "Impact",
};

// Only the techniques these fixtures actually reference -- not an attempt
// at the full catalog. Anything missing falls back to its bare ID, so a
// new rule from Person A tagging an unlisted technique never breaks this.
const TECHNIQUE_NAMES: Record<string, string> = {
  T1003: "OS Credential Dumping",
  T1012: "Query Registry",
  T1021: "Remote Services",
  T1046: "Network Service Discovery",
  T1047: "Windows Management Instrumentation",
  "T1059.001": "PowerShell",
  T1105: "Ingress Tool Transfer",
};

function tacticLabel(tactic: string): string {
  return TACTIC_LABELS[tactic] ?? tactic;
}

function tacticSortKey(tactic: string): number {
  const index = TACTIC_ORDER.indexOf(tactic);
  return index === -1 ? TACTIC_ORDER.length : index;
}

function techniqueLabel(id: string): string {
  const name = TECHNIQUE_NAMES[id];
  return name ? `${id} ${name}` : id;
}

// Single-hue intensity scale -- darker indigo means more alerts fired that
// technique. Deliberately not severity colors: a technique firing often
// isn't the same signal as it being severe, and reusing the severity
// palette here would make it look like it meant something it doesn't.
function fillFor(count: number, maxCount: number): string {
  if (maxCount === 0) return "bg-zinc-100 dark:bg-zinc-800";
  const ratio = count / maxCount;
  if (ratio > 0.75) return "bg-indigo-600 text-white dark:bg-indigo-500";
  if (ratio > 0.5) return "bg-indigo-400 text-white dark:bg-indigo-600/80";
  if (ratio > 0.25) return "bg-indigo-300 dark:bg-indigo-800/70";
  return "bg-indigo-200 dark:bg-indigo-900/60";
}

export function MitreHeatmap({ data }: { data: MetricsMitre | null }) {
  const [hovered, setHovered] = useState<MitreCell | null>(null);

  if (!data) {
    return (
      <div className="flex min-h-[180px] flex-col rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="mb-3 flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          MITRE ATT&amp;CK coverage
          <InfoTooltip text={MITRE_TOOLTIP} />
        </h3>
        <MetricState status="loading" />
      </div>
    );
  }

  const cells = data.techniques.value;
  const maxCount = Math.max(0, ...cells.map((c) => c.count));

  const byTactic = new Map<string, MitreCell[]>();
  for (const cell of cells) {
    const tactic = cell.tactic ?? "(tactic unknown)";
    const list = byTactic.get(tactic) ?? [];
    list.push(cell);
    byTactic.set(tactic, list);
  }
  const tactics = Array.from(byTactic.keys()).sort((a, b) => tacticSortKey(a) - tacticSortKey(b));

  return (
    <div className="flex min-h-[180px] flex-col rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          MITRE ATT&amp;CK coverage
          <InfoTooltip text={MITRE_TOOLTIP} />
        </h3>
        <MetricState
          status={data.coverage_status}
          pendingMessage="No detection rules parsed yet -- showing fired techniques only"
        />
      </div>

      {data.techniques.status !== "ok" || tactics.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-zinc-500">No alerts in this range</p>
        </div>
      ) : (
        <>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {tactics.map((tactic) => (
              <div key={tactic} className="min-w-[140px] flex-1">
                <p className="mb-1 truncate text-xs font-medium text-zinc-500" title={tacticLabel(tactic)}>
                  {tacticLabel(tactic)}
                </p>
                <div className="space-y-1">
                  {byTactic.get(tactic)!.map((cell) => (
                    <div
                      key={cell.technique}
                      onMouseEnter={() => setHovered(cell)}
                      onMouseLeave={() => setHovered(null)}
                      title={techniqueLabel(cell.technique)}
                      className={`truncate rounded px-2 py-1 text-xs ${
                        cell.status === "fired"
                          ? fillFor(cell.count, maxCount)
                          : "border border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-600"
                      }`}
                    >
                      {techniqueLabel(cell.technique)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-indigo-200 dark:bg-indigo-900/60" /> fewer alerts
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-indigo-600 dark:bg-indigo-500" /> more alerts
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded border border-dashed border-zinc-400" /> covered, not fired
            </span>
            {hovered && (
              <span className="ml-auto truncate">
                {techniqueLabel(hovered.technique)} · {hovered.tactic ? tacticLabel(hovered.tactic) : "unknown tactic"} ·{" "}
                {hovered.count} alert{hovered.count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
