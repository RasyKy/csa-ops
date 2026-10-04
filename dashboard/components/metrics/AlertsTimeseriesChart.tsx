"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { SEVERITY_HEX, SEVERITY_ORDER } from "@/lib/severity";
import { formatHourMinute, formatShortDate } from "@/lib/time";
import type { MetricsTimeseries } from "@/lib/types";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

function getUtcMonday(d: Date): Date {
  const res = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = res.getUTCDay();
  const diff = (day + 6) % 7;
  res.setUTCDate(res.getUTCDate() - diff);
  return res;
}

interface ChartBucket {
  label: string;
  fullLabel: string;
  [sev: string]: string | number | undefined;
}

function processBuckets(
  data: MetricsTimeseries | null,
): { buckets: ChartBucket[]; caption: string } {
  if (!data || (data.buckets.status !== "ok" && data.buckets.status !== "no_data")) {
    return { buckets: [], caption: "Alerts per day (UTC days)" };
  }

  const { range, since, as_of, buckets } = data;
  const rawBuckets = buckets.status === "ok" ? buckets.value : [];

  if (range === "24h") {
    const stepMs = 60 * 60 * 1000;
    const byBucket = new Map(rawBuckets.map((b) => [b.bucket, b.severity_counts]));
    const filled: ChartBucket[] = [];
    const start = since ? new Date(since) : new Date(Date.now() - 24 * 3600 * 1000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(as_of);
    let cur = new Date(start);
    while (cur <= end) {
      const key = cur.toISOString();
      const counts = byBucket.get(key) ?? {};
      filled.push({
        label: formatHourMinute(key),
        fullLabel: `${formatShortDate(key)} ${formatHourMinute(key)}`,
        ...counts,
      });
      cur = new Date(cur.getTime() + stepMs);
    }
    return { buckets: filled, caption: "Alerts per hour" };
  }

  if (range === "7d" || range === "30d") {
    const stepMs = 24 * 60 * 60 * 1000;
    const byBucket = new Map(rawBuckets.map((b) => [b.bucket, b.severity_counts]));
    const filled: ChartBucket[] = [];
    const start = since ? new Date(since) : new Date(Date.now() - (range === "7d" ? 7 : 30) * 86400 * 1000);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(as_of);
    let cur = new Date(start);
    while (cur <= end) {
      const key = cur.toISOString();
      const counts = byBucket.get(key) ?? {};
      filled.push({
        label: formatShortDate(key, "UTC"),
        fullLabel: `${formatShortDate(key, "UTC")} ${cur.getUTCFullYear()}`,
        ...counts,
      });
      cur = new Date(cur.getTime() + stepMs);
    }
    return { buckets: filled, caption: "Alerts per day (UTC days)" };
  }

  // range === "all" (since is null)
  if (rawBuckets.length === 0) {
    return { buckets: [], caption: "Alerts per day (UTC days)" };
  }

  const sorted = [...rawBuckets].sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
  const firstBucketDate = new Date(sorted[0].bucket);
  const asOfDate = new Date(as_of);

  const startUtcDay = new Date(Date.UTC(firstBucketDate.getUTCFullYear(), firstBucketDate.getUTCMonth(), firstBucketDate.getUTCDate()));
  const endUtcDay = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), asOfDate.getUTCDate()));

  const spanDays = Math.round((endUtcDay.getTime() - startUtcDay.getTime()) / (86400 * 1000)) + 1;

  if (spanDays <= 90) {
    const byDay = new Map<string, Record<string, number>>();
    for (const b of rawBuckets) {
      const d = new Date(b.bucket);
      const dayKey = d.toISOString().slice(0, 10);
      const existing = byDay.get(dayKey) ?? {};
      for (const [sev, count] of Object.entries(b.severity_counts)) {
        existing[sev] = (existing[sev] ?? 0) + count;
      }
      byDay.set(dayKey, existing);
    }

    const filled: ChartBucket[] = [];
    let cur = new Date(startUtcDay);
    while (cur <= endUtcDay) {
      const key = cur.toISOString();
      const dayKey = key.slice(0, 10);
      const counts = byDay.get(dayKey) ?? {};
      filled.push({
        label: formatShortDate(key, "UTC"),
        fullLabel: `${formatShortDate(key, "UTC")} ${cur.getUTCFullYear()}`,
        ...counts,
      });
      cur = new Date(cur.getTime() + 86400 * 1000);
    }
    return { buckets: filled, caption: "Alerts per day (UTC days)" };
  }

  const startMonday = getUtcMonday(startUtcDay);
  const endMonday = getUtcMonday(endUtcDay);

  const filled: ChartBucket[] = [];
  let weekCur = new Date(startMonday);
  while (weekCur <= endMonday) {
    const nextWeek = new Date(weekCur.getTime() + 7 * 86400 * 1000);
    const weekLabel = `Week of ${formatShortDate(weekCur.toISOString(), "UTC")}`;
    const weekCounts: Record<string, number> = {};
    for (const b of rawBuckets) {
      const bTime = new Date(b.bucket).getTime();
      if (bTime >= weekCur.getTime() && bTime < nextWeek.getTime()) {
        for (const [sev, cnt] of Object.entries(b.severity_counts)) {
          weekCounts[sev] = (weekCounts[sev] ?? 0) + cnt;
        }
      }
    }
    filled.push({
      label: weekLabel,
      fullLabel: `${weekLabel} ${weekCur.getUTCFullYear()}`,
      ...weekCounts,
    });
    weekCur = nextWeek;
  }
  return { buckets: filled, caption: "Alerts per week" };
}

