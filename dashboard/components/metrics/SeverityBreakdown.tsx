import { SEVERITY_HEX, SEVERITY_ORDER } from "@/lib/severity";
import type { MetricsTimeseries, MetricsTop, RuleTerm, TopTerm } from "@/lib/types";
import { MetricState } from "./MetricState";

function TopList({ title, items, getLabel }: { title: string; items: TopTerm[]; getLabel?: (item: TopTerm) => string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No data</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => {
            const label = getLabel ? getLabel(item) : item.key;
            return (
              <li key={item.key} className="flex justify-between gap-4">
                <span className="truncate" title={label}>
                  {label}
                </span>
                <span className="text-zinc-500">{item.count}</span>
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
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Severity breakdown</p>
      <ul className="space-y-1.5">
        {SEVERITY_ORDER.map((severity) => {
          const count = totals[severity] ?? 0;
          const width = grandTotal > 0 ? (count / grandTotal) * 100 : 0;
          return (
            <li key={severity} className="flex items-center gap-2 text-sm">
              <span className="w-16 shrink-0 capitalize text-zinc-500">{severity}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${width}%`, background: SEVERITY_HEX[severity] }}
                />
              </span>
              <span className="w-6 shrink-0 text-right">{count}</span>
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
            <TopList title="Top hosts" items={top.top_hosts.status === "ok" ? top.top_hosts.value : []} />
          )}
        </div>
        <div className="sm:col-span-1">
          {!top ? (
            <MetricState status="loading" />
          ) : (
            <TopList
              title="Top rules"
              items={top.top_rules.status === "ok" ? top.top_rules.value : []}
              getLabel={(item) => (item as RuleTerm).title ?? item.key}
            />
          )}
        </div>
      </div>
    </div>
  );
}
