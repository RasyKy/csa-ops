import type { MetricsRange } from "./types";

// Mirrors backend/app/routers/metrics.py's _RANGE_DELTAS/_interval_for_range
// exactly -- kept here (not derived from the API response) because the
// newest-incidents fetch and the timeseries zero-fill both need it before
// any metrics response has come back.
const RANGE_DELTA_MS: Partial<Record<MetricsRange, number>> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function sinceForRange(range: MetricsRange, now: Date = new Date()): string | undefined {
  const deltaMs = RANGE_DELTA_MS[range];
  if (deltaMs === undefined) return undefined; // "all" -- no lower bound
  return new Date(now.getTime() - deltaMs).toISOString();
}

export function intervalForRange(range: MetricsRange): "hour" | "day" {
  return range === "24h" ? "hour" : "day";
}

export const RANGE_LABEL: Record<MetricsRange, string> = {
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  all: "all time",
};
