import type { MetricsSummary } from "@/lib/types";
import { MetricState } from "./MetricState";

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// Collapsed by default, next to the KPI row -- the headline MTTD/MTTR
// numbers already live in KpiCards, so this only needs to exist for the
// per-scenario drilldown, not to repeat them.
export function MttdMttrPanel({ summary }: { summary: MetricsSummary | null }) {
  if (!summary || summary.mttr_by_scenario.status !== "ok") return null;

  const scenarios = Object.entries(summary.mttr_by_scenario.value);
  if (scenarios.length === 0) return null;

  return (
    <details className="rounded border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Per-scenario breakdown
      </summary>
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="pb-1 font-normal">Scenario</th>
              <th className="pb-1 font-normal">Runs</th>
              <th className="pb-1 text-right font-normal">Mean MTTD</th>
              <th className="pb-1 text-right font-normal">Mean MTTR</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map(([scenario, stats]) => (
              <tr key={scenario} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-1">{scenario}</td>
                <td className="py-1">{stats.count}</td>
                <td className="py-1 text-right text-zinc-500">
                  {summary.mttd_by_scenario.status === "ok" ? (
                    formatSeconds(summary.mttd_by_scenario.value[scenario]?.mean ?? 0)
                  ) : (
                    <MetricState status={summary.mttd_by_scenario.status} pendingMessage="Waiting on detection-timing data" />
                  )}
                </td>
                <td className="py-1 text-right">{formatSeconds(stats.mean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
