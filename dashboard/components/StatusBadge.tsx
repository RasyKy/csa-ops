import React from "react";
import { Check } from "lucide-react";
import type { IncidentStatus } from "@/lib/incidents";

// Case statuses (open, investigating, resolved) plus the older response-derived
// "no_response" value, which the Incidents list and Overview still pass until
// they move to case status.
export type StatusBadgeStatus = IncidentStatus | "investigating";

export function StatusBadge({
  status,
  className = "",
  "data-testid": testId,
}: {
  status: StatusBadgeStatus;
  className?: string;
  "data-testid"?: string;
}) {
  if (status === "open") {
    return (
      <span
        data-testid={testId}
        data-status="open"
        className={`inline-flex items-center gap-1.5 text-xs font-semibold text-ink ${className}`.trim()}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400" aria-hidden="true" />
        Open
      </span>
    );
  }

  if (status === "investigating") {
    return (
      <span
        data-testid={testId}
        data-status="investigating"
        className={`inline-flex items-center gap-1.5 text-xs font-semibold text-ink ${className}`.trim()}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        Investigating
      </span>
    );
  }

  if (status === "resolved") {
    return (
      <span
        data-testid={testId}
        data-status="resolved"
        className={`inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted ${className}`.trim()}
      >
        <Check className="h-3 w-3 text-ink-subtle" aria-hidden="true" />
        Resolved
      </span>
    );
  }

  return (
    <span
      data-testid={testId}
      data-status="no_response"
      className={`inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted ${className}`.trim()}
    >
      <span className="h-1.5 w-1.5 rounded-full border-[1.5px] border-ink-muted bg-transparent shrink-0" aria-hidden="true" />
      No response yet
    </span>
  );
}
