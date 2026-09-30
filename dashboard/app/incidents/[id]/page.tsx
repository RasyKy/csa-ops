import { notFound } from "next/navigation";

import { EventTimeline } from "@/components/EventTimeline";
import { ExplainPanel } from "@/components/ExplainPanel";
import { IncidentGraph } from "@/components/IncidentGraph";
import { ResponseHistoryPanel } from "@/components/ResponseHistoryPanel";
import { SeverityBadge } from "@/components/SeverityBadge";
import { TriageBadge } from "@/components/TriageBadge";
import { TriagePanel } from "@/components/TriagePanel";
import { backendFetch } from "@/lib/api";
import { deriveIncidentStatus, type IncidentStatus } from "@/lib/incidents";
import type { Graph, IncidentDetail } from "@/lib/types";

// Server component: fetches FastAPI directly on the server. The dashboard
// API key never reaches the browser this way -- see lib/api.ts.
async function getIncident(id: string): Promise<IncidentDetail | null> {
  const res = await backendFetch(`/incidents/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

async function getGraph(id: string): Promise<Graph> {
  const res = await backendFetch(`/incidents/${id}/graph`);
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

const STATUS_COPY: Record<IncidentStatus, { label: string; classes: string }> = {
  open: { label: "Open", classes: "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100" },
  resolved: { label: "Resolved", classes: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" },
  no_response: { label: "No response yet", classes: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400" },
};

function StatusBadge({ status }: { status: IncidentStatus }) {
  const copy = STATUS_COPY[status];
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${copy.classes}`}>
      {copy.label}
    </span>
  );
}

export default async function IncidentDetailPage({ params }: { params: { id: string } }) {
  const incident = await getIncident(params.id);
  if (!incident) notFound();
  const graph = await getGraph(params.id);
  const status = deriveIncidentStatus(incident.response_history);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <a href="/incidents" className="text-sm text-zinc-500 hover:underline">
        &larr; Incidents
      </a>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{incident.incident_id}</h1>
        <SeverityBadge severity={incident.severity} />
        <StatusBadge status={status} />
        <span className="ml-auto">
          <TriageBadge verdict={incident.triage?.verdict ?? null} status={incident.triage?.status ?? null} prefix="AI:" />
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        {incident.host} · {incident.user} · {incident.matched_scenario ?? "no matched scenario"} ·{" "}
        {incident.incident_raised_time}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Attack chain</h2>
            <IncidentGraph graph={graph} />
          </section>

          <ExplainPanel incidentId={incident.incident_id} triage={incident.triage} />

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Event timeline</h2>
            <EventTimeline nodes={incident.chain.nodes} />
          </section>
        </div>

        <div className="space-y-6">
          <TriagePanel triage={incident.triage} />
          <ResponseHistoryPanel history={incident.response_history} />
        </div>
      </div>
    </main>
  );
}
