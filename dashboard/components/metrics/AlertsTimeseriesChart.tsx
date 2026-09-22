"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { MetricsTimeseries } from "@/lib/types";
import { MetricState } from "./MetricState";

// Matches SeverityBadge.tsx's palette.
const SEVERITY_COLORS: Record<string, string> = {
  low: "#94a3b8",
  medium: "#fbbf24",
  high: "#f97316",
  critical: "#ef4444",
};

function formatBucketLabel(bucket: string): string {
  const date = new Date(bucket);
  return Number.isNaN(date.getTime()) ? bucket : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}

export function AlertsTimeseriesChart({ data }: { data: MetricsTimeseries | null }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Alerts over time</h3>
      {!data ? (
        <MetricState status="loading" />
      ) : data.buckets.status !== "ok" ? (
        <MetricState status={data.buckets.status} />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={data.buckets.value.map((b) => ({ label: formatBucketLabel(b.bucket), ...b.severity_counts }))}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {(["low", "medium", "high", "critical"] as const).map((severity) => (
              <Bar key={severity} dataKey={severity} stackId="severity" fill={SEVERITY_COLORS[severity]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
