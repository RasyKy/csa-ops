import type { MetricsTriage } from "@/lib/types";
import { MetricState } from "./MetricState";

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// Compact by design -- headline numbers plus the top verdict, not the full
// distribution table (that stays reasonable to add back on /incidents if
// ever needed, but doesn't belong in a 3-across bottom row).
export function TriagePanel({ data }: { data: MetricsTriage | null }) {
  const stats = data?.stats.status === "ok" ? data.stats.value : null;
  const topVerdict = stats
    ? Object.entries(stats.verdict_counts).sort(([, a], [, b]) => b - a)[0]
    : undefined;

  return (
    <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">AI triage</h3>
      {!data ? (
        <MetricState status="loading" />
      ) : !stats ? (
        <MetricState status={data.stats.status} noDataMessage="No triage yet" />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Confidence</span>
            <span>
              {(["low", "medium", "high"] as const).map((level) => `${level} ${stats.confidence_counts[level] ?? 0}`).join(" · ")}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Avg latency</span>
            <span>{stats.avg_latency_seconds !== null ? formatSeconds(stats.avg_latency_seconds) : "—"}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">Failed runs</span>
            <span>
              {stats.failed_count}/{stats.total_count}
            </span>
          </div>
          {topVerdict && (
            <div className="flex justify-between gap-2 truncate">
              <span className="text-zinc-500">Top verdict</span>
              <span className="truncate">
                {topVerdict[0].replace(/_/g, " ")} ({topVerdict[1]})
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
