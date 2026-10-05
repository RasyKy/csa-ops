import Link from "next/link";

import { SeverityBadge } from "@/components/SeverityBadge";
import { TriageBadge } from "@/components/TriageBadge";
import { humanizeScenario } from "@/lib/incidentDisplay";
import { effectiveCase, isUnresolved } from "@/lib/caseJoin";
import { medianResolveText, statusCountsText } from "@/lib/caseMetricsDisplay";
import { isOpenIncident } from "@/lib/incidents";
import { SEVERITY_HEX, SEVERITY_ORDER } from "@/lib/severity";
import type { CaseSummary, IncidentListItem, MetricsCases, MetricsResponse } from "@/lib/types";
import { AutomatedResponseStatus } from "./AutomatedResponseStatus";
import { InfoTooltip } from "./InfoTooltip";
import { MetricState } from "./MetricState";

export { isOpenIncident };

// Total (linked to /incidents?status=active) plus a per-severity breakdown,
// most severe first -- each chip links to that exact filter combination
// so the number shown and the list landed on always match.
function OpenIncidentsCard({
  incidents,
  caseMetrics = null,
}: {
  incidents: IncidentListItem[];
  caseMetrics?: MetricsCases | null;
}) {
  // Case counts for the range and the median time to resolve. Left out entirely
  // when the case metrics are unavailable.
  const counts = caseMetrics?.status_counts?.status === "ok" ? caseMetrics.status_counts.value : null;
  const median = caseMetrics?.resolve_time ? medianResolveText(caseMetrics.resolve_time.value) : null;

  const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const incident of incidents) bySeverity[incident.severity] += 1;

  return (
    <div data-testid="overview-card" className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-zinc-500">
        Open incidents
        <InfoTooltip text="Incidents whose case is open or being investigated. Resolving a case removes it from this count." />
      </div>
      <Link href="/incidents?status=active" className="block w-fit text-2xl font-semibold hover:underline">
        {incidents.length}
      </Link>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {[...SEVERITY_ORDER].reverse().map((severity) => (
          <Link
            key={severity}
            href={`/incidents?status=active&severity=${severity}`}
            className="flex items-center gap-1 text-xs hover:underline"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_HEX[severity] }} />
            <span className="font-semibold">{bySeverity[severity]}</span>
            <span className="capitalize text-zinc-500">{severity}</span>
          </Link>
        ))}
      </div>
      {counts && (
        <div className="mt-2 space-y-0.5 text-xs text-ink-muted" data-testid="case-counts">
          <p data-testid="case-status-counts">{statusCountsText(counts)}</p>
          {median && <p data-testid="case-median-resolve">{median}</p>}
        </div>
      )}
    </div>
  );
}

// The page's first section, per the "what needs my attention right now"
// brief: open-incident volume, the single most important safety fact
// (automated response status -- see AutomatedResponseStatus), and the
// newest incidents to look at -- all above the fold, ahead of any chart.
// Renders the same way whether the range is empty or not: counts just
// read 0, matching every other section on the page (no separate
// empty-state layout here).
export function NeedsAttention({
  incidents,
  response,
  cases = null,
  caseMetrics = null,
}: {
  incidents: IncidentListItem[] | null;
  response: MetricsResponse | null;
  cases?: CaseSummary[] | null;
  caseMetrics?: MetricsCases | null;
}) {
  // Unresolved means the case is open or investigating; with no case data every
  // incident counts as open.
  const openIncidents = incidents?.filter((i) => isUnresolved(effectiveCase(i.incident_id, cases).status)) ?? null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold text-zinc-500">Needs attention</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {openIncidents !== null ? (
          <OpenIncidentsCard incidents={openIncidents} caseMetrics={caseMetrics} />
        ) : (
          <div data-testid="overview-card" className="rounded-lg border border-line bg-surface p-4">
            <MetricState status="loading" />
          </div>
        )}
        <AutomatedResponseStatus response={response} />
      </div>

      <div className="mt-3 rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <p className="text-xs font-semibold text-zinc-500">Newest incidents</p>
          <Link href="/incidents" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            View all
          </Link>
        </div>
        {openIncidents === null ? (
          <div className="p-4">
            <MetricState status="loading" />
          </div>
        ) : openIncidents.length === 0 ? (
          <div className="p-4">
            <p className="truncate text-sm text-zinc-500">No open incidents in this range</p>
          </div>
        ) : (
          <ul>
            {openIncidents.slice(0, 5).map((incident) => (
              <li key={incident.incident_id} className="border-t border-line first:border-t-0">
                <Link
                  href={`/incidents/${incident.incident_id}`}
                  className="grid grid-cols-[72px_88px_128px_1fr_220px] items-center gap-3 px-4 py-2 text-sm hover:bg-surface-subtle"
                >
                  <SeverityBadge severity={incident.severity} />
                  <span className="truncate" title={incident.host}>
                    {incident.host}
                  </span>
                  <span className="truncate text-zinc-500" title={incident.user}>
                    {incident.user}
                  </span>
                  <span className="truncate text-zinc-500" title={incident.matched_scenario ?? undefined}>
                    {incident.matched_scenario ? humanizeScenario(incident.matched_scenario) : "-"}
                  </span>
                  <span className="justify-self-end whitespace-nowrap">
                    <TriageBadge verdict={incident.triage_verdict} status={incident.triage_status} prefix="AI:" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