interface TooltipPayloadEntry {
  dataKey?: string | number;
  value?: number | string;
  [key: string]: unknown;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((acc: number, entry: TooltipPayloadEntry) => acc + (Number(entry.value) || 0), 0);
  const fullLabel = (payload[0]?.payload as { fullLabel?: string } | undefined)?.fullLabel ?? label;
  return (
    <div data-testid="timeseries-tooltip" className="rounded border border-line bg-surface p-2 text-xs shadow-md">
      <p className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5">{fullLabel}</p>
      <ul className="space-y-1 mb-1.5">
        {SEVERITY_ORDER.map((sev) => {
          const entry = payload.find((p: TooltipPayloadEntry) => p.dataKey === sev);
          const count = entry ? entry.value : 0;
          return (
            <li key={sev} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 capitalize text-zinc-500">
                <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_HEX[sev] }} />
                {sev}
              </span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">{count}</span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line pt-1 flex items-center justify-between font-semibold text-zinc-900 dark:text-zinc-100">
        <span>Total</span>
        <span className="font-mono">{total}</span>
      </div>
    </div>
  );
}

export function AlertsTimeseriesChart({ data }: { data: MetricsTimeseries | null }) {
  const { buckets: chartBuckets, caption } = processBuckets(data);
  const hasAlerts = data?.buckets.status === "ok" && data.buckets.value.some((b) => Object.keys(b.severity_counts).length > 0);

  return (
    <div data-testid="overview-card" className="flex flex-col rounded-lg border border-line bg-surface p-4">
      <div className="mb-3">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-zinc-500">
          Alerts over time
          <InfoTooltip text="Alert volume in this range, broken down by severity." />
        </h3>
        <p className="mt-0.5 text-xs text-zinc-400">{caption}</p>
      </div>
      {!data ? (
        <MetricState status="loading" />
      ) : data.buckets.status === "pending_upstream" ? (
        <MetricState status="pending_upstream" />
      ) : (
        <div className="relative min-h-[220px] flex-1" data-testid="timeseries-chart-container" data-slot-count={chartBuckets.length}>
          {!hasAlerts && (
            <p className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-zinc-500">
              No alerts in this range
            </p>
          )}
          <div className="absolute inset-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartBuckets}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
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
        </div>
      )}
    </div>
  );
}
