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

// --- Reading verdicts. These mirror backend/metrics/case_metrics.py (side_of_ai,
// side_of_analyst); keep the two in sync if either changes. ---

export type VerdictSide = "malicious" | "benign" | "uncertain";

export function sideOfAi(verdict: unknown): VerdictSide | null {
  if (verdict === "true_positive" || verdict === "likely_true_positive") return "malicious";
  if (verdict === "false_positive" || verdict === "likely_false_positive") return "benign";
  if (verdict === "needs_review") return "uncertain";
  return null;
}

// Undetermined, missing and unknown verdicts have no side.
export function sideOfAnalyst(verdict: unknown): "malicious" | "benign" | null {
  if (verdict === "true_positive") return "malicious";
  if (verdict === "false_positive" || verdict === "benign_activity") return "benign";
  return null;
}

// True only when both sides are known, the AI is not uncertain, and they differ.
export function disagrees(aiVerdict: unknown, analystVerdict: unknown): boolean {
  const ai = sideOfAi(aiVerdict);
  const analyst = sideOfAnalyst(analystVerdict);
  return ai !== null && analyst !== null && ai !== "uncertain" && ai !== analyst;
}

export type VerdictRelation = "no_ai" | "analyst_undetermined" | "ai_uncertain" | "agree" | "disagree";

// How the analyst's verdict relates to the AI's, checked in this order: no AI side
// (missing, failed or unknown), then no analyst side (undetermined, missing or
// unknown), then an uncertain AI, then equal sides, otherwise a disagreement.
// disagrees() is true exactly when this returns "disagree".
export function verdictRelation(aiVerdict: unknown, analystVerdict: unknown): VerdictRelation {
  const ai = sideOfAi(aiVerdict);
  if (ai === null) return "no_ai";
  const analyst = sideOfAnalyst(analystVerdict);
  if (analyst === null) return "analyst_undetermined";
  if (ai === "uncertain") return "ai_uncertain";
  return ai === analyst ? "agree" : "disagree";
}
