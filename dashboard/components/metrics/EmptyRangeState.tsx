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
    <div data-testid="overview-banner" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <span className="truncate text-zinc-600 dark:text-zinc-400">No activity in {RANGE_LABEL[range]}.</span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onSwitchToAll}
          className="rounded border border-line px-2 py-1 text-xs hover:bg-surface-subtle"
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
