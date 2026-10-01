import type { Severity } from "@/lib/types";
import { SEVERITY_BADGE_CLASSES } from "@/lib/severity";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${SEVERITY_BADGE_CLASSES[severity]}`}
    >
      {severity}
    </span>
  );
}
