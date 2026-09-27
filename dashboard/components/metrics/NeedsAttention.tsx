import Link from "next/link";

import { SeverityBadge } from "@/components/SeverityBadge";
import { TriageBadge } from "@/components/TriageBadge";
import type { IncidentListItem, MetricsResponse, MetricsSummary } from "@/lib/types";
import { MetricState } from "./MetricState";

function StatBlock({ label, value, status }: { label: string; value: number | null; status: string }) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      {status === "ok" && value !== null ? (
        <p className="text-2xl font-semibold">{value}</p>
      ) : (
        <MetricState status={status as "no_data" | "pending_upstream"} />
      )}
    </div>
  );
}

// The page's first section, per the "what needs my attention right now"
// brief: incident volume, the single most important safety fact (kill
// switch / dry-run state), and the newest incidents to look at -- all
// above the fold, ahead of any chart.
export function NeedsAttention({
  summary,
  response,
  incidents,
}: {
  summary: MetricsSummary | null;
  response: MetricsResponse | null;
  incidents: IncidentListItem[] | null;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Needs attention</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {summary ? (
          <>
            <StatBlock label="Incidents" value={summary.total_incidents.value} status={summary.total_incidents.status} />
            <StatBlock label="Critical" value={summary.critical_incidents.value} status={summary.critical_incidents.status} />
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
        {!incidents ? (
          <div className="p-4">
            <MetricState status="loading" />
          </div>
        ) : incidents.length === 0 ? (
          <div className="p-4">
            <MetricState status="no_data" noDataMessage="No incidents in this range" />
          </div>
        ) : (
          <ul>
            {incidents.map((incident) => (
              <li key={incident.incident_id} className="border-t border-zinc-100 first:border-t-0 dark:border-zinc-900">
                <Link
                  href={`/incidents/${incident.incident_id}`}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <SeverityBadge severity={incident.severity} />
                  <span className="w-20 shrink-0 truncate">{incident.host}</span>
                  <span className="w-32 shrink-0 truncate text-zinc-500">{incident.user}</span>
                  <span className="flex-1 truncate text-zinc-500">{incident.matched_scenario ?? "—"}</span>
                  <TriageBadge verdict={incident.triage_verdict} status={incident.triage_status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
