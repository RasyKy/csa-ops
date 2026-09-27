import type { MetricsResponse } from "@/lib/types";
import { MetricState } from "./MetricState";

function summarizeByStatus(byStatus: Record<string, number>): string {
  const entries = Object.entries(byStatus);
  if (entries.length === 0) return "none";
  return entries.map(([status, count]) => `${count} ${status}`).join(", ");
}

// Compact by design -- this sits in the bottom row next to two other
// panels. Full per-action breakdowns are one click away on /incidents;
// here it's headline numbers only.
export function ResponsePanel({ data }: { data: MetricsResponse | null }) {
  return (
    <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Response</h3>
        {data && (
          <span className="flex shrink-0 items-center gap-1 text-xs">
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${
                data.kill_switch
                  ? "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              kill {data.kill_switch ? "ON" : "off"}
            </span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {data.response_mode}
            </span>
          </span>
        )}
      </div>

      {!data ? (
        <MetricState status="loading" />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Live success</span>
            {data.live.status === "ok" ? (
              <span>
                {data.live.value.succeeded}/{data.live.value.total}
                {data.live.value.rate !== null && ` (${(data.live.value.rate * 100).toFixed(0)}%)`}
              </span>
            ) : (
              <MetricState status={data.live.status} noDataMessage="No live actions yet" />
            )}
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Dry-run</span>
            {data.dry_run.status === "ok" ? (
              <span className="truncate">
                {data.dry_run.value.total} ({summarizeByStatus(data.dry_run.value.by_status)})
              </span>
            ) : (
              <MetricState status={data.dry_run.status} noDataMessage="No dry-run actions yet" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
