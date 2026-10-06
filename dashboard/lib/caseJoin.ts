// Joins case summaries onto incidents for the Incidents list and the Overview.
// Pure and import-free. Unknown values never throw: an unknown status counts as
// open, an unknown filter counts as "all".

export interface CaseSummaryLike {
  incident_id: string;
  status: string;
  assignee: string | null;
  verdict: string | null;
  updated_time: string | null;
}

export type NormalizedStatus = "open" | "investigating" | "resolved";
export type StatusFilter = "all" | "active" | "open" | "investigating" | "resolved";

export const STATUS_FILTERS: readonly StatusFilter[] = ["all", "active", "open", "investigating", "resolved"];

export function normalizeStatus(status: unknown): NormalizedStatus {
  return status === "investigating" || status === "resolved" ? status : "open";
}

// An incident with no stored case is open, with no assignee.
export function effectiveCase(
  incidentId: string,
  summaries: ReadonlyArray<CaseSummaryLike> | null | undefined,
): CaseSummaryLike {
  const found = Array.isArray(summaries) ? summaries.find((c) => c && c.incident_id === incidentId) : undefined;
  return found ?? { incident_id: incidentId, status: "open", assignee: null, verdict: null, updated_time: null };
}

export function isUnresolved(status: unknown): boolean {
  return normalizeStatus(status) !== "resolved";
}

export function parseStatusFilter(raw: unknown): StatusFilter {
  return typeof raw === "string" && (STATUS_FILTERS as readonly string[]).includes(raw) ? (raw as StatusFilter) : "all";
}

export function matchesStatusFilter(status: unknown, filter: unknown): boolean {
  const f = parseStatusFilter(filter);
  const s = normalizeStatus(status);
  switch (f) {
    case "active":
      return s !== "resolved";
    case "open":
    case "investigating":
    case "resolved":
      return s === f;
    default:
      return true;
  }
}

// filter: "all" (or empty), "unassigned", or an exact assignee name.
export function assigneeFilterMatches(assignee: string | null | undefined, filter: unknown): boolean {
  if (typeof filter !== "string" || filter === "" || filter === "all") return true;
  const name = typeof assignee === "string" && assignee.trim() !== "" ? assignee : null;
  if (filter === "unassigned") return name === null;
  return name === filter;
}
