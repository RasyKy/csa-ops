"use client";

import { StatusBadge } from "@/components/StatusBadge";
import { Tooltip } from "@/components/ui/Tooltip";

import { useCaseContext } from "./CaseProvider";

export function CaseStatusProperty() {
  const { caseData, loading } = useCaseContext();
  return (
    <Tooltip content="Case status. Changes here never affect detections or response actions.">
      <span tabIndex={0} className="inline-flex cursor-help" data-testid="header-status">
        {caseData ? (
          <StatusBadge status={caseData.status} />
        ) : (
          <span className="text-xs font-semibold text-ink-subtle">{loading ? "Loading" : "Unavailable"}</span>
        )}
      </span>
    </Tooltip>
  );
}

export function CaseAssigneeProperty() {
  const { caseData, loading } = useCaseContext();
  if (!caseData) {
    return <span className="text-ink-subtle" data-testid="header-assignee">{loading ? "Loading" : "Unavailable"}</span>;
  }
  return caseData.assignee ? (
    <span data-testid="header-assignee">{caseData.assignee}</span>
  ) : (
    <span className="text-ink-subtle" data-testid="header-assignee">
      Unassigned
    </span>
  );
}
