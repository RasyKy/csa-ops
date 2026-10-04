import Link from "next/link";

import { SEVERITY_HEX } from "@/lib/severity";
import type { MetricsTimeseries, MetricsTop, RuleTerm, TopTerm } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

const SEVERITY_ORDER_DESC = ["critical", "high", "medium", "low"] as const;

function TopList({
  title,
  tooltip,
  items,
  getLabel,
  getHref,
}: {
  title: string;
  tooltip: string;
  items: TopTerm[];
  getLabel?: (item: TopTerm) => string;
  getHref: (item: TopTerm) => string;
}) {
  const maxCount = Math.max(1, ...items.map((i) => i.count));

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-500">
        {title}
        <InfoTooltip text={tooltip} />
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No data</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => {
            const label = getLabel ? getLabel(item) : item.key;
            return (
              <li key={item.key}>
                <Link
                  href={getHref(item)}
                  className="flex items-center gap-3 py-1 hover:underline"
                  title={label}
                >
                  <span className="line-clamp-2 flex-1 text-xs text-zinc-800 dark:text-zinc-200" title={label}>
                    {label}
                  </span>
                  <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-subtle" data-testid="top-list-bar-track">
                    <span
                      data-testid="top-list-bar"
                      data-count={item.count}
                      data-max={maxCount}
                      className="block h-full rounded-full bg-zinc-400 dark:bg-zinc-600"
                      style={{ width: `${(item.count / maxCount) * 100}%` }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right font-mono text-xs text-zinc-500">{item.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SeverityBreakdown({
  timeseries,
  top,
}: {
  timeseries: MetricsTimeseries | null;
  top: MetricsTop | null;
}) {
  const totals: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  if (timeseries?.buckets.status === "ok") {
    for (const bucket of timeseries.buckets.value) {
      for (const [severity, count] of Object.entries(bucket.severity_counts)) {
        totals[severity] = (totals[severity] ?? 0) + count;
      }
    }
  }
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

  return (
    <div data-testid="overview-card" className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-zinc-500">
          Alerts by severity
          <InfoTooltip text="Numbers count alerts in this range." />
        </h3>
      </div>

      {!timeseries ? (
        <MetricState status="loading" />
      ) : (
        <div className="space-y-4">
          <div>
            {/* Stacked horizontal bar */}
            <div data-testid="severity-stacked-bar" className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-subtle">
              {grandTotal > 0 &&
                SEVERITY_ORDER_DESC.map((severity) => {
                  const count = totals[severity] ?? 0;
                  if (count === 0) return null;
                  const pct = (count / grandTotal) * 100;
                  return (
                    <div
                      key={severity}
                      data-testid={`severity-segment-${severity}`}
                      data-severity={severity}
                      data-count={count}
                      style={{ width: `${pct}%`, background: SEVERITY_HEX[severity] }}
                      className="h-full first:rounded-l-full last:rounded-r-full"
                      title={`${severity}: ${count}`}
                    />
                  );
                })}
            </div>

            {/* Severity rows: critical, high, medium, low */}
            <ul className="space-y-1.5">
              {SEVERITY_ORDER_DESC.map((severity) => {
                const count = totals[severity] ?? 0;
                const pct = grandTotal > 0 ? Math.round((count / grandTotal) * 100) : 0;
                const isZero = count === 0;
                return (
                  <li key={severity}>
                    <Link
                      href={`/alerts?severity=${severity}`}
                      className={`flex items-center justify-between py-0.5 text-sm hover:underline ${
                        isZero ? "text-zinc-400 opacity-60 dark:text-zinc-500" : "text-zinc-900 dark:text-zinc-100"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_HEX[severity] }} />
                        <span className="capitalize">{severity}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono text-xs">{count}</span>
                        <span className="w-10 text-right text-xs text-zinc-400">{pct}%</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="border-t border-line pt-4">
            {!top ? (
              <MetricState status="loading" />
            ) : (
              <TopList
                title="Top hosts"
                tooltip="Hosts generating the most alerts in this range."
                items={top.top_hosts.status === "ok" ? top.top_hosts.value : []}
                getHref={(item) => `/alerts?host=${encodeURIComponent(item.key)}`}
              />
            )}
          </div>

          <div className="border-t border-line pt-4">
            {!top ? (
              <MetricState status="loading" />
            ) : (
              <TopList
                title="Top rules"
                tooltip="Detection rules firing most often in this range."
                items={top.top_rules.status === "ok" ? top.top_rules.value : []}
                getLabel={(item) => (item as RuleTerm).title ?? item.key}
                getHref={(item) => `/alerts?rule_id=${encodeURIComponent(item.key)}`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

