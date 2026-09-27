"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { useTheme } from "@/components/ThemeProvider";
import type { MetricsTimeseries, MetricsTop } from "@/lib/types";
import { SEVERITY_HEX } from "@/lib/severity";
import { MetricState } from "./MetricState";
import { tooltipStyle } from "./chartTheme";

function TopList({ title, items }: { title: string; items: { key: string; count: number }[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No data</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.key} className="flex justify-between gap-4">
              <span className="truncate">{item.key}</span>
              <span className="text-zinc-500">{item.count}</span>
            </li>
          ))}
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
  const severityTotals: Record<string, number> = {};
  if (timeseries?.buckets.status === "ok") {
    for (const bucket of timeseries.buckets.value) {
      for (const [severity, count] of Object.entries(bucket.severity_counts)) {
        severityTotals[severity] = (severityTotals[severity] ?? 0) + count;
      }
    }
  }
  const donutData = Object.entries(severityTotals).map(([severity, count]) => ({ severity, count }));
  const { theme } = useTheme();

  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Severity breakdown &amp; top sources
      </h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          {!timeseries ? (
            <MetricState status="loading" />
          ) : donutData.length === 0 ? (
            <MetricState status={timeseries.buckets.status} />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={donutData} dataKey="count" nameKey="severity" innerRadius={30} outerRadius={55}>
                  {donutData.map((d) => (
                    <Cell
                      key={d.severity}
                      fill={SEVERITY_HEX[d.severity as keyof typeof SEVERITY_HEX] ?? "#71717a"}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle(theme)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="sm:col-span-1">
          {!top ? (
            <MetricState status="loading" />
          ) : top.top_hosts.status !== "ok" ? (
            <MetricState status={top.top_hosts.status} />
          ) : (
            <TopList title="Top hosts" items={top.top_hosts.value} />
          )}
        </div>
        <div className="sm:col-span-1">
          {!top ? (
            <MetricState status="loading" />
          ) : top.top_rules.status !== "ok" ? (
            <MetricState status={top.top_rules.status} />
          ) : (
            <TopList title="Top rules" items={top.top_rules.value} />
          )}
        </div>
      </div>
    </div>
  );
}
