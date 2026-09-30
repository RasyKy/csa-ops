import Link from "next/link";

import { SEVERITY_HEX, SEVERITY_ORDER } from "@/lib/severity";
import type { MetricsTimeseries, MetricsTop, RuleTerm, TopTerm } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

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
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
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
                <Link href={getHref(item)} className="flex justify-between gap-4 hover:underline" title={label}>
                  <span className="truncate">{label}</span>
                  <span className="text-zinc-500">{item.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// A 4-slice donut with no legend made severity counts unreadable without
// hovering -- a labeled list with a proportional bar reads at a glance and
// always shows all 4 severities (even at 0), so this panel's height never
// shifts between an empty and a populated range.
function SeverityCounts({ timeseries }: { timeseries: MetricsTimeseries | null }) {
  const totals: Record<string, number> = {};
  if (timeseries?.buckets.status === "ok") {
    for (const bucket of timeseries.buckets.value) {
      for (const [severity, count] of Object.entries(bucket.severity_counts)) {
        totals[severity] = (totals[severity] ?? 0) + count;
      }
    }
  }
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

  if (!timeseries) return <MetricState status="loading" />;

  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Severity breakdown
        <InfoTooltip text="Incidents in this range, grouped by severity." />
      </div>
      <ul className="space-y-1.5">
        {SEVERITY_ORDER.map((severity) => {
          const count = totals[severity] ?? 0;
          const width = grandTotal > 0 ? (count / grandTotal) * 100 : 0;
          return (
            <li key={severity}>
              <Link href={`/incidents?severity=${severity}`} className="flex items-center gap-2 text-sm hover:underline">
                <span className="w-16 shrink-0 capitalize text-zinc-500">{severity}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${width}%`, background: SEVERITY_HEX[severity] }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right">{count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SeverityBreakdown({ timeseries, top }: { timeseries: MetricsTimeseries | null; top: MetricsTop | null }) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Severity breakdown &amp; top sources
      </h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <SeverityCounts timeseries={timeseries} />
        </div>
        <div className="sm:col-span-1">
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
        <div className="sm:col-span-1">
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
    </div>
  );
}
