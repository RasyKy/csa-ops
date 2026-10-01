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
      <div className="flex gap-1 rounded border border-zinc-300 p-0.5 dark:border-zinc-700">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => onRangeChange(r.value)}
            className={`rounded px-3 py-1 text-sm ${
              range === r.value
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <span className="text-xs text-zinc-500">
        {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}
      </span>
    </div>
  );
}
