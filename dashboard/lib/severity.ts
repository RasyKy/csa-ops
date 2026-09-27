import type { Severity } from "./types";

// Single source of truth for severity color, reused by badges, every chart,
// and the MITRE heatmap's accent -- theme-independent by design (a
// saturated color reads fine as a chip/fill against both a near-white and
// a near-black surface; confirmed visually, not just asserted).
export const SEVERITY_HEX: Record<Severity, string> = {
  low: "#3b82f6",
  medium: "#f59e0b",
  high: "#f97316",
  critical: "#ef4444",
};

export const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];

export const SEVERITY_BADGE_CLASSES: Record<Severity, string> = {
  low: "bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  medium: "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  high: "bg-orange-300 text-orange-950 dark:bg-orange-800 dark:text-orange-50",
  critical: "bg-red-300 text-red-950 dark:bg-red-800 dark:text-red-50",
};
