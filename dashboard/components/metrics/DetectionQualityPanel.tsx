import type { MetricsTop } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

const TOP_N = 3;

// Compact by design -- top N noisiest rules only, not the full table (this
// sits in a 3-across bottom row with Response and AI triage).
export function DetectionQualityPanel({ top }: { top: MetricsTop | null }) {
  const entries = top?.fp_rate_by_rule.status === "ok" ? Object.entries(top.fp_rate_by_rule.value) : [];
  const topEntries = entries.sort(([, a], [, b]) => b.rate - a.rate).slice(0, TOP_N);

  return (
    <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Detection quality (FP rate)
        <InfoTooltip text="Rules with the highest false-positive rate in this range." />
      </h3>
      {!top ? (
        <MetricState status="loading" />
      ) : top.fp_rate_by_rule.status !== "ok" || topEntries.length === 0 ? (
        <MetricState status={top?.fp_rate_by_rule.status ?? "no_data"} noDataMessage="No labeled alerts yet" />
      ) : (
        <ul className="space-y-1.5 text-sm">
          {topEntries.map(([rule, stats]) => (
            <li key={rule} className="flex justify-between gap-2">
              <span className="truncate" title={rule}>
                {rule}
              </span>
              <span
                className={
                  stats.rate >= 0.5
                    ? "shrink-0 text-red-600 dark:text-red-400"
                    : stats.rate > 0
                      ? "shrink-0 text-amber-600 dark:text-amber-400"
                      : "shrink-0 text-zinc-500"
                }
              >
                {(stats.rate * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
