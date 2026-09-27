import type { MetricsRange } from "@/lib/types";

const RANGE_LABEL: Record<MetricsRange, string> = {
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  all: "all time",
};

// Shown instead of every individual widget saying "no data" -- one
// page-level message with a way out, when the whole selected range is
// empty of alerts and incidents.
export function EmptyRangeState({ range, onSwitchToAll }: { range: MetricsRange; onSwitchToAll: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded border border-zinc-200 px-6 py-16 text-center dark:border-zinc-800">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-zinc-400">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 15l4-4 3 3 5-6" />
      </svg>
      <p className="text-sm text-zinc-500">No activity in {RANGE_LABEL[range]}.</p>
      {range !== "all" && (
        <button
          type="button"
          onClick={onSwitchToAll}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Switch to all time
        </button>
      )}
    </div>
  );
}
