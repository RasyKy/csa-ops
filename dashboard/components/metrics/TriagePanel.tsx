import type { MetricsTriage } from "@/lib/types";
import { MetricState } from "./MetricState";

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function TriagePanel({ data }: { data: MetricsTriage | null }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">AI triage</h3>
      {!data ? (
        <MetricState status="loading" />
      ) : data.stats.status !== "ok" || !data.stats.value ? (
        <MetricState status={data.stats.status} />
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Avg confidence (low=1, med=2, high=3)</span>
            <span>{data.stats.value.avg_confidence?.toFixed(1) ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Avg triage latency</span>
            <span>
              {data.stats.value.avg_latency_seconds !== null
                ? formatSeconds(data.stats.value.avg_latency_seconds)
                : "—"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Failed triage runs</span>
            <span>
              {data.stats.value.failed_count} / {data.stats.value.total_count}
            </span>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Verdict distribution
            </p>
            <ul className="space-y-1">
              {Object.entries(data.stats.value.verdict_counts).map(([verdict, count]) => (
                <li key={verdict} className="flex justify-between gap-4">
                  <span>{verdict}</span>
                  <span className="text-slate-500">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
