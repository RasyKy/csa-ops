"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useTheme } from "@/components/ThemeProvider";
import { SEVERITY_HEX, SEVERITY_ORDER } from "@/lib/severity";
import type { MetricsTimeseries, TimeseriesBucket } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";
import { tooltipStyle } from "./chartTheme";

function roundToBucket(date: Date, interval: "hour" | "day"): Date {
  const rounded = new Date(date);
  if (interval === "hour") {
    rounded.setUTCMinutes(0, 0, 0);
  } else {
    rounded.setUTCHours(0, 0, 0, 0);
  }
  return rounded;
}

// The layout must stay identical whether a range has data or not (no chart
// disappearing/reappearing) -- so an empty range still needs a full set of
// zero-value buckets to draw axes against, not just "no data" text in
// place of the chart. Only ranges with a concrete lower bound (24h/7d/30d)
// get this treatment; "all" has no fixed start to pad from, so it stays
// sparse from the earliest real bucket, same as before.
function zeroFillBuckets(
  buckets: TimeseriesBucket[],
  since: string | null,
  asOf: string,
  interval: "hour" | "day",
): TimeseriesBucket[] {
  if (!since) return buckets;

  const byBucket = new Map(buckets.map((b) => [b.bucket, b.severity_counts]));
  const filled: TimeseriesBucket[] = [];
  const stepMs = interval === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  let cursor = roundToBucket(new Date(since), interval);
  const end = new Date(asOf);

  while (cursor <= end) {
    const key = cursor.toISOString();
    filled.push({ bucket: key, severity_counts: byBucket.get(key) ?? {} });
    cursor = new Date(cursor.getTime() + stepMs);
  }
  return filled;
}

function formatBucketLabel(bucket: string, interval: "hour" | "day"): string {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  return interval === "hour"
    ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AlertsTimeseriesChart({ data }: { data: MetricsTimeseries | null }) {
  const { theme } = useTheme();

  const interval: "hour" | "day" = data?.range === "24h" ? "hour" : "day";
  const hasAlerts = data?.buckets.status === "ok" && data.buckets.value.some((b) => Object.keys(b.severity_counts).length > 0);
  const chartBuckets =
    data && (data.buckets.status === "ok" || data.buckets.status === "no_data")
      ? zeroFillBuckets(data.buckets.value, data.since, data.as_of, interval)
      : [];

  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Alerts over time
        <InfoTooltip text="Alert volume in this range, broken down by severity." />
      </h3>
      {!data ? (
        <MetricState status="loading" />
      ) : data.buckets.status === "pending_upstream" ? (
        <MetricState status="pending_upstream" />
      ) : (
        <div className="relative">
          {!hasAlerts && (
            <p className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-zinc-500">
              No alerts in this range
            </p>
          )}
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartBuckets.map((b) => ({ label: formatBucketLabel(b.bucket, interval), ...b.severity_counts }))}>
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
        </div>
      )}
    </div>
  );
}
