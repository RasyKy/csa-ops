import type { DurationStats, MetricsSummary } from "@/lib/types";
import { MetricState } from "./MetricState";

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function StatRow({ label, stats }: { label: string; stats: DurationStats }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <span>
        mean {formatSeconds(stats.mean)} · median {formatSeconds(stats.median)} · p90{" "}
        {formatSeconds(stats.p90)} · n={stats.count}
      </span>
    </div>
  );
}

export function MttdMttrPanel({ summary }: { summary: MetricsSummary | null }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">MTTD / MTTR</h3>
      {!summary ? (
        <MetricState status="loading" />
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            {summary.mttd.status === "ok" && summary.mttd.value ? (
              <StatRow label="MTTD" stats={summary.mttd.value} />
            ) : (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">MTTD</span>
                <MetricState status={summary.mttd.status} pendingMessage="No attack_action_time source yet" />
              </div>
            )}
            {summary.mttr.status === "ok" && summary.mttr.value ? (
              <StatRow label="MTTR" stats={summary.mttr.value} />
            ) : (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">MTTR</span>
                <MetricState status={summary.mttr.status} />
              </div>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">By scenario</p>
            {summary.mttr_by_scenario.status !== "ok" ? (
              <MetricState status={summary.mttr_by_scenario.status} />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-1 font-normal">Scenario</th>
                    <th className="pb-1 font-normal">Runs</th>
                    <th className="pb-1 text-right font-normal">Mean MTTD</th>
                    <th className="pb-1 text-right font-normal">Mean MTTR</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summary.mttr_by_scenario.value).map(([scenario, stats]) => (
                    <tr key={scenario} className="border-t border-slate-100 dark:border-slate-900">
                      <td className="py-1">{scenario}</td>
                      <td className="py-1">{stats.count}</td>
                      <td className="py-1 text-right text-slate-500">
                        {summary.mttd_by_scenario.status === "ok"
                          ? formatSeconds(summary.mttd_by_scenario.value[scenario]?.mean ?? 0)
                          : "—"}
                      </td>
                      <td className="py-1 text-right">{formatSeconds(stats.mean)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
