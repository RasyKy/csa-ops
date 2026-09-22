import type { ActionStats, DryRunStats, MetricsResponse } from "@/lib/types";
import { MetricState } from "./MetricState";

function StatsTable({ rows }: { rows: [string, ActionStats][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-500">
          <th className="pb-1 font-normal"> </th>
          <th className="pb-1 text-right font-normal">Total</th>
          <th className="pb-1 text-right font-normal">Succeeded</th>
          <th className="pb-1 text-right font-normal">Rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, stats]) => (
          <tr key={key} className="border-t border-slate-100 dark:border-slate-900">
            <td className="py-1">{key}</td>
            <td className="py-1 text-right">{stats.total}</td>
            <td className="py-1 text-right">{stats.succeeded}</td>
            <td className="py-1 text-right text-slate-500">
              {stats.rate === null ? "—" : `${(stats.rate * 100).toFixed(0)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DryRunTable({ stats }: { stats: DryRunStats }) {
  const entries = Object.entries(stats.by_status);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-500">
          <th className="pb-1 font-normal">Status</th>
          <th className="pb-1 text-right font-normal">Count</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([status, count]) => (
          <tr key={status} className="border-t border-slate-100 dark:border-slate-900">
            <td className="py-1">{status}</td>
            <td className="py-1 text-right">{count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ResponsePanel({ data }: { data: MetricsResponse | null }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Response</h3>
        {data && (
          <span className="flex items-center gap-2 text-xs">
            <span
              className={`rounded px-2 py-0.5 font-medium ${
                data.kill_switch
                  ? "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              kill switch {data.kill_switch ? "ON" : "off"}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {data.response_mode}
            </span>
          </span>
        )}
      </div>

      {!data ? (
        <MetricState status="loading" />
      ) : (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Live success rate by action type
            </p>
            {data.by_action.status !== "ok" ? (
              <MetricState status={data.by_action.status} noDataMessage="No live actions in this range yet." />
            ) : (
              <StatsTable rows={Object.entries(data.by_action.value)} />
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Live success rate (overall)
            </p>
            {data.live.status !== "ok" ? (
              <MetricState status={data.live.status} noDataMessage="No live actions in this range yet." />
            ) : (
              <StatsTable rows={[["live", data.live.value]]} />
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Dry-run outcomes ({data.dry_run.status === "ok" ? data.dry_run.value.total : 0} simulated -- never
              "succeed" or "fail")
            </p>
            {data.dry_run.status !== "ok" ? (
              <MetricState status={data.dry_run.status} noDataMessage="No dry-run actions in this range yet." />
            ) : (
              <DryRunTable stats={data.dry_run.value} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
