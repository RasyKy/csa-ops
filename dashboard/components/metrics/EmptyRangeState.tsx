"use client";

import { useEffect, useState } from "react";

import { RANGE_LABEL } from "@/lib/range";
import type { MetricsRange } from "@/lib/types";

// A slim, dismissible banner -- not a page swap. The layout underneath
// stays exactly the same whether the range is empty or not (every count
// just reads 0); this only exists to offer a quick way out of a range that
// happens to have nothing in it.
export function EmptyRangeBanner({ range, onSwitchToAll }: { range: MetricsRange; onSwitchToAll: () => void }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [range]);

  if (dismissed || range === "all") return null;

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className="truncate text-zinc-600 dark:text-zinc-400">No activity in {RANGE_LABEL[range]}.</span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onSwitchToAll}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Switch to all time
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ×
        </button>
      </div>
    </div>
  );
}
