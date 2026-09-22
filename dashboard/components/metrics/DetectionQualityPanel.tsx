import type { MetricsTop } from "@/lib/types";
import { MetricState } from "./MetricState";

export function DetectionQualityPanel({ top }: { top: MetricsTop | null }) {
  const entries = top?.fp_rate_by_rule.status === "ok" ? Object.entries(top.fp_rate_by_rule.value) : [];

  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Detection quality: false-positive rate
      </h3>
      {!top ? (
        <MetricState status="loading" />
      ) : top.fp_rate_by_rule.status !== "ok" || entries.length === 0 ? (
        <MetricState
          status={top.fp_rate_by_rule.status}
          noDataMessage="No alerts labeled false_positive/true_positive in this range yet."
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-1 font-normal">Rule</th>
              <th className="pb-1 text-right font-normal">Labeled alerts</th>
              <th className="pb-1 text-right font-normal">False positives</th>
              <th className="pb-1 text-right font-normal">FP rate</th>
            </tr>
          </thead>
          <tbody>
            {entries
              .sort(([, a], [, b]) => b.rate - a.rate)
              .map(([rule, stats]) => (
                <tr key={rule} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="py-1">{rule}</td>
                  <td className="py-1 text-right">{stats.total}</td>
                  <td className="py-1 text-right">{stats.fp_count}</td>
                  <td className="py-1 text-right">
                    <span
                      className={
                        stats.rate >= 0.5
                          ? "text-red-600 dark:text-red-400"
                          : stats.rate > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-slate-500"
                      }
                    >
                      {(stats.rate * 100).toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
