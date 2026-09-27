"use client";

import { useState } from "react";

import type { MetricsMitre, MetricsPipeline, MetricsSummary } from "@/lib/types";

interface PendingSource {
  label: string;
  detail: string;
}

function collectPendingSources(
  summary: MetricsSummary | null,
  mitre: MetricsMitre | null,
  pipeline: MetricsPipeline | null,
): PendingSource[] {
  const pending: PendingSource[] = [];

  if (summary?.mttd.status === "pending_upstream") {
    pending.push({
      label: "Detection time (MTTD)",
      detail: "Waiting on attack-timing data from the ingestion/detection pipeline.",
    });
  }
  if (mitre?.coverage_status === "pending_upstream") {
    pending.push({
      label: "ATT&CK rule coverage",
      detail: "No detection rules have been parsed yet, so only fired techniques show -- coverage gaps can't be shown.",
    });
  }
  const logsSource = pipeline?.sources["logs-normalized"];
  if (logsSource?.status === "pending_upstream") {
    pending.push({
      label: "Raw log pipeline",
      detail: "The ingestion log store isn't connected in this environment.",
    });
  }

  return pending;
}

// Replaces 3 previously scattered inline "pending_upstream" warnings (some
// of which showed raw field names) with one header-level indicator that
// explains, in plain language, what's not available yet and why.
export function DataSourcesIndicator({
  summary,
  mitre,
  pipeline,
}: {
  summary: MetricsSummary | null;
  mitre: MetricsMitre | null;
  pipeline: MetricsPipeline | null;
}) {
  const [open, setOpen] = useState(false);
  const pending = collectPendingSources(summary, mitre, pipeline);

  if (pending.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
      >
        {pending.length} source{pending.length === 1 ? "" : "s"} awaiting data
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <ul className="space-y-2 text-xs">
            {pending.map((source) => (
              <li key={source.label}>
                <p className="font-semibold text-zinc-700 dark:text-zinc-300">{source.label}</p>
                <p className="text-zinc-500">{source.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
