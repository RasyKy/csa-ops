import Link from "next/link";

import { SeverityBadge } from "@/components/SeverityBadge";
import { TriageBadge } from "@/components/TriageBadge";
import type { IncidentListItem, MetricsResponse } from "@/lib/types";
import { MetricState } from "./MetricState";

const COMPLETED_STATUSES = ["executed", "failed"];

// No case-management/status field exists in the incident contract yet
// (see docs/person_b.md "Known limitations"). Until one does, an incident
// counts as "open" if its response hasn't actually completed -- issued
// but not yet executed or failed, or nothing dispatched at all.
export function isOpenIncident(incident: IncidentListItem): boolean {
  const status = incident.last_response_action?.status;
  return !status || !COMPLETED_STATUSES.includes(status);
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

// The page's first section, per the "what needs my attention right now"
// brief: open-incident volume, the single most important safety fact
// (kill switch / dry-run state), and the newest incidents to look at --
// all above the fold, ahead of any chart. Renders the same way whether
// the range is empty or not: counts just read 0, matching every other
// section on the page (no separate empty-state layout here).
export function NeedsAttention({
  incidents,
  response,
}: {
  incidents: IncidentListItem[] | null;
  response: MetricsResponse | null;
}) {
  const openIncidents = incidents?.filter(isOpenIncident) ?? null;
  const criticalOpen = openIncidents?.filter((i) => i.severity === "critical").length ?? null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Needs attention</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {openIncidents !== null && criticalOpen !== null ? (
          <>
            <StatBlock label="Open incidents" value={openIncidents.length} />
            <StatBlock label="Critical" value={criticalOpen} />
          </>
        ) : (
          <>
            <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
              <MetricState status="loading" />
            </div>
            <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
              <MetricState status="loading" />
            </div>
          </>
        )}
        <div className="flex flex-col justify-center gap-2 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          {response ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${response.kill_switch ? "bg-red-500" : "bg-emerald-500"}`}
                />
                Kill switch <span className="font-semibold">{response.kill_switch ? "ON" : "off"}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${response.response_mode === "live" ? "bg-red-500" : "bg-blue-500"}`}
                />
                Response mode <span className="font-semibold uppercase">{response.response_mode}</span>
              </div>
            </>
          ) : (
            <MetricState status="loading" />
          )}
        </div>
      </div>

      <div className="mt-3 rounded border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Newest incidents</p>
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
              <li key={incident.incident_id} className="border-t border-zinc-100 first:border-t-0 dark:border-zinc-900">
                <Link
                  href={`/incidents/${incident.incident_id}`}
                  className="grid grid-cols-[72px_88px_128px_1fr_220px] items-center gap-3 px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <SeverityBadge severity={incident.severity} />
                  <span className="truncate" title={incident.host}>
                    {incident.host}
                  </span>
                  <span className="truncate text-zinc-500" title={incident.user}>
                    {incident.user}
                  </span>
                  <span className="truncate text-zinc-500" title={incident.matched_scenario ?? undefined}>
                    {incident.matched_scenario ?? "—"}
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
