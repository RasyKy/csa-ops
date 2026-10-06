import type { IncidentListItem, ResponseAction } from "./types";

const COMPLETED_STATUSES = ["executed", "failed"];

// No case-management/status field exists in the incident contract yet
// (see docs/person_b.md "Known limitations"). Until one does, an incident
// counts as "open" if its response hasn't actually completed -- issued
// but not yet executed or failed, or nothing dispatched at all. Shared by
// the Overview's open-incidents card and the /incidents list's
// status=open filter so both apply the exact same definition.
export function isOpenIncident(incident: IncidentListItem): boolean {
  const status = incident.last_response_action?.status;
  return !status || !COMPLETED_STATUSES.includes(status);
}

export type IncidentStatus = "open" | "resolved" | "no_response";

// @deprecated for the incident detail page, which now shows the real case
// status (components/case/). Kept only for the Incidents list status filter and
// the Overview until they move to case status.
//
// Same COMPLETED_STATUSES as isOpenIncident, just a 3-way label instead of
// a boolean, for the incident detail page's header badge.
export function deriveIncidentStatus(history: ResponseAction[]): IncidentStatus {
  if (history.length === 0) return "no_response";
  const latest = history[history.length - 1];
  return COMPLETED_STATUSES.includes(latest.status) ? "resolved" : "open";
}
