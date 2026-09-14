"use client";

import type { Severity } from "@/lib/types";

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

export function Filters({
  severity,
  host,
  onSeverityChange,
  onHostChange,
}: {
  severity: Severity | "";
  host: string;
  onSeverityChange: (value: Severity | "") => void;
  onHostChange: (value: string) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-sm">
        <span className="mb-1 text-slate-500">Severity</span>
        <select
          className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          value={severity}
          onChange={(e) => onSeverityChange(e.target.value as Severity | "")}
        >
          <option value="">All</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm">
        <span className="mb-1 text-slate-500">Host</span>
        <input
          className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          value={host}
          onChange={(e) => onHostChange(e.target.value)}
          placeholder="WS01"
        />
      </label>
    </div>
  );
}
