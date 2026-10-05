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
  low: "border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-200",
  medium: "border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-400 dark:bg-amber-950/50 dark:text-amber-200",
  high: "border-orange-500 bg-orange-50 text-orange-950 dark:border-orange-400 dark:bg-orange-950/50 dark:text-orange-200",
  critical: "border-red-500 bg-red-50 text-red-950 dark:border-red-400 dark:bg-red-950/50 dark:text-red-200",
};
