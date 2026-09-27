"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useTheme } from "@/components/ThemeProvider";
import type { MetricsTimeseries } from "@/lib/types";
import { SEVERITY_HEX, SEVERITY_ORDER } from "@/lib/severity";
import { MetricState } from "./MetricState";
import { tooltipStyle } from "./chartTheme";

function formatBucketLabel(bucket: string): string {
  const date = new Date(bucket);
  return Number.isNaN(date.getTime()) ? bucket : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}

export function AlertsTimeseriesChart({ data }: { data: MetricsTimeseries | null }) {
  const { theme } = useTheme();

  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Alerts over time</h3>
      {!data ? (
        <MetricState status="loading" />
      ) : data.buckets.status !== "ok" ? (
        <MetricState status={data.buckets.status} noDataMessage="No alerts in this range" />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={data.buckets.value.map((b) => ({ label: formatBucketLabel(b.bucket), ...b.severity_counts }))}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle(theme)} />
            <Legend
              content={() => (
                <ul className="mt-2 flex justify-center gap-4 text-xs text-zinc-500">
                  {SEVERITY_ORDER.map((severity) => (
                    <li key={severity} className="flex items-center gap-1">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ background: SEVERITY_HEX[severity] }}
                      />
                      {severity}
                    </li>
                  ))}
                </ul>
              )}
            />
            {SEVERITY_ORDER.map((severity) => (
              <Bar key={severity} dataKey={severity} stackId="severity" fill={SEVERITY_HEX[severity]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
