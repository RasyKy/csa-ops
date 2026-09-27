"use client";

import { useState } from "react";

import type { MetricsMitre, MitreCell } from "@/lib/types";
import { MetricState } from "./MetricState";

// Intensity scale for "fired" cells -- more alerts, darker red. Matches
// SeverityBadge's palette family without needing the exact severity value.
function fillFor(count: number, maxCount: number): string {
  if (maxCount === 0) return "bg-zinc-100 dark:bg-zinc-800";
  const ratio = count / maxCount;
  if (ratio > 0.75) return "bg-red-500 text-white dark:bg-red-600";
  if (ratio > 0.5) return "bg-red-400 text-white dark:bg-red-700/80";
  if (ratio > 0.25) return "bg-orange-300 dark:bg-orange-800/60";
  return "bg-amber-200 dark:bg-amber-900/50";
}

export function MitreHeatmap({ data }: { data: MetricsMitre | null }) {
  const [hovered, setHovered] = useState<MitreCell | null>(null);

  if (!data) {
    return (
      <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          MITRE ATT&amp;CK coverage
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
  const tactics = Array.from(byTactic.keys()).sort();

  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">MITRE ATT&amp;CK coverage</h3>
        <MetricState
          status={data.coverage_status}
          pendingMessage="No detection rules parsed yet -- showing fired techniques only"
        />
      </div>

      {data.techniques.status !== "ok" ? (
        <MetricState status={data.techniques.status} />
      ) : (
        <>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {tactics.map((tactic) => (
              <div key={tactic} className="min-w-[140px] flex-1">
                <p className="mb-1 truncate text-xs font-medium text-zinc-500" title={tactic}>
                  {tactic}
                </p>
                <div className="space-y-1">
                  {byTactic.get(tactic)!.map((cell) => (
                    <div
                      key={cell.technique}
                      onMouseEnter={() => setHovered(cell)}
                      onMouseLeave={() => setHovered(null)}
                      className={`rounded px-2 py-1 text-xs ${
                        cell.status === "fired"
                          ? fillFor(cell.count, maxCount)
                          : "border border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-600"
                      }`}
                    >
                      {cell.technique}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-red-500" /> fired
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded border border-dashed border-zinc-400" /> covered, not fired
            </span>
            {hovered && (
              <span className="ml-auto">
                {hovered.technique} · {hovered.tactic ?? "unknown tactic"} · {hovered.count} alert
                {hovered.count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
