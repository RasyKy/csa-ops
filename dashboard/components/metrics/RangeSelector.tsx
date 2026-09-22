"use client";

import type { MetricsRange } from "@/lib/types";

const RANGES: { value: MetricsRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

export function RangeSelector({
  range,
  onRangeChange,
  lastUpdated,
}: {
  range: MetricsRange;
  onRangeChange: (range: MetricsRange) => void;
  lastUpdated: Date | null;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1 rounded border border-slate-300 p-0.5 dark:border-slate-700">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => onRangeChange(r.value)}
            className={`rounded px-3 py-1 text-sm ${
              range === r.value
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <span className="text-xs text-slate-500">
        {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}
      </span>
    </div>
  );
}
