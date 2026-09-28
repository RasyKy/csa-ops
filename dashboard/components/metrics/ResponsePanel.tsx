import type { MetricsResponse } from "@/lib/types";
import { MetricState } from "./MetricState";

// Compact by design -- this sits in the bottom row next to two other
// panels. Kill switch / response mode already show in Needs Attention, so
// they aren't repeated here. Full per-action breakdowns are one click away
// on /incidents; here it's headline numbers only.
export function ResponsePanel({ data }: { data: MetricsResponse | null }) {
  return (
    <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Response</h3>

      {!data ? (
        <MetricState status="loading" />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Live success</span>
            <span>
              {data.live.value.succeeded}/{data.live.value.total}
              {data.live.value.rate !== null && ` (${(data.live.value.rate * 100).toFixed(0)}%)`}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Dry-run</span>
            <span>{data.dry_run.value.total}</span>
          </div>
        </div>
      )}
    </div>
  );
}
