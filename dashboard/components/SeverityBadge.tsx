import type { Severity } from "@/lib/types";

const COLORS: Record<Severity, string> = {
  low: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  medium: "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  high: "bg-orange-300 text-orange-950 dark:bg-orange-800 dark:text-orange-50",
  critical: "bg-red-300 text-red-950 dark:bg-red-800 dark:text-red-50",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${COLORS[severity]}`}
    >
      {severity}
    </span>
  );
}
