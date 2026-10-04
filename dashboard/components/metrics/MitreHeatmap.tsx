"use client";

import { useState } from "react";

import type { MetricsMitre, MitreCell } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

const MITRE_TOOLTIP = "ATT&CK techniques covered by detection rules, and how often each has actually fired.";

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

const TECHNIQUE_NAMES: Record<string, string> = {
  T1003: "OS Credential Dumping",
  "T1003.001": "LSASS Memory",
  "T1003.003": "NTDS",
  T1012: "Query Registry",
  T1021: "Remote Services",
  "T1021.002": "SMB/Windows Admin Shares",
  T1046: "Network Service Discovery",
  T1047: "Windows Management Instrumentation",
  T1048: "Exfiltration Over Alternative Protocol",
  T1053: "Scheduled Task/Job",
  "T1053.005": "Scheduled Task",
  T1059: "Command and Scripting Interpreter",
  "T1059.001": "PowerShell",
  T1087: "Account Discovery",
  "T1087.002": "Domain Account",
  T1105: "Ingress Tool Transfer",
  T1204: "User Execution",
  "T1204.002": "Malicious File",
  T1486: "Data Encrypted for Impact",
  T1490: "Inhibit System Recovery",
  T1547: "Boot or Logon Autostart Execution",
  "T1547.001": "Registry Run Keys / Startup Folder",
  T1560: "Archive Collected Data",
  "T1560.001": "Archive via Utility",
  T1566: "Phishing",
  "T1566.001": "Spearphishing Attachment",
  T1569: "System Services",
  "T1569.002": "Service Execution",
};

function tacticLabel(tactic: string): string {
  if (tactic === "__no_tactic__") return "Tactic not reported";
  return TACTIC_LABELS[tactic] ?? tactic;
}

function tacticSortKey(tactic: string): number {
  const index = TACTIC_ORDER.indexOf(tactic);
  return index === -1 ? TACTIC_ORDER.length : index;
}

function techniqueLabel(id: string): string {
  const exactName = TECHNIQUE_NAMES[id];
  if (exactName) return `${id} ${exactName}`;

  const parentId = id.split(".")[0];
  const parentName = TECHNIQUE_NAMES[parentId];
  if (parentName) return `${id} ${parentName}`;

  return id;
}

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
      <div data-testid="overview-card" className="flex min-h-[180px] flex-col rounded-lg border border-line bg-surface p-4">
        <h3 className="mb-3 flex items-center gap-1 text-sm font-semibold text-zinc-500">
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
    const tacticKey = cell.tactic ? cell.tactic : "__no_tactic__";
    const list = byTactic.get(tacticKey) ?? [];
    list.push(cell);
    byTactic.set(tacticKey, list);
  }

  byTactic.forEach((list) => {
    list.sort((a: MitreCell, b: MitreCell) => {
      if (a.status === "fired" && b.status !== "fired") return -1;
      if (a.status !== "fired" && b.status === "fired") return 1;
      if (a.status === "fired") return b.count - a.count;
      return a.technique.localeCompare(b.technique);
    });
  });

  const tactics = Array.from(byTactic.keys()).sort((a: string, b: string) => {
    if (a === "__no_tactic__") return 1;
    if (b === "__no_tactic__") return -1;
    return tacticSortKey(a) - tacticSortKey(b);
  });

  return (
    <div data-testid="overview-card" className="flex min-h-[180px] flex-col rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-zinc-500">
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
              <div key={tactic} data-testid="mitre-tactic-column" data-tactic={tactic} className="min-w-[140px] flex-1">
                <p className="mb-1 truncate text-xs font-medium text-zinc-500" title={tacticLabel(tactic)}>
                  {tacticLabel(tactic)}
                </p>
                <div className="space-y-1">
                  {byTactic.get(tactic)!.map((cell) => {
                    const label = techniqueLabel(cell.technique);
                    return (
                      <div
                        key={cell.technique}
                        data-testid="mitre-cell"
                        data-technique={cell.technique}
                        data-status={cell.status}
                        data-count={cell.count}
                        onMouseEnter={() => setHovered(cell)}
                        onMouseLeave={() => setHovered(null)}
                        title={label}
                        className={`line-clamp-3 break-words rounded px-2 py-1 text-xs leading-4 ${
                          cell.status === "fired"
                            ? fillFor(cell.count, maxCount)
                            : "border border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-600"
                        }`}
                      >
                        {label}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-indigo-200 dark:bg-indigo-900/60" /> Fewer alerts
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-indigo-600 dark:bg-indigo-500" /> More alerts
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded border border-dashed border-zinc-400" /> Covered, no alerts yet
            </span>
            {hovered && (
              <span className="ml-auto truncate">
                {techniqueLabel(hovered.technique)} · {hovered.tactic ? tacticLabel(hovered.tactic) : "Tactic not reported"} ·{" "}
                {hovered.count} alert{hovered.count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

