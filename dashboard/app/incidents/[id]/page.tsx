import { notFound } from "next/navigation";

import { IncidentGraph } from "@/components/IncidentGraph";
import { ExplainPanel } from "@/components/ExplainPanel";
import { ResponseHistoryPanel } from "@/components/ResponseHistoryPanel";
import { SeverityBadge } from "@/components/SeverityBadge";
import { TriagePanel } from "@/components/TriagePanel";
import { backendFetch } from "@/lib/api";
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

export default async function IncidentDetailPage({ params }: { params: { id: string } }) {
  const incident = await getIncident(params.id);
  if (!incident) notFound();
  const graph = await getGraph(params.id);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <a href="/incidents" className="text-sm text-slate-500 hover:underline">
        &larr; Incidents
      </a>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{incident.incident_id}</h1>
        <SeverityBadge severity={incident.severity} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
        <Detail label="Host" value={incident.host} />
        <Detail label="User" value={incident.user} />
        <Detail label="Scenario" value={incident.matched_scenario ?? "—"} />
        <Detail label="Raised" value={incident.incident_raised_time} />
      </dl>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Attack chain</h2>
        <IncidentGraph graph={graph} />
      </section>

      <section className="mt-6 grid gap-6 sm:grid-cols-3">
        <TriagePanel triage={incident.triage} />
        <ExplainPanel incidentId={incident.incident_id} triage={incident.triage} />
        <ResponseHistoryPanel history={incident.response_history} />
      </section>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
