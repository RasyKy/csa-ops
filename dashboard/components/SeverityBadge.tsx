import type { Severity } from "@/lib/types";

const SEVERITY_DOT_COLORS: Record<Severity, string> = {
  low: "bg-blue-500 dark:bg-blue-400",
  medium: "bg-amber-500 dark:bg-amber-400",
  high: "bg-orange-500 dark:bg-orange-400",
  critical: "bg-red-500 dark:bg-red-400",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const dotColor = SEVERITY_DOT_COLORS[severity] ?? "bg-zinc-400";
  const label = severity ? severity.charAt(0).toUpperCase() + severity.slice(1).toLowerCase() : "";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
      {label}
    </span>
  );
}
